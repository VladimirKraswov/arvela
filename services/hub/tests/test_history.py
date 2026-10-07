import json, unittest
import test_hub
m = test_hub.m

class History(unittest.TestCase):
    setUp = test_hub.Store.setUp
    tearDown = test_hub.Store.tearDown
    record = test_hub.Store.record
    def test_redaction_is_idempotent(self):
        cases = ['password=hidden', 'apiKey: sk-abcdefghijk', 'Bearer secret-token',
                 'https://host/?token=hidden&x=1', 'https://user:pass@host',
                 'пароль: значение /Users/owner/file', 'C:\\Users\\owner\\file']
        for raw in cases:
            once = m.scrub(raw)
            self.assertEqual(m.scrub(once), once)
            self.assertEqual(m.scrub(m.scrub(once)), once)

    def test_session_pages_with_timestamp_ties(self):
        for i in range(120):
            self.h.ingest(self.a, {'records': [self.record(sessionId=f's{i:03}', id='x', created=100, completed=200)]})
        seen, cursor = [], None
        while True:
            d = self.h.api('GET', '/api/sessions', {'limit':['37'], **({'cursor':[cursor]} if cursor else {})}, self.a, {})
            seen += [s['id'] for s in d['sessions']]
            cursor = d['nextCursor']
            if not cursor: break
        self.assertEqual(len(seen), 120)
        self.assertEqual(len(set(seen)), 120)
        with self.assertRaises(m.Fault) as e:
            self.h.api('GET', '/api/sessions', {'cursor':['broken']}, self.a, {})
        self.assertEqual(e.exception.status, 400)

    def test_long_session_reaches_final_answer(self):
        for start in range(0, 1050, 50):
            self.h.ingest(self.a, {'records':[self.record(id=f'm{i:04}', created=100+i, completed=200+i) for i in range(start,start+50)]})
        path='/api/sessions/'+m.digest('pi:session')
        seen, cursor = [], None
        while True:
            d=self.h.api('GET',path,{'limit':['73'],**({'cursor':[cursor]} if cursor else {})},self.a,{})
            seen += [r['source_id'] for r in d['records']]
            cursor=d['nextCursor']
            if not cursor:break
        self.assertEqual(set(seen),{f'm{i:04}' for i in range(1050)})
        self.assertEqual(len(seen),1050)
        self.assertEqual(d['total'],1050)
        latest=self.h.api('GET',path,{'direction':['older']},self.a,{})
        self.assertEqual(latest['records'][-1]['source_id'],'m1049')
        previous=self.h.api('GET',path,{'direction':['older'],'cursor':[latest['nextCursor']]},self.a,{})
        self.assertLess(previous['records'][-1]['created'],latest['records'][0]['created'])
        with self.assertRaises(m.Fault):
            self.h.api('GET',path,{'direction':['newer'],'cursor':[latest['nextCursor']]},self.a,{})

    def test_diagnostics_separates_refusal_from_failure(self):
        steps=[{'id':'1','name':'bash','status':'error','error':'The user has specified a rule which prevents you from using this specific tool call.'},
               {'id':'2','name':'edit','status':'error','error':'Could not find oldString in the file.'},
               {'id':'3','name':'task','status':'error','error':'Task cancelled'},
               {'id':'4','name':'bash','status':'completed','durationMs':100}]
        self.h.ingest(self.a,{'records':[self.record(tools=steps),self.record(id='other',error='This model is not available in your country.')]})
        d=self.h.api('GET','/api/diagnostics',{},self.a,{})
        self.assertEqual(d['tools'],4)
        self.assertEqual(d['toolErrors'],3)
        self.assertEqual(d['agentErrors'],1)
        groups={g['category']:g for g in d['groups']}
        self.assertEqual(groups['permission']['count'],1)
        self.assertEqual(groups['edit_conflict']['count'],1)
        self.assertEqual(groups['cancelled']['count'],1)
        self.assertEqual(groups['provider_restriction']['count'],1)
        self.assertEqual(groups['permission']['review'],False)
        self.assertEqual(groups['edit_conflict']['review'],True)
        self.assertEqual(groups['edit_conflict']['sessions'][0]['id'],m.digest('pi:session'))
        self.assertEqual(self.h.api('GET','/api/issues',{},self.a,{})['issues'][0]['state'],'candidate')

    def test_classification_does_not_turn_ambiguous_input_into_retry(self):
        category=m.classify_error('internal output mismatch; the tool may have executed. Verify state before retrying.')
        self.assertEqual(category,'ambiguous_result')
        self.assertIn('результат',m.ERROR_CATEGORIES[category]['advice'])
        self.assertEqual(m.classify_error('Укажите точное окно из свежего наблюдения.'),'stale_target')
        self.assertEqual(m.classify_error('The write tool was called with invalid arguments: SchemaError(Missing key)'),'invalid_arguments')

if __name__=='__main__': unittest.main()
