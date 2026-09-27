#!/usr/bin/env python3
"""Reproduce accepted incident tests from immutable Git revisions, without inference."""

import argparse
import io
import json
import subprocess
import tarfile
import tempfile
from pathlib import Path


CASES = Path(__file__).with_name("cases.json")


def run(argv, cwd, timeout=120):
    return subprocess.run(argv, cwd=cwd, text=True, capture_output=True,
                          timeout=timeout, check=False)


def contents(repo, revision, path):
    result = subprocess.run(["git", "-C", str(repo), "show", f"{revision}:{path}"],
                            capture_output=True, check=True)
    return result.stdout


def export_revision(repo, revision, destination):
    result = subprocess.run(["git", "-C", str(repo), "archive", "--format=tar", revision],
                            capture_output=True, check=True)
    with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
        for member in archive:
            relative = Path(member.name)
            if relative.is_absolute() or ".." in relative.parts or member.issym() or member.islnk():
                raise ValueError(f"unsafe archive entry: {member.name}")
            archive.extract(member, destination, filter="data")


def evaluate_case(case, repo, revision, timeout):
    test = case["test"]
    with tempfile.TemporaryDirectory(prefix="opencode-eval-") as temp:
        fixture = Path(temp)
        export_revision(repo, revision, fixture)
        target = fixture / test
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(contents(repo, case["accepted"], test))
        dependencies = repo / "node_modules"
        if not dependencies.is_dir():
            raise ValueError("run npm install in the source repository before replay")
        (fixture / "node_modules").symlink_to(dependencies, target_is_directory=True)
        command = [str(dependencies / ".bin" / "vitest"), "run", test]
        result = run(command, fixture, timeout=timeout)
        return {
            "revision": revision,
            "passed": result.returncode == 0,
            "exit_code": result.returncode,
            "output_tail": (result.stdout + "\n" + result.stderr)[-1800:],
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--case", help="One case ID; default is every case")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    repo = args.repo.resolve()
    if not (repo / ".git").exists():
        parser.error("--repo must be the Git repository, not a fixture")
    selected = [c for c in json.loads(CASES.read_text())
                if c["repository"] == repo.name and
                (args.case is None or c["id"] == args.case)]
    if not selected:
        parser.error("unknown case ID for this repository")
    reports = []
    for case in selected:
        for revision in (case["base"], case["accepted"]):
            check = run(["git", "rev-parse", "--verify", "--quiet", revision], repo)
            if check.returncode:
                parser.error(f"missing revision {revision} for {case['id']}")
        base = evaluate_case(case, repo, case["base"], args.timeout)
        accepted = evaluate_case(case, repo, case["accepted"], args.timeout)
        reports.append({"id": case["id"], "base": base, "accepted": accepted,
                        "valid_discriminator": not base["passed"] and accepted["passed"]})
    print(json.dumps(reports, ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(r["valid_discriminator"] for r in reports) else 1)


if __name__ == "__main__":
    main()
