import importlib.util, json, math, tempfile, time, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('hub',Path(__file__).parents[1]/'server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Store(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.h=m.Hub(Path(self.tmp.name));self.key=self.h.provision('Mac','macos');self.a=self.h.authenticate(self.key['token']);self.admin=self.h.authenticate(self.h.provision('Owner','other',True)['token'])
 def tearDown(self):self.tmp.cleanup()
 def record(self,**kw):return {'engine':'pi','sessionId':'session','id':'reply','role':'assistant','created':int(time.time()*1000),'completed':int(time.time()*1000)+100,'model':'actual-model','text':'OK','tokens':{'input':10,'output':20,'reasoning':12,'cacheRead':30},**kw}
 def test_redaction_and_numbers(self):
  s=m.scrub('apiKey: sk-abcdefghijk password=hello https://a:b@host/?token=hello /Users/private/file');self.assertNotIn('abcdefgh',s);self.assertNotIn('hello',s);self.assertNotIn('private',s);self.assertEqual(m.number(math.inf),0)
 def test_auth_and_revocation(self):
  with self.assertRaises(m.Fault):self.h.authenticate('wrong')
  self.h.api('POST','/api/devices/revoke',{},self.admin,{'id':self.a['id']})
  with self.assertRaises(m.Fault):self.h.authenticate(self.key['token'])
 def test_no_admin_for_device(self):
  with self.assertRaises(m.Fault) as e:self.h.api('POST','/api/devices',{},self.a,{})
  self.assertEqual(e.exception.status,403)
 def test_global_replay_and_actual_tokens(self):
  r=self.record();self.h.ingest(self.a,{'records':[r,r]});b=self.h.authenticate(self.h.provision('Windows','windows')['token']);self.h.ingest(b,{'records':[r]});x=self.h.metrics();self.assertEqual(x['totals']['total'],60);self.assertEqual(x['totals']['reasoning'],12);self.assertEqual(x['totals']['replies'],1);self.assertEqual(x['models'][0]['model'],'actual-model');self.assertEqual(self.h.metrics(b['id'])['totals']['total'],0)
 def test_completed_not_downgraded_and_atomic_batch(self):
  r=self.record(text='Complete result',tools=[{'id':'x','name':'browser','status':'error','error':'password=secret failed','durationMs':100}]);self.h.ingest(self.a,{'records':[r]});self.h.ingest(self.a,{'records':[self.record(completed=0,text='short',tokens={})]});sid=m.digest('pi:session');d=self.h.api('GET','/api/sessions/'+sid,{},self.a,{})['records'][0];self.assertEqual(d['text'],'Complete result');self.assertEqual(len(d['tools']),1);self.assertNotIn('secret',d['tools'][0]['error']);self.assertEqual(self.h.api('GET','/api/issues',{},self.a,{})['issues'][0]['occurrences'],1)
  with self.assertRaises(m.Fault):self.h.ingest(self.a,{'records':[self.record(id='other'),{'role':'bad'}]})
  self.assertEqual(self.h.metrics()['totals']['replies'],1)
 def test_catalog_hash_cas_and_paths(self):
  item={'id':'verify','kind':'skill','files':{'SKILL.md':'---\nname: verify\ndescription: Verify changes\n---\nRun relevant checks.'}}
  x=self.h.item(item);d=self.h.api('GET','/api/catalog/verify',{},self.a,{});self.assertEqual(d['hashes']['SKILL.md'],m.digest(item['files']['SKILL.md']))
  with self.assertRaises(m.Fault):self.h.item(item)
  item['expectedRevision']=x['revision'];self.assertEqual(self.h.item(item),x)
  for name in ['../secret','x/../s','/root','x\\s','x//s','a:bad']:
   with self.assertRaises(m.Fault):self.h.item({'id':'bad','kind':'prompt','files':{name:'bad'}})
  with self.assertRaises(m.Fault):self.h.item({'id':'secret','kind':'prompt','files':{'x':'z'*140000+' apiKey=hidden'}})
 def test_export_requires_review(self):
  self.h.ingest(self.a,{'records':[self.record()]});self.assertEqual(self.h.api('GET','/api/export',{},self.admin,{})['sessions'],0);self.h.api('POST','/api/sessions/review',{},self.admin,{'id':m.digest('pi:session'),'verdict':'approved'});self.assertEqual(self.h.api('GET','/api/export',{},self.admin,{})['sessions'],1)
 def test_retention_cleans_tool_errors(self):
  old=int((time.time()-200*86400)*1000);self.h.ingest(self.a,{'records':[self.record(created=old,completed=old+10,text='private',tools=[{'id':'c','name':'t','status':'error','error':'private error'}])]});self.h.maintain();d=self.h.api('GET','/api/sessions/'+m.digest('pi:session'),{},self.a,{})['records'][0];self.assertEqual(d['text'],'');self.assertEqual(d['tools'][0]['error'],'')
 def test_tool_spec_no_embedded_auth(self):
  for url in ['http://host','https://a:b@host','https://host?token=x','https://host#frag']:
   with self.assertRaises(m.Fault):self.h.item({'id':'tool','kind':'tool','files':{'tool.json':json.dumps({'kind':'http','url':url})}})
if __name__=='__main__':unittest.main()
