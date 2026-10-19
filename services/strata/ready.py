"""Boot readiness for the VM-owned Strata service; never sends inference."""
import json
import os
import time
import urllib.request

MODEL = "qwen38-flash-next"
ORIGIN = "http://127.0.0.1:1920"


def ready(health, models):
    return (health.get("status") == "ok" and health.get("loaded") is True
            and health.get("model") == MODEL and health.get("max_context") == 262144
            and any(m.get("id") == MODEL for m in models.get("data", [])))


def main():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    key = os.environ["STRATA_API_KEY"]
    deadline = time.monotonic() + 540
    while time.monotonic() < deadline:
        try:
            def get(path):
                req = urllib.request.Request(ORIGIN + path, headers={"Authorization": "Bearer " + key})
                with opener.open(req, timeout=4) as response:
                    return json.load(response)
            if ready(get("/health"), get("/v1/models")):
                print("Strata ready: exact model, native262144, loaded; no inference probe")
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise SystemExit("Strata did not become ready within the startup deadline")


if __name__ == "__main__":
    main()
