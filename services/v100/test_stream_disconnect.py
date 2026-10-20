"""A closed client must not keep a model leased while the backend is prefilling."""
from http.server import BaseHTTPRequestHandler
from http.client import HTTPConnection
import json
import socket
import tempfile
import threading
import time
import unittest
from test_gateway_routes import gateway


class WaitingBackend(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()
        self.wfile.flush()
        if body.get('fixture_mode') == 'complete':
            payload = b'data: [DONE]\n\n'
            self.wfile.write(f'{len(payload):x}\r\n'.encode() + payload + b'\r\n0\r\n\r\n')
            self.wfile.flush()
            return
        self.connection.settimeout(.1)
        while not self.server.stop_fixture.is_set():
            try:
                if not self.connection.recv(1):
                    self.server.disconnected.set()
                    return
            except socket.timeout:
                continue
        self.close_connection = True

    def log_message(self, *_):
        pass


class StreamDisconnectTests(unittest.TestCase):
    def test_disconnect_releases_prefill_lease_without_waiting_for_first_token(self):
        with tempfile.TemporaryDirectory() as root:
            backend = gateway.Server(('127.0.0.1', 0), WaitingBackend)
            backend.stop_fixture = threading.Event()
            backend.disconnected = threading.Event()
            backend_worker = threading.Thread(target=backend.serve_forever, daemon=True)
            backend_worker.start()
            manager = gateway.Manager({'backend_port': backend.server_address[1], 'models': {
                'fixture': {'argv': ['/not-launched'], 'agents': ['pi']}}}, 'fixture-key', root)
            manager.proc = type('Alive', (), {'poll': lambda self: None})()
            manager.update(ready=True, phase='ready', active_model='fixture')
            server = gateway.Server(('127.0.0.1', 0), gateway.Handler)
            server.manager = manager
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            client = socket.create_connection(server.server_address, timeout=3)
            try:
                body = json.dumps({'model': 'fixture', 'stream': True}).encode()
                client.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: fixture\r\n'
                               b'X-Ninfer-Agent: pi\r\nContent-Length: ' + str(len(body)).encode()
                               + b'\r\n\r\n' + body)
                self.assertIn(b'200', client.recv(4096))
                self.assertEqual(manager.active, 1)
                client.close()
                self.assertTrue(backend.disconnected.wait(2), 'Upstream prefill socket stayed open')
                deadline = time.monotonic() + 2
                while manager.active and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertEqual(manager.active, 0, 'Canceled request still blocks model switching')
                # Real subsequent streams, including a second request on the
                # same keep-alive socket, remain usable after cancellation.
                followup = HTTPConnection(*server.server_address, timeout=3)
                try:
                    for _ in range(2):
                        followup.request('POST', '/v1/chat/completions',
                            json.dumps({'model': 'fixture', 'stream': True, 'fixture_mode': 'complete'}),
                            {'X-Ninfer-Agent': 'pi', 'Content-Type': 'application/json'})
                        response = followup.getresponse()
                        self.assertEqual(response.status, 200)
                        self.assertEqual(response.read(), b'data: [DONE]\n\n')
                finally:
                    followup.close()
                deadline = time.monotonic() + 2
                while manager.active and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertEqual(manager.active, 0)
            finally:
                client.close()
                backend.stop_fixture.set()
                server.shutdown()
                backend.shutdown()
                server.server_close()
                backend.server_close()
                worker.join(3)
                backend_worker.join(3)


if __name__ == '__main__':
    unittest.main()
