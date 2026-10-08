import unittest
import test_hub
m=test_hub.m
class TaskDiagnostics(unittest.TestCase):
    setUp=test_hub.Store.setUp
    tearDown=test_hub.Store.tearDown
    record=test_hub.Store.record
    def diagnostic(self, **kw):
        return dict(schema=1,source='observed',state='ended',usageComplete=False,
            **dict.fromkeys(('wallMs','queueMs','preparationMs','firstResponseMs','toolMs','reasoningMs','unattributedMs','retries','input','output','reasoning'),None),calls=2,failed=0,repeatedCalls=1,**kw)
    def test_numeric_only_and_replay_preserves_observation(self):
        d=self.diagnostic();d['wallMs']=4000
        r=self.record(role='user',diagnostics=d)
        self.h.ingest(self.a,{'records':[r]})
        self.h.ingest(self.a,{'records':[{**r,'diagnostics':{**d,'source':'history','wallMs':None}}]})
        rows=self.h.api('GET','/api/sessions/'+m.digest('pi:session'),{},self.a,{})['records']
        self.assertEqual(rows[0]['diagnostics'][0]['metrics']['wallMs'],4000)
        self.assertEqual(rows[0]['total'],0)
    def test_rejects_text_infinite_negative_and_wrong_anchor(self):
        for patch in ({'secret':'private'}, {'wallMs':float('inf')}, {'toolMs':-1}, {'calls':True}):
            with self.assertRaises(m.Fault):self.h.ingest(self.a,{'records':[self.record(role='user',diagnostics={**self.diagnostic(),**patch})]})
        with self.assertRaises(m.Fault):self.h.ingest(self.a,{'records':[self.record(role='assistant',diagnostics=self.diagnostic())]})
    def test_metadata_retention_removes_diagnostics(self):
        self.h.ingest(self.a,{'records':[self.record(role='user',created=1,diagnostics=self.diagnostic())]})
        self.h.maintain()
        with self.h.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM task_diagnostics').fetchone()[0],0)
