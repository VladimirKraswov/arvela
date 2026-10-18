import contextlib, io, json, unittest
from test_hub import m

class SafeHTTPLogging(unittest.TestCase):
    def test_parser_errors_never_log_request_body_as_status(self):
        handler = object.__new__(m.Handler)
        handler.command = None
        handler.path = '/api/login?token=private'
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            handler.log_message('code %d, message %s', 400, 'private-body-secret')
        self.assertNotIn('private', captured.getvalue())

    def test_request_log_keeps_only_safe_status_and_query_free_path(self):
        handler = object.__new__(m.Handler)
        handler.command = 'GET'
        handler.path = '/api/model-catalog?token=private'
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            handler.log_message('"%s" %s %s', 'GET /ignored HTTP/1.1', 200, 15)
        self.assertEqual(json.loads(captured.getvalue()), {'method':'GET','path':'/api/model-catalog','status':'200'})
