#!/usr/bin/env python3
"""Bounded, read-only repository map for a coding agent.

No file contents are returned. The agent can use its normal read tool after
choosing a path/line, so an incidental secret in a matching line is not echoed.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


SKIP_DIRS = {".git", "node_modules", "target", "dist", "build", ".next", ".venv", ".local"}
MANIFESTS = (
    "package.json", "pnpm-lock.yaml", "package-lock.json", "pyproject.toml",
    "pytest.ini", "Cargo.toml", "go.mod", "Makefile", "justfile",
    "CMakeLists.txt",
)
INSTRUCTIONS = ("AGENTS.md", "CLAUDE.md", ".pi/TASK.md", ".opencode/TASK.md")


def command(args, root, timeout=8):
    try:
        result = subprocess.run(
            args, cwd=root, capture_output=True, text=True, errors="replace",
            timeout=timeout, check=False,
        )
        return result.returncode, result.stdout[:65536]
    except (OSError, subprocess.TimeoutExpired):
        return -1, ""


def git(root, *args):
    code, output = command(["git", "-C", str(root), *args], root)
    return {"exit_code": code, "lines": output.splitlines()[:80]}


def checked_file(root, value):
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("path must be relative to the selected repository")
    candidate = root / path
    if not candidate.resolve().is_relative_to(root):
        raise ValueError("path escapes the selected repository")
    if candidate.is_symlink() or not candidate.is_file():
        raise ValueError("path is not a regular repository file")
    return candidate


def matching_tests(root, stem):
    code, output = command(
        ["rg", "--files", "--hidden", "-g", "*test*", "-g", "*spec*",
         "-g", "!**/node_modules/**", "-g", "!**/target/**", "-g", "!**/.git/**",
         "-g", "!**/.local/**"],
        root,
    )
    if code not in (0, 1):
        return []
    names = [name for name in output.splitlines() if name]
    tokens = [token.lower() for token in re.split(r"[-_. ]+", stem) if len(token) >= 3]
    scored = []
    for name in names:
        lowered = name.lower()
        score = sum(token in lowered for token in tokens)
        if score:
            scored.append((-score, len(name), name))
    result = [name for _, _, name in sorted(scored)[:12]]
    if len(result) < 12 and len(stem) >= 4:
        code, output = command(
            ["rg", "-l", "-F", "--hidden", "--max-filesize", "2M",
             "-g", "!**/node_modules/**", "-g", "!**/target/**",
             "-g", "!**/.git/**", "-g", "!**/.local/**",
             "-g", "!**/*.lock", "--", stem, "."],
            root, timeout=12,
        )
        if code in (0, 1):
            for name in output.splitlines():
                normalized = name.removeprefix("./")
                lowered = normalized.lower()
                if ("test" in Path(normalized).name.lower() or
                        "spec" in Path(normalized).name.lower() or
                        "/__tests__/" in f"/{lowered}") and normalized not in result:
                    result.append(normalized)
                if len(result) == 12:
                    break
    return result


def applicable_files(root, target, names):
    """Show root-to-leaf guidance/manifests without reading their contents."""
    # pathlib parents includes '.'; de-duplicate it and add nested directories.
    directories = [root, *(root / part for part in reversed(target.parent.relative_to(root).parents)
                           if part != Path(".")), target.parent]
    found = []
    for directory in dict.fromkeys(directories):
        for name in names:
            path = directory / name
            if path.is_file() and not path.is_symlink():
                found.append(str(path.relative_to(root)))
    return found


def inspect(root, query=None, file=None):
    root = Path(root).resolve()
    report = {
        "root": str(root),
        "manifests": [name for name in MANIFESTS if (root / name).is_file()],
        "instructions": [name for name in INSTRUCTIONS if (root / name).is_file()],
        "top_level": sorted(
            entry.name for entry in os.scandir(root)
            if entry.is_dir(follow_symlinks=False) and entry.name not in SKIP_DIRS
        )[:60],
        "git_status": git(root, "status", "--short"),
        "diff_stat": git(root, "diff", "--stat"),
    }
    package = root / "package.json"
    if package.is_file() and not package.is_symlink() and package.stat().st_size < 1_000_000:
        try:
            data = json.loads(package.read_text())
            report["package_manager"] = data.get("packageManager")
            report["npm_script_names"] = sorted(data.get("scripts", {}))[:80]
        except (OSError, ValueError):
            report["manifest_error"] = "package.json could not be parsed"
    if query is not None:
        if not 2 <= len(query) <= 120 or "\n" in query or "\x00" in query:
            raise ValueError("query must be 2–120 characters on one line")
        code, output = command(
            ["rg", "-n", "-i", "-F", "--hidden", "--max-count", "1",
             "--max-filesize", "2M", "-g", "!**/node_modules/**",
             "-g", "!**/target/**", "-g", "!**/.git/**", "-g", "!**/.local/**",
             "-g", "!**/.env*", "-g", "!**/.opencode-migration/**",
             "-g", "!**/*.lock", "--", query, "."],
            root, timeout=12,
        )
        matches = []
        for line in output.splitlines():
            match = re.match(r"^(.+?):(\d+):", line)
            if match:
                matches.append({"path": match.group(1), "line": int(match.group(2))})
            if len(matches) == 24:
                break
        report["search"] = {
            "query": query, "exit_code": code, "locations": matches,
            "truncated": len(output) >= 65536 or len(matches) == 24,
        }
    if file is not None:
        target = checked_file(root, file)
        size = target.stat().st_size
        if size > 2_000_000:
            raise ValueError("file is too large for a guarded snapshot")
        content = target.read_bytes()
        report["file"] = {
            "path": str(target.relative_to(root)),
            "bytes": size,
            "sha256": hashlib.sha256(content).hexdigest(),
            "matching_tests": matching_tests(root, target.stem),
            "applicable_instructions": applicable_files(root, target, INSTRUCTIONS),
            "applicable_manifests": applicable_files(root, target, MANIFESTS),
        }
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--query")
    parser.add_argument("--file")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir():
        parser.error("root is not a directory")
    try:
        print(json.dumps(inspect(root, args.query, args.file), ensure_ascii=False))
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
