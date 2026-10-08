//! Optional local project metadata, shared by both engine adapters.
use super::*;

fn command(
    directory: &str,
    preview: Option<&str>,
    grant: Option<(&str, &str)>,
) -> Result<Command, String> {
    let (_, canonical) = key_for("project", Some(directory))?;
    let directory = canonical.ok_or("Откройте папку проекта")?;
    if Path::new(&directory).parent().is_none()
        || PathBuf::from(&directory) == crate::paths::user_home()?
    {
        return Err("Выберите папку проекта, а не домашнюю папку или корень диска".into());
    }
    let root = root()?;
    if root.is_symlink() || !runtime_ready() {
        return Err("Сначала установите общие MCP-инструменты в настройках".into());
    }
    let recorded = recorded_node(&root.join("runtime"))?;
    let node = crate::browser::node_program(recorded.as_deref())?;
    let mut command = Command::new(node);
    command
        .current_dir(&directory)
        .env_remove("NODE_OPTIONS")
        .env_remove("MESH_MCP_BEARER");
    if let Some(query) = preview {
        if query.chars().count() > 256 {
            return Err("Поисковый запрос слишком длинный".into());
        }
        command
            .arg(root.join("runtime/project-map-core.mjs"))
            .arg("--preview")
            .arg(directory)
            .arg(query);
    } else if let Some((key, token)) = grant {
        command
            .arg(root.join("runtime/project-map.mjs"))
            .arg(root)
            .arg(key)
            .arg(token);
    } else {
        return Err("Не выбран режим карты проекта".into());
    }
    crate::process::hide_console(&mut command);
    Ok(command)
}

#[tauri::command]
pub async fn project_map_preview(
    window: tauri::WebviewWindow,
    directory: String,
    query: String,
) -> Result<Value, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = command(&directory, Some(&query), None)?;
        let out = crate::process::output_with_timeout(&mut command, Duration::from_secs(15), 32768)
            .map_err(|_| "Карта проекта не ответила в пределах лимита")?;
        if !out.status.success() {
            return Err(
                "Не удалось безопасно прочитать карту. Проверьте папку, Git и ограничения".into(),
            );
        }
        serde_json::from_slice(&out.stdout).map_err(|_| "Некорректный ответ карты проекта".into())
    })
    .await
    .map_err(|_| "Чтение карты прервано")?
}

pub fn mcp_main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 || args[2] == "global" || !valid_key(&args[2]) {
        return Err("Некорректная область карты проекта".into());
    }
    let (registry, _) = read_at(&root()?, &args[2])?;
    let directory = registry.directory.as_deref().ok_or("Нет папки проекта")?;
    if key_for("project", Some(directory))?.0 != args[2] {
        return Err("Область проекта изменилась".into());
    }
    let spec = registry
        .servers
        .iter()
        .find(|s| s.id == "project-map" && s.enabled)
        .ok_or("Карта отключена")?;
    if spec.kind != "stdio"
        || spec.bearer
        || !spec.env_keys.is_empty()
        || spec.args != args[1..]
        || PathBuf::from(&spec.command)
            != std::env::current_exe().map_err(|_| "Не найдена программа")?
    {
        return Err("Подключение карты изменилось; переподключите инструмент".into());
    }
    if fs::canonicalize(std::env::current_dir().map_err(|_| "Нет рабочей папки")?)
        .map_err(|_| "Нет рабочей папки")?
        != fs::canonicalize(directory).map_err(|_| "Нет папки проекта")?
    {
        return Err("Рабочая папка не соответствует проекту".into());
    }
    let mut command = command(directory, None, Some((&args[2], &args[3])))?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        Err(format!("Карта не запущена: {}", command.exec()))
    }
    #[cfg(not(unix))]
    {
        let mut child = command
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Карта не запущена")?;
        #[cfg(windows)]
        let _job = match crate::process::KillOnCloseJob::attach(&child) {
            Ok(job) => job,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Не удалось изолировать процесс карты".into());
            }
        };
        if child.wait().map_err(|_| "Карта прервана")?.success() {
            Ok(())
        } else {
            Err("Карта недоступна".into())
        }
    }
}
