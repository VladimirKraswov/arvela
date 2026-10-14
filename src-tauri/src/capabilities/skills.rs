//! Bounded skill discovery and metadata validation, independent of MCP installation.
use super::Skill;
use std::{fs, path::Path};

#[derive(Clone, Copy)]
pub(super) struct SkillSource<'a> {
    pub source: &'a str,
    pub managed: bool,
    pub enabled: bool,
    pub engines: &'a [&'a str],
}

pub(super) fn field(front: &str, name: &str) -> String {
    let mut lines = front.lines();
    while let Some(line) = lines.next() {
        if let Some(value) = line.strip_prefix(&format!("{name}:")) {
            let value = value.trim();
            if matches!(value, ">" | "|" | ">-" | "|-") {
                return lines
                    .take_while(|l| l.starts_with(' ') || l.trim().is_empty())
                    .map(str::trim)
                    .collect::<Vec<_>>()
                    .join(" ");
            }
            return value.trim_matches(['\'', '"']).to_owned();
        }
    }
    String::new()
}
pub(super) fn scan(
    path: &Path,
    context: &SkillSource<'_>,
    out: &mut Vec<Skill>,
    budget: &mut usize,
    depth: usize,
) {
    let SkillSource {
        source,
        managed,
        enabled,
        engines,
    } = *context;
    if *budget == 0 || depth > 8 || path.is_symlink() {
        return;
    }
    let Ok(items) = fs::read_dir(path) else {
        return;
    };
    for entry in items.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let p = entry.path();
        let Ok(meta) = entry.file_type() else {
            continue;
        };
        if meta.is_symlink() {
            continue;
        }
        if meta.is_dir() {
            scan(&p, context, out, budget, depth + 1);
        } else if entry.file_name() == "SKILL.md" {
            let content = fs::metadata(&p)
                .ok()
                .filter(|m| m.len() <= 65536)
                .and_then(|_| fs::read_to_string(&p).ok());
            let content = content.map(|s| s.replace("\r\n", "\n"));
            let front = content
                .as_deref()
                .and_then(|s| s.trim_start().strip_prefix("---\n"))
                .and_then(|s| s.split_once("\n---").map(|v| v.0));
            let name = front.map(|s| field(s, "name")).unwrap_or_default();
            let description = front.map(|s| field(s, "description")).unwrap_or_default();
            let error = if name.is_empty()
                || name.len() > 64
                || description.is_empty()
                || description.chars().count() > 1024
                || name.split('-').any(|part| {
                    part.is_empty()
                        || !part
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                })
                || p.parent()
                    .and_then(Path::file_name)
                    .is_none_or(|folder| folder != name.as_str())
            {
                Some("Проверьте name/description в YAML-шапке SKILL.md".into())
            } else {
                None
            };
            out.push(Skill {
                name: if name.is_empty() {
                    p.parent()
                        .and_then(Path::file_name)
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                } else {
                    name
                },
                description,
                path: p.display().to_string(),
                source: source.into(),
                managed,
                enabled,
                engines: engines.iter().map(|s| s.to_string()).collect(),
                error,
            });
        }
    }
}
