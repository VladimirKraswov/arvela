"""Native startup enum versions must not mislabel loading as finalization."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from test_gateway_routes import gateway


class StartupEventTests(unittest.TestCase):
    def manager(self, root, schema="ninfer-v1"):
        return gateway.Manager({"models": {"fixture": {
            "argv": ["/fixture/not-started"], "agents": ["pi"],
            "startup_schema": schema}}}, "fixture-key", root)

    def event(self, schema, phase, operation="owned", status=2):
        with tempfile.TemporaryDirectory() as root:
            manager = self.manager(root, schema)
            manager.update(operation_id="owned", phase="loading")
            read, write = os.pipe()
            with os.fdopen(write, "w") as stream:
                stream.write(json.dumps(dict(phase=phase, status=status,
                                             current=9, total=10, unit=1)) + "\n")
            manager._events(read, operation, schema)
            return manager.snapshot()

    def test_legacy_finalize(self):
        state = self.event("ninfer-v1", 12)
        self.assertEqual(state["phase"], "warming")
        self.assertEqual(state["loader"]["phase"], "finalize")

    def test_new_prefix_cache_is_not_finalize(self):
        state = self.event("ninfer-v1.6", 12)
        self.assertEqual(state["phase"], "loading")
        self.assertEqual(state["loader"], dict(phase="prefix_cache", current=9,
                                                total=10, unit="bytes"))
        state = self.event("ninfer-v1.6", 13)
        self.assertEqual(state["phase"], "warming")
        self.assertFalse(state["ready"])

    def test_old_operation_and_invalid_phase_do_not_change_status(self):
        for schema, phase, operation in (("ninfer-v1.6", 13, "previous"),
                                          ("ninfer-v1.6", -1, "owned"),
                                          ("ninfer-v1", 13, "owned")):
            state = self.event(schema, phase, operation)
            self.assertEqual(state["phase"], "loading")
            self.assertIsNone(state["loader"])

    def test_unknown_schema_fails_before_starting_child(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                self.manager(root, "future-unknown")


if __name__ == "__main__":
    unittest.main()
