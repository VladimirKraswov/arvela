"""Installer protects existing user configuration and records backups."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import install


class InstallTest(unittest.TestCase):
    def test_apply_creates_backup_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "tools" / "repo_inspect.ts"
            target.parent.mkdir()
            baseline = Path(__file__).with_name("fixtures") / "repo_inspect.pre.ts"
            target.write_bytes(baseline.read_bytes())
            with patch.object(install, "current_sessions_idle", return_value=True):
                preview = install.install(root)
                self.assertFalse(preview["applied"])
                self.assertEqual(target.read_bytes(), baseline.read_bytes())
                applied = install.install(root, apply_changes=True)
            self.assertEqual(len(applied["changes"]), 6)
            backup = next(change["backup"] for change in applied["changes"]
                          if change["file"] == "tools/repo_inspect.ts")
            self.assertEqual(Path(backup).read_bytes(), baseline.read_bytes())
            self.assertEqual(install.install(root)["changes"], [])

    def test_unexpected_existing_config_and_busy_session_stop_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "agents" / "qwen-review.md"
            target.parent.mkdir()
            target.write_text("user-customized")
            with self.assertRaisesRegex(ValueError, "unexpected existing"):
                install.install(root, apply_changes=True)
            self.assertEqual(target.read_text(), "user-customized")
            target.unlink()
            with patch.object(install, "current_sessions_idle", return_value=False):
                with self.assertRaisesRegex(ValueError, "active sessions"):
                    install.install(root, apply_changes=True)
            self.assertFalse((root / "tools").exists())


if __name__ == "__main__":
    unittest.main()
