#!/usr/bin/env python3
"""Install tested local OpenCode helpers with preimage checks and backups."""

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


SOURCE = Path(__file__).resolve().parent
FILES = {
    "tools/repo_inspect.py": "3417acf1198d0be9b33d3ecd4fb0fa45339336142351b9d98819f3f676c99d86",
    "tools/repo_inspect.ts": "7b3fe043a9d300eb65c955c1ee815a58e7dd892afb4f30883f9092827ab4170c",
    "tools/safe_edit.py": None,
    "tools/safe_edit.ts": None,
    "agents/qwen-review.md": "4276da01153f624843bc815edcbc0b03f5d3af4b27bc9ad6b3796e50866b5040",
    "instructions/qwen-coding.md": "693623f589f02747cd3855f26e026639a308ee624ad651f670f3fab5004365e8",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def current_sessions_idle():
    try:
        with urllib.request.urlopen("http://127.0.0.1:4096/session/status", timeout=3) as response:
            return not json.load(response)
    except urllib.error.HTTPError:
        return False
    except ValueError:
        return False
    except urllib.error.URLError:
        return True  # OpenCode is offline; no active local session can be interrupted.


def install(root, apply_changes=False):
    root = Path(root).expanduser().resolve()
    changes = []
    for relative, expected in FILES.items():
        origin = SOURCE / Path(relative).name
        target = root / relative
        if target.is_symlink():
            raise ValueError(f"refuse symlink destination: {target}")
        old = target.read_bytes() if target.exists() else None
        proposed = origin.read_bytes()
        if old == proposed:
            continue
        if old is not None and (expected is None or digest(old) != expected):
            raise ValueError(f"unexpected existing file; review manually: {target}")
        changes.append((relative, target, old, proposed))
    if apply_changes and changes and not current_sessions_idle():
        raise ValueError("OpenCode has active sessions; installation deferred")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = []
    for relative, target, old, proposed in changes:
        backup = None
        if apply_changes:
            target.parent.mkdir(parents=True, exist_ok=True)
            if old is not None:
                backup = target.with_name(f"{target.name}.backup-{stamp}")
                shutil.copy2(target, backup)
            fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
            try:
                os.fchmod(fd, target.stat().st_mode & 0o777 if old is not None else 0o644)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(proposed)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, target)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        report.append({"file": relative, "old_sha256": digest(old) if old else None,
                       "new_sha256": digest(proposed),
                       "backup": str(backup) if backup else None})
    return {"applied": apply_changes, "changes": report}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config-root", default="~/.config/opencode")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.config_root, args.apply), ensure_ascii=False, indent=2))
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
