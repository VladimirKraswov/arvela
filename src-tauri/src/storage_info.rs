//! Read-only size accounting. Never exports transcript bodies or accepts a database path.
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBytes {
    id: String,
    bytes: u64,
    messages: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    path: String,
    sessions: Vec<SessionBytes>,
}

fn read_sizes(
    db: &Connection,
    directory: &str,
    ids: &[String],
) -> Result<Vec<SessionBytes>, String> {
    if ids.len() > 10000 {
        return Err("Слишком много сессий".into());
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    db.progress_handler(10000, Some(move || Instant::now() >= deadline))
        .map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_millis(500))
        .map_err(|e| e.to_string())?;
    // BLOB length counts UTF-8 bytes, not Unicode characters. These are payload
    // bytes only: shared SQLite pages/indexes/free space cannot be assigned to a chat.
    let mut query = db.prepare("SELECT id,
        COALESCE((SELECT SUM(length(CAST(data AS BLOB))) FROM message WHERE session_id=session.id),0)
        + COALESCE((SELECT SUM(length(CAST(data AS BLOB))) FROM part WHERE session_id=session.id),0),
        (SELECT COUNT(*) FROM message WHERE session_id=session.id)
        FROM session WHERE id=?1 AND directory=?2").map_err(|e|e.to_string())?;
    let mut out = Vec::new();
    for id in ids {
        let mut rows = query.query((id, directory)).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            out.push(SessionBytes {
                id: row.get(0).map_err(|e| e.to_string())?,
                bytes: row.get::<_, i64>(1).map_err(|e| e.to_string())?.max(0) as u64,
                messages: row.get::<_, i64>(2).map_err(|e| e.to_string())?.max(0) as u64,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn session_storage(directory: String, ids: Vec<String>) -> Result<StorageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::paths::opencode_data_dir()?.join("opencode.db");
        let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        let sessions = read_sizes(&db, &directory, &ids)?;
        Ok(StorageInfo {
            path: path.display().to_string(),
            sessions,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_schema_is_not_reported_as_zero_bytes() {
        let db = Connection::open_in_memory().unwrap();
        assert!(read_sizes(&db, "/one", &["a".into()]).is_err());
    }

    #[test]
    fn readonly_snapshot_cannot_modify_history() {
        let path = std::env::temp_dir().join(format!(
            "arvela-size-test-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch("CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE message(session_id TEXT,data TEXT); CREATE TABLE part(session_id TEXT,data TEXT); INSERT INTO session VALUES('a','/one'); INSERT INTO message VALUES('a','abc');").unwrap();
        }
        let before = std::fs::read(&path).unwrap();
        let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(read_sizes(&db, "/one", &["a".into()]).unwrap()[0].bytes, 3);
        assert!(db.execute("DELETE FROM message", []).is_err());
        drop(db);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn bytes_are_scoped_and_utf8_not_db_file_size() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE message(session_id TEXT,data TEXT); CREATE TABLE part(session_id TEXT,data TEXT); INSERT INTO session VALUES('a','/one'),('b','/two'),('empty','/one'); INSERT INTO message VALUES('a','Я'),('b','private'); INSERT INTO part VALUES('a','abc');").unwrap();
        let rows = read_sizes(
            &db,
            "/one",
            &["a".into(), "b".into(), "empty".into(), "' OR 1=1".into()],
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].bytes, 5);
        assert_eq!(rows[0].messages, 1);
        assert_eq!(rows[1].bytes, 0);
        assert!(read_sizes(&db, "/one", &vec!["a".into(); 10001]).is_err());
    }
}
