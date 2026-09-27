#!/usr/bin/env python3
"""One exact, guarded file replacement. Reads JSON on stdin, returns JSON only."""

import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path


MAX_FILE = 2_000_000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def result(status, **fields):
    return {"status": status, **fields}


def guarded_path(root, value):
    relative = Path(value)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("path must be repository-relative without '..'")
    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            raise ValueError("symlinks are not accepted for guarded edits")
    if not path.resolve().is_relative_to(root) or not path.is_file():
        raise ValueError("path is not a regular file in the selected repository")
    return path


def apply(root, request):
    root = Path(root).resolve()
    path = guarded_path(root, request["path"])
    old = request["old"]
    new = request["new"]
    expected = request["expected_sha256"]
    if not isinstance(old, str) or not isinstance(new, str) or not old or old == new:
        raise ValueError("old and new must be distinct strings; old cannot be empty")
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("expected_sha256 is required; obtain it with repo_inspect(file)")
    if len(old.encode()) > MAX_FILE or len(new.encode()) > MAX_FILE:
        raise ValueError("replacement exceeds the guarded file limit")

    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE or before.st_nlink != 1:
            raise ValueError("file is not a single-link regular file within the guarded limit")
        with os.fdopen(os.dup(fd), "rb") as stream:
            original = stream.read(MAX_FILE + 1)
        actual = digest(original)
        if actual != expected:
            return result("conflict", reason="file changed since snapshot", sha256=actual)
        text = original.decode("utf-8")
        occurrences = text.count(old)
        if occurrences != 1:
            return result(
                "conflict",
                reason="old text must occur exactly once",
                occurrences=occurrences,
                sha256=actual,
            )
        replacement = text.replace(old, new, 1).encode("utf-8")
        if len(replacement) > MAX_FILE:
            raise ValueError("result exceeds the guarded file limit")

        temporary = None
        try:
            temp_fd, temporary = tempfile.mkstemp(prefix=".opencode-edit-", dir=path.parent)
            os.fchmod(temp_fd, stat.S_IMODE(before.st_mode))
            with os.fdopen(temp_fd, "wb") as stream:
                stream.write(replacement)
                stream.flush()
                os.fsync(stream.fileno())
            now = os.stat(path, follow_symlinks=False)
            if (now.st_ino, now.st_size, now.st_mtime_ns) != (
                before.st_ino, before.st_size, before.st_mtime_ns
            ):
                return result("conflict", reason="file changed during edit", sha256=actual)
            with open(path, "rb") as stream:
                if digest(stream.read(MAX_FILE + 1)) != actual:
                    return result("conflict", reason="file content changed during edit")
            os.replace(temporary, path)
            temporary = None
            return result(
                "applied", path=str(path.relative_to(root)),
                before_sha256=actual, after_sha256=digest(replacement),
            )
        finally:
            if temporary is not None:
                os.unlink(temporary)
    finally:
        os.close(fd)


def main():
    if len(sys.argv) != 2:
        raise ValueError("usage: safe_edit.py ROOT < request.json")
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        raise ValueError("root is not a directory")
    request = json.load(sys.stdin)
    if not isinstance(request, dict):
        raise ValueError("request must be a JSON object")
    print(json.dumps(apply(root, request), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (KeyError, OSError, UnicodeError, ValueError) as error:
        print(json.dumps(result("error", reason=str(error)), ensure_ascii=False))
        raise SystemExit(2)
