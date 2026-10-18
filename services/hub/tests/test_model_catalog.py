import importlib.util, json, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "hub", Path(__file__).parents[1] / "server.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def entry(mid="artemis31-v100", **kw):
    base = {
        "id": mid,
        "label": "Artemis 31B v1.2 (V100)",
        "opencode": {
            "providerId": "local-artemis",
            "name": "V100 · Artemis",
            "provider": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "V100 · Artemis",
                "options": {"baseURL": "http://127.0.0.1:18021/v1", "apiKey": "local"},
                "models": {
                    mid: {
                        "name": "Artemis",
                        "limit": {"context": 196608, "output": 16384},
                    }
                },
            },
        },
        "pi": {
            "providerId": "local-artemis",
            "provider": {
                "baseUrl": "http://127.0.0.1:18008/v1",
                "api": "openai-completions",
                "apiKey": "local",
                "headers": {"X-Ninfer-Agent": "pi"},
                "models": [
                    {
                        "id": mid,
                        "name": "Artemis",
                        "contextWindow": 196608,
                        "maxTokens": 16384,
                        "input": ["text"],
                    }
                ],
            },
        },
    }
    return {**base, **kw}


class ModelCatalog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.h = m.Hub(Path(self.tmp.name))
        self.a = self.h.authenticate(self.h.provision("Mac", "macos")["token"])
        self.admin = self.h.authenticate(
            self.h.provision("Owner", "other", True)["token"]
        )

    def tearDown(self):
        self.tmp.cleanup()

    def get(self):
        return self.h.api("GET", "/api/model-catalog", {}, self.a, {})

    def put(self, data, actor=None):
        return self.h.api("POST", "/api/model-catalog", {}, actor or self.admin, data)

    def test_empty_then_publish_roundtrip(self):
        self.assertEqual(self.get()["version"], 0)
        self.assertEqual(self.get()["models"], [])
        r = self.put({"models": [entry()]})
        self.assertEqual(r["version"], 1)
        self.assertEqual(r["updatedBy"], "Owner")
        d = self.get()
        self.assertEqual(d["version"], 1)
        self.assertEqual(d["models"][0]["id"], "artemis31-v100")
        self.assertEqual(
            d["models"][0]["pi"]["provider"]["headers"], {"X-Ninfer-Agent": "pi"}
        )
        self.assertEqual(
            json.loads((Path(self.tmp.name) / "model-catalog.json").read_text())[
                "version"
            ],
            1,
        )

    def test_republish_replaces_and_increments(self):
        self.put({"models": [entry()]})
        qwen, gemma = entry("qwen-next"), entry("gemma31-v100")
        for name in ("opencode", "pi"):
            qwen[name]["providerId"] = "local-qwen"
            gemma[name]["providerId"] = "local-gemma"
        r = self.put({"models": [qwen, gemma]})
        self.assertEqual(r["version"], 2)
        self.assertEqual(
            [x["id"] for x in self.get()["models"]], ["qwen-next", "gemma31-v100"]
        )

    def test_empty_catalog_clears(self):
        self.put({"models": [entry()]})
        r = self.put({"models": []})
        self.assertEqual(r["version"], 2)
        self.assertEqual(self.get()["models"], [])

    def test_admin_required(self):
        with self.assertRaises(m.Fault) as e:
            self.put({"models": [entry()]}, self.a)
        self.assertEqual(e.exception.status, 403)
        self.assertEqual(self.get()["version"], 0)

    def test_bad_entries_rejected(self):
        oc = entry()["opencode"]
        pi = entry()["pi"]
        for bad in [
            {"models": "x"},
            {"models": [{"id": "X", "label": "x", "pi": pi}]},
            {"models": [{"id": "a", "opencode": oc}]},
            {"models": [{"id": "a", "label": "A"}]},
            {"models": [entry(), entry()]},
            {"models": [{"id": "a", "label": "A", "junk": 1, "pi": pi}]},
            {
                "models": [
                    {"id": "a", "label": "A", "pi": {**pi, "providerId": "bad id"}}
                ]
            },
            {
                "models": [
                    {
                        "id": "a",
                        "label": "A",
                        "pi": {**pi, "provider": {**pi["provider"], "models": []}},
                    }
                ]
            },
        ]:
            with self.assertRaises(m.Fault):
                self.put(bad)
        for p in [
            {
                "providerId": "p",
                "provider": {"options": {"baseURL": "host/v1"}, "models": {"m": {}}},
            },
            {"providerId": "p", "provider": {"options": {}, "models": {"m": {}}}},
            {
                "providerId": "p",
                "provider": {"options": {"baseURL": "http://host/v1"}, "models": {}},
            },
            {
                "providerId": "p",
                "provider": {
                    "options": {"baseURL": "https://u:p@host/v1"},
                    "models": {"m": {}},
                },
            },
            {
                "providerId": "p",
                "provider": {
                    "options": {
                        "baseURL": "http://h/v1",
                        "apiKey": "sk-abcdefghij1234",
                    },
                    "models": {"m": {}},
                },
            },
        ]:
            with self.assertRaises(m.Fault):
                self.put({"models": [{"id": "a", "label": "A", "opencode": p}]})
        for p in [
            {
                "providerId": "p",
                "provider": {"api": "openai-completions", "models": [{"id": "m"}]},
            },
            {
                "providerId": "p",
                "provider": {"baseUrl": "http://h/v1", "models": [{"name": "m"}]},
            },
            {
                "providerId": "p",
                "provider": {
                    "baseUrl": "http://h/v1",
                    "headers": {"Authorization": "Bearer local1234567890"},
                    "models": [{"id": "m"}],
                },
            },
        ]:
            with self.assertRaises(m.Fault):
                self.put({"models": [{"id": "a", "label": "A", "pi": p}]})
if __name__ == "__main__":
        unittest.main()


class CatalogConcurrencyTests(unittest.TestCase):
    setUp = ModelCatalog.setUp
    tearDown = ModelCatalog.tearDown
    get = ModelCatalog.get
    put = ModelCatalog.put
    def test_stale_editor_cannot_overwrite_new_catalog(self):
        self.put({"models": [entry()], "expectedVersion": 0})
        with self.assertRaises(m.Fault) as error:
            self.put({"models": [], "expectedVersion": 0})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(len(self.get()["models"]), 1)

    def test_duplicate_provider_rejected_at_publication(self):
        with self.assertRaises(m.Fault):
            self.put({"models": [entry("one"), entry("two")]})
        self.assertEqual(self.get()["version"], 0)

    def test_inline_secret_without_known_prefix_is_rejected(self):
        value = entry()
        value["opencode"]["provider"]["options"]["apiKey"] = "owner-private-password-123456789"
        with self.assertRaises(m.Fault):
            self.put({"models": [value]})
        self.assertEqual(self.get()["version"], 0)
