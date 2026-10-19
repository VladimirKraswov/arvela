"""Real nginx + isolated HTTP stub. No model, GPU, production listener or secret."""
import http.client
import importlib.util
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("gateway_config", Path(__file__).with_name("gateway_config.py"))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
NGINX = shutil.which("nginx") or ("/usr/sbin/nginx" if Path("/usr/sbin/nginx").exists() else None)


@unittest.skipUnless(NGINX, "nginx unavailable; run this integration suite on the service VM")
class Gateway(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.cleanup)
        root = Path(self.tmp.name)
        self.release = threading.Event()
        self.disconnected = threading.Event()
        self.seen = []
        owner = self
        class Stub(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                owner.seen.append((self.headers.get("Authorization"), self.headers.get("X-Api-Key")))
                if self.headers.get("X-Test-Broken"):
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    self.wfile.write(b'data: first\n\n'); self.wfile.flush()
                    owner.release.wait(3)
                    for _ in range(100):
                        self.wfile.write(b'x'*65536); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    owner.disconnected.set()
        self.backend = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        self.backend.daemon_threads = True
        self.thread = threading.Thread(target=self.backend.serve_forever, daemon=True); self.thread.start()
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0)); self.port = s.getsockname()[1]
        config = g.render(dict(listen="127.0.0.1", backendKey="a"*64, clientKeys=["local", "b"*64]))
        config = config.replace(":1919", ":"+str(self.port)).replace(":1920", ":"+str(self.backend.server_port))
        for old in ("/run/strata-gateway", "/var/log/strata-gateway", "/var/cache/strata-gateway"):
            config = config.replace(old, str(root))
        path = root/"nginx.conf"; path.write_text(config)
        self.log = (root/"process.log").open("w+")
        self.nginx = subprocess.Popen([NGINX, "-c", str(path), "-g", "daemon off;"], stdout=self.log, stderr=self.log)
        for _ in range(100):
            if self.nginx.poll() is not None:
                self.log.seek(0); self.fail("nginx failed: "+self.log.read())
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=.1): break
            except OSError: time.sleep(.02)
        else: self.fail("nginx did not listen")

    def cleanup(self):
        if hasattr(self,"release"): self.release.set()
        if hasattr(self,"nginx") and self.nginx.poll() is None:
            self.nginx.terminate(); self.nginx.wait(timeout=5)
        if hasattr(self,"backend"):
            self.backend.shutdown(); self.backend.server_close(); self.thread.join(2)
        if hasattr(self,"log"): self.log.close()
        self.tmp.cleanup()

    def request(self, path="/v1/chat/completions", **headers):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        c.request("POST", path, b'{}', headers)
        return c, c.getresponse()

    def test_stream_arrives_before_backend_finishes_and_disconnect_reaches_backend(self):
        c, r = self.request(Authorization="bearer local")
        try:
            self.assertEqual(r.status, 200)
            self.assertEqual(r.readline(), b'data: first\n')
            self.assertFalse(self.release.is_set())
            self.assertIsNone(r.getheader("Access-Control-Allow-Origin"))
            self.assertEqual(self.seen, [("Bearer "+"a"*64, None)])
        finally: r.close(); c.close(); self.release.set()
        self.assertTrue(self.disconnected.wait(3))

    def test_anonymous_and_management_are_rejected_without_upstream_call(self):
        for path, expected, headers in [("/v1/chat/completions",401,{}), ("/v1/unload",404,dict(Authorization="Bearer local")),
                                         ("/v1/chat/completions",401,dict(Authorization="Bearer LOCAL")),
                                         ("/config",404,dict(Authorization="Bearer "+"b"*64))]:
            c,r=self.request(path,**headers)
            try: self.assertEqual(r.status,expected); r.read()
            finally: r.close(); c.close()
        self.assertEqual(self.seen,[])

    def test_failed_post_is_not_replayed(self):
        c,r=self.request(Authorization="Bearer "+"b"*64, **{"X-Test-Broken":"1"})
        try: self.assertEqual(r.status,503); r.read()
        finally: r.close(); c.close()
        self.assertEqual(len(self.seen),1)


if __name__ == "__main__": unittest.main()
