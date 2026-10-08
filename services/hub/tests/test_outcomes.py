import importlib.util,json,tempfile,time,unittest
from pathlib import Path
sp=importlib.util.spec_from_file_location('hub',Path(__file__).parents[1]/'server.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class Outcomes(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.h=m.Hub(Path(self.tmp.name));p=self.h.provision('Mac','macos');self.a=self.h.authenticate(p['token'])
 def tearDown(self):self.tmp.cleanup()
 def record(self,assessment=None):
  r={'engine':'pi','sessionId':'s','id':'u','role':'user','created':int(time.time()*1000),'text':'Fix save','tools':[]}
  if assessment is not None:r['assessment']=assessment
  return r
 def card(self,revision=1):return {'revision':revision,'goal':'Fix save','criteria':'Save/reopen','checks':[{'name':'save/reopen','status':'passed','evidence':'password=private'}],'notes':'Observed value','verdict':'accepted'}
 def detail(self):return self.h.api('GET','/api/sessions/'+m.digest('pi:s'),{},self.a,{})
 def test_idempotent_and_old_viewers_do_not_erase_owner_assessment(self):
  self.h.ingest(self.a,{'records':[self.record(self.card(2))]});self.h.ingest(self.a,{'records':[self.record(self.card(1)),self.record()]})
  cards=self.detail()['records'][0]['assessments'];self.assertEqual(len(cards),1);self.assertEqual(cards[0]['revision'],2);self.assertNotIn('private',json.dumps(cards))
 def test_each_device_has_separate_review_and_acceptance_is_not_dataset_approval(self):
  self.h.ingest(self.a,{'records':[self.record(self.card())]});p=self.h.provision('Windows','windows');b=self.h.authenticate(p['token']);card=self.card();card['verdict']='needs_work';self.h.ingest(b,{'records':[self.record(card)]})
  d=self.detail();self.assertEqual(len(d['records'][0]['assessments']),2);self.assertEqual(d['session']['verdict'],'unreviewed')
 def test_invalid_assessment_aborts_whole_batch(self):
  card=self.card();card['verdict']='automatic_success'
  with self.assertRaises(m.Fault):self.h.ingest(self.a,{'records':[self.record(),self.record(card)]})
  with self.h.connection() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM records').fetchone()[0],0)
 def test_text_retention_clears_evidence_and_metadata_retention_removes_card(self):
  r=self.record(self.card());r['created']=int((time.time()-200*86400)*1000);self.h.ingest(self.a,{'records':[r]});self.h.maintain();a=self.detail()['records'][0]['assessments'][0];self.assertEqual(a['goal'],'');self.assertEqual(a['checks'],[])

  r=self.record(self.card());r['id']='expired';r['created']=int((time.time()-800*86400)*1000);self.h.ingest(self.a,{'records':[r]});self.h.maintain()
  with self.h.connection() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM assessments WHERE record_id=?',(m.digest('pi:s:expired'),)).fetchone()[0],0)
