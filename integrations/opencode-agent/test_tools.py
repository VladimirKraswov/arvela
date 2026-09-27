"""Behavioral checks for read-only mapping and conflict-safe editing."""

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import repo_inspect
import safe_edit


class AgentToolsTest(unittest.TestCase):
    def setUp(self):
        self.sandbox = tempfile.TemporaryDirectory()
        self.addCleanup(self.sandbox.cleanup)
        self.root = Path(self.sandbox.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        (self.root / "src").mkdir()
        (self.root / "tests").mkdir()
        (self.root / "src" / "planner.py").write_text(
            "def plan_step():\n    return 'READY'\n"
        )
        (self.root / "tests" / "test_planner.py").write_text(
            "from src.planner import plan_step\n"
        )

    def test_search_reports_location_without_echoing_matching_content(self):
        (self.root / ".local").mkdir()
        (self.root / ".local" / "receipt.txt").write_text("READY private")
        report = repo_inspect.inspect(self.root, query="READY")
        self.assertEqual(
            report["search"]["locations"],
            [{"path": "./src/planner.py", "line": 2}],
        )
        self.assertNotIn("return 'READY'", json.dumps(report))
        self.assertNotIn("receipt.txt", json.dumps(report))

    def test_file_snapshot_points_to_likely_tests(self):
        report = repo_inspect.inspect(self.root, file="src/planner.py")
        self.assertEqual(
            report["file"]["sha256"],
            hashlib.sha256((self.root / "src" / "planner.py").read_bytes()).hexdigest(),
        )
        self.assertIn("tests/test_planner.py", report["file"]["matching_tests"])

    def test_file_snapshot_includes_nested_project_rules_and_manifest(self):
        (self.root / "AGENTS.md").write_text("root rules")
        (self.root / "src" / "AGENTS.md").write_text("source rules")
        (self.root / "src" / "package.json").write_text("{}")
        report = repo_inspect.inspect(self.root, file="src/planner.py")["file"]
        self.assertEqual(report["applicable_instructions"],
                         ["AGENTS.md", "src/AGENTS.md"])
        self.assertEqual(report["applicable_manifests"], ["src/package.json"])

    def test_related_test_is_found_by_import_even_when_name_differs(self):
        (self.root / "tests" / "test_safety.py").write_text(
            "from src.planner import plannerClass\n"
        )
        (self.root / "src" / "plannerClass.py").write_text("class plannerClass: pass\n")
        report = repo_inspect.inspect(self.root, file="src/plannerClass.py")["file"]
        self.assertIn("tests/test_safety.py", report["matching_tests"])

    def test_guarded_edit_preserves_unrelated_text_and_mode(self):
        path = self.root / "src" / "planner.py"
        path.chmod(0o640)
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        outcome = safe_edit.apply(
            self.root,
            {"path": "src/planner.py", "expected_sha256": before,
             "old": "'READY'", "new": "'DONE'"},
        )
        self.assertEqual(outcome["status"], "applied")
        self.assertEqual(path.read_text(), "def plan_step():\n    return 'DONE'\n")
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_stale_hash_or_ambiguous_match_never_writes(self):
        path = self.root / "src" / "planner.py"
        original = path.read_text()
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        path.write_text(original + "# changed by another actor\n")
        request = {"path": "src/planner.py", "expected_sha256": before,
                   "old": "READY", "new": "DONE"}
        self.assertEqual(safe_edit.apply(self.root, request)["status"], "conflict")
        self.assertEqual(path.read_text(), original + "# changed by another actor\n")

        text = "READY\nREADY\n"
        path.write_text(text)
        request["expected_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        outcome = safe_edit.apply(self.root, request)
        self.assertEqual((outcome["status"], outcome["occurrences"]), ("conflict", 2))
        self.assertEqual(path.read_text(), text)

    def test_path_escape_and_symlink_are_rejected(self):
        target = self.root / "src" / "planner.py"
        request = {"path": "../outside", "expected_sha256": "0" * 64,
                   "old": "x", "new": "y"}
        with self.assertRaises(ValueError):
            safe_edit.apply(self.root, request)
        (self.root / "linked").symlink_to(target)
        request["path"] = "linked"
        with self.assertRaises(ValueError):
            safe_edit.apply(self.root, request)
        with self.assertRaises(ValueError):
            repo_inspect.inspect(self.root, file="../outside")

    def test_hardlinked_file_is_not_replaced(self):
        source = self.root / "src" / "planner.py"
        linked = self.root / "src" / "another.py"
        linked.hardlink_to(source)
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        with self.assertRaises(ValueError):
            safe_edit.apply(self.root, {
                "path": "src/planner.py", "expected_sha256": before,
                "old": "READY", "new": "DONE",
            })
        self.assertIn("READY", source.read_text())


if __name__ == "__main__":
    unittest.main()
