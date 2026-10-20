"""HTTP boundary tests: child-engine management must stay behind Hub control."""
from contextlib import contextmanager
from http.client import HTTPConnection
import importlib.util
import json
from pathlib import Path
import threading
import unittest

spec = importlib.util.spec_from_file_location('v100_gateway', Path(__file__).with_name('gateway.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class RecordingManager:
    token = 'fixture-control-key'
    models = {'fixture-model': {'agents': ['opencode', 'pi'], 'context_window': 4096}}
    proc = type('Alive', (), {'poll': lambda self: None})()

    def __init__(self):
        self.forwarded = []

    def snapshot(self):
        return {'ready': True, 'phase': 'ready', 'active_model': 'fixture-model'}

    def select(self, model, agent):
        return self.snapshot()

    @contextmanager
    def lease(self, model, agent):
        if model != 'fixture-model':
            raise gateway.Refusal(409, 'Wrong fixture model')
        yield


class RecordingHandler(gateway.Handler):
    def proxy(self, raw, watch_disconnect=False):
        self.server.manager.forwarded.append((self.command, self.path))
        self.json(200, {'forwarded': True})

    def log_message(self, *args):
        pass


class GatewayRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manager = RecordingManager()
        cls.server = gateway.Server(('127.0.0.1', 0), RecordingHandler)
        cls.server.manager = cls.manager
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(3)

    def call(self, method, path, headers=None, body=None):
        self.manager.forwarded.clear()
        conn = HTTPConnection(*self.server.server_address, timeout=3)
        try:
            conn.request(method, path, json.dumps(body or {'model': 'fixture-model'}) if method == 'POST' else None,
                         {'Content-Type': 'application/json', **(headers or {})})
            response = conn.getresponse()
            response.read()
            return response.status, list(self.manager.forwarded)
        finally:
            conn.close()

    def test_standard_inference_keeps_forwarding(self):
        for path in ('/v1/chat/completions', '/v1/responses', '/v1/messages',
                     '/v1/completions', '/v1/messages/count_tokens',
                     '/v1/responses/input_tokens', '/v1/responses/compact',
                     '/v1/embeddings', '/v1/rerank', '/v1/reranking', '/v1/score',
                     '/v1/tokenize', '/v1/detokenize', '/v1/apply-template', '/v1/infill',
                     '/v1/chat/completions?trace=fixture'):
            with self.subTest(path=path):
                status, forwarded = self.call('POST', path)
                self.assertEqual(status, 200)
                self.assertEqual(forwarded, [('POST', path)])

    def test_native_model_mutation_never_reaches_child(self):
        for path in ('/v1/models/fixture-model/suspend', '/v1/models/fixture-model/resume',
                     '/v1/v1/models/fixture-model/suspend', '/v1/models/unload',
                     '/v1/models/fixture-model/suspend?model=fixture-model'):
            with self.subTest(path=path):
                status, forwarded = self.call('POST', path)
                self.assertEqual(status, 404)
                self.assertFalse(forwarded)

    def test_unsupported_native_management_reads_are_not_proxied(self):
        status, forwarded = self.call('GET', '/v1/models/fixture-model/residency')
        self.assertEqual(status, 404)
        self.assertFalse(forwarded)

    def test_hub_control_still_requires_its_credential(self):
        status, forwarded = self.call('POST', '/v1/model-control/select')
        self.assertEqual(status, 401)
        self.assertFalse(forwarded)
        status, forwarded = self.call('POST', '/v1/model-control/select',
                                      {'Authorization': 'Bearer ' + self.manager.token})
        self.assertEqual(status, 200)
        self.assertFalse(forwarded)

    def test_model_gate_still_runs_before_inference(self):
        status, forwarded = self.call('POST', '/v1/chat/completions', body={'model': 'other'})
        self.assertEqual(status, 409)
        self.assertFalse(forwarded)

    def test_public_catalog_and_health_remain_available(self):
        for path in ('/v1/models', '/health'):
            status, forwarded = self.call('GET', path)
            self.assertEqual(status, 200)
            self.assertFalse(forwarded)

    def test_read_only_inference_diagnostics_remain_available(self):
        for path in ('/v1/props', '/v1/load', '/v1/stats', '/v1/slots', '/v1/metrics'):
            status, forwarded = self.call('GET', path)
            self.assertEqual(status, 200)
            self.assertTrue(forwarded)

    def test_response_reads_and_cancellation_remain_scoped(self):
        for method, path in (('GET', '/v1/responses/resp_fixture'),
                             ('GET', '/v1/responses/resp_fixture/input_items'),
                             ('POST', '/v1/responses/resp_fixture/cancel')):
            status, forwarded = self.call(method, path)
            self.assertEqual(status, 200)
            self.assertTrue(forwarded)


if __name__ == '__main__':
    unittest.main()
