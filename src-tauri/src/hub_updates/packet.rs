use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};
pub const MAX: usize = 24 * 1024 * 1024;
pub const FINGERPRINT: &str = env!("ARVELA_NATIVE_FINGERPRINT");
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Packet {
    pub schema_version: u8,
    pub kind: String,
    pub version: String,
    pub native_fingerprint: String,
    #[serde(default)]
    pub notes: String,
    pub files: BTreeMap<String, String>,
}
pub struct Verified {
    pub packet: Packet,
    pub files: BTreeMap<String, Vec<u8>>,
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn hash_ok(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn safe_path(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 240
        && s.bytes().all(|b| b > 32 && b < 127)
        && !s.contains(['\\', ':'])
        && s.split('/').all(|p| {
            let base = p.split('.').next().unwrap_or_default().to_ascii_lowercase();
            !p.is_empty()
                && !matches!(p, "." | "..")
                && !p.ends_with(['.', ' '])
                && !matches!(base.as_str(), "con" | "prn" | "aux" | "nul")
                && !(base.len() == 4
                    && (base.starts_with("com") || base.starts_with("lpt"))
                    && matches!(base.as_bytes()[3], b'1'..=b'9'))
        })
}
pub fn verify(
    envelope: &Envelope,
    expected_digest: &str,
    version: &str,
    kind: &str,
    fingerprint: &str,
) -> Result<Verified, String> {
    if envelope.payload.len() > MAX * 4 / 3 + 4 || envelope.signature.len() > 8192 {
        return Err("Пакет слишком велик".into());
    }
    let raw = STANDARD
        .decode(&envelope.payload)
        .map_err(|_| "Invalid payload encoding")?;
    if raw.len() > MAX || digest(&raw) != expected_digest {
        return Err("Контрольная сумма обновления не совпадает".into());
    }
    crate::updates::verify(&raw, &envelope.signature, version)?;
    let packet: Packet = serde_json::from_slice(&raw).map_err(|_| "Invalid signed release")?;
    semver::Version::parse(&packet.version).map_err(|_| "Invalid release version")?;
    if packet.schema_version != 1
        || packet.version != version
        || packet.kind != kind
        || packet.native_fingerprint != fingerprint
        || !hash_ok(fingerprint)
        || packet.notes.len() > 16000
    {
        return Err("Пакет не соответствует выбранному обновлению".into());
    }
    let files = decode_files(&packet)?;
    Ok(Verified { packet, files })
}
pub fn decode_files(packet: &Packet) -> Result<BTreeMap<String, Vec<u8>>, String> {
    if packet.files.is_empty() || packet.files.len() > 4000 {
        return Err("Invalid file count".into());
    }
    let mut result = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut size = 0;
    for (name, encoded) in &packet.files {
        if !safe_path(name)
            || !seen.insert(name.to_ascii_lowercase())
            || name.split('/').any(|p| {
                matches!(p, ".git" | ".local" | "node_modules" | "target")
                    || p == ".env"
                    || p.starts_with(".env.")
            })
        {
            return Err("Unsafe release path".into());
        }
        let data = STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid file encoding")?;
        size += data.len();
        if data.len() > 12 * 1024 * 1024 || size > MAX {
            return Err("Release files exceed limit".into());
        }
        result.insert(name.clone(), data);
    }
    if packet.kind == "hot" && !result.contains_key("index.html") {
        return Err("Missing index.html".into());
    }
    Ok(result)
}
pub fn extract(files: &BTreeMap<String, Vec<u8>>, root: &Path) -> Result<(), String> {
    // Fresh directory only. No pre-existing symlink may redirect an extraction.
    fs::create_dir(root).map_err(|e| e.to_string())?;
    crate::updates::private(root)?;
    for (name, bytes) in files {
        if !safe_path(name) {
            return Err("Unsafe source path".into());
        }
        let p = root.join(name);
        fs::create_dir_all(p.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&p)
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        f.write_all(bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_paths_reject_escape_and_windows_aliases() {
        for s in [
            "../x", "/x", "x\\y", "x:a", "NUL.txt", "foo/COM1", "x//y", "x.",
        ] {
            assert!(!safe_path(s), "{s}");
        }
        assert!(safe_path("src/main.tsx"));
    }
    #[test]
    fn malformed_and_unsigned_packets_never_execute() {
        let e = Envelope {
            payload: STANDARD.encode(b"{}"),
            signature: String::new(),
        };
        assert!(verify(&e, &digest(b"{}"), "1.0.0", "hot", &"a".repeat(64)).is_err());
    }
    #[test]
    fn extraction_rejects_existing_directory() {
        let p = std::env::temp_dir();
        assert!(extract(&BTreeMap::new(), &p).is_err());
    }
}

#[cfg(test)]
mod signed_acceptance {
    use super::*;
    #[test]
    #[ignore = "Opt-in real signed Hub artifact; ARVELA_VERIFY_HUB_PACKET"]
    fn verify_actual_hub_release() {
        let file = std::env::var("ARVELA_VERIFY_HUB_PACKET").expect("packet path");
        let envelope: Envelope = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
        let raw = STANDARD.decode(&envelope.payload).unwrap();
        let packet: Packet = serde_json::from_slice(&raw).unwrap();
        let v = verify(
            &envelope,
            &digest(&raw),
            &packet.version,
            &packet.kind,
            &packet.native_fingerprint,
        )
        .unwrap();
        assert!(!v.files.is_empty());
        let mut altered = envelope.clone();
        altered.payload = STANDARD.encode(b"changed");
        assert!(verify(
            &altered,
            &digest(b"changed"),
            &packet.version,
            &packet.kind,
            &packet.native_fingerprint
        )
        .is_err());
        assert!(verify(
            &envelope,
            &digest(&raw),
            "99.99.99",
            &packet.kind,
            &packet.native_fingerprint
        )
        .is_err());
        if packet.kind == "source" {
            assert_eq!(
                super::super::build::source_fingerprint_for_test(&v).unwrap(),
                packet.native_fingerprint
            );
        }
    }
}
