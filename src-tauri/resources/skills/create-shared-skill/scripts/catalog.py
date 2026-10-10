#!/usr/bin/env python3
"""Read-only common skill inventory. No scripts or registry secrets are emitted."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path

LIMIT = 262144

def project_key(project):
    value = 0xcbf29ce484222325
    for byte in str(project.resolve()).encode():
        value = ((value ^ byte) * 0x100000001b3) & 0xffffffffffffffff
    return f"project-{value:016x}"

def registry_sources(root, project):
    sources = {}
    for key in ['global'] + ([project_key(project)] if project else []):
        file = root / (key + '.json')
        if not file.exists():
            continue
        if file.is_symlink() or file.stat().st_size > LIMIT:
            raise ValueError('Invalid registry file')
        data = json.loads(file.read_text(encoding='utf-8'))
        if data.get('version') != 1 or not isinstance(data.get('sources'), list):
            raise ValueError('Unsupported registry')
        for source in data['sources']:
            if not isinstance(source, dict) or not isinstance(source.get('id'), str):
                raise ValueError('Invalid source')
            sources[source['id']] = source
    return [Path(s['path']) for s in sources.values()
            if s.get('enabled') is True and isinstance(s.get('path'), str) and Path(s['path']).is_absolute()]

def inventory(roots):
    records, seen = [], set()
    for root in roots:
        if not root.is_dir():
            continue
        # Only direct skill packages, never a recursive walk of home/project.
        children = sorted(root.iterdir(), key=lambda p: p.name)
        if len(children) > 1000:
            raise ValueError('Too many skill packages')
        for directory in children:
            file = directory / 'SKILL.md'
            if not file.is_file() or file.is_symlink():
                continue
            resolved = file.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            if file.stat().st_size > LIMIT:
                raise ValueError('Skill too large')
            raw = file.read_bytes()
            text = raw.decode('utf-8')
            front = re.match(r'^---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.S)
            if not front:
                continue
            values = {}
            for line in front[1].splitlines():
                match = re.match(r'^(name|description):\s*(.+)$', line)
                if match:
                    values[match[1]] = match[2].strip().strip('\"\'')
            records.append({**values, 'path': str(resolved), 'sha256': hashlib.sha256(raw).hexdigest(),
                            'kind': 'managed-copy' if any(p in resolved.parts for p in ('builtin-skills', 'hub-cache')) else 'source',
                            'descriptionFormat': 'read-SKILL.md' if values.get('description') in ('>', '|', '>-', '|-') else 'inline'})
            if len(records) > 1000:
                raise ValueError('Too many skills')
    return records

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path)
    parser.add_argument('--registry', type=Path)
    parser.add_argument('--source', type=Path, action='append', default=[])
    args = parser.parse_args()
    home = Path.home()
    default = Path(os.environ.get('LOCALAPPDATA', home / 'AppData/Local')) if os.name == 'nt' else Path(os.environ.get('XDG_DATA_HOME', home / '.local/share'))
    registry = args.registry or Path(os.environ.get('MESH_CAPABILITIES_ROOT', default / 'opencode-desktop/capabilities'))
    try:
        roots = [home / '.agents/skills']
        if args.project:
            if not args.project.is_absolute() or not args.project.is_dir():
                raise ValueError('Project must be an existing absolute directory')
            roots.append(args.project / '.agents/skills')
        roots.extend(registry_sources(registry, args.project))
        roots.extend(args.source)
        print(json.dumps({'skills': inventory(roots), 'scope': 'common local sources; current engine catalogue remains authoritative'}, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, UnicodeError) as error:
        print(json.dumps({'error': type(error).__name__, 'detail': 'Catalogue unavailable; inspect the engine catalogue and connected sources'}, ensure_ascii=False))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
