import importlib.util,json,tempfile,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('hub',Path(__file__).parents[1]/'server.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class ProjectMemory(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.h=m.Hub(Path(self.tmp.name));self.a=self.h.authenticate(self.h.provision('Mac','macos')['token']);self.b=self.h.authenticate(self.h.provision('Windows','windows')['token']);self.project=str(uuid.uuid4());self.call({'action':'project','id':self.project,'title':'Project'})
 def tearDown(self):self.tmp.cleanup()
 def call(self,body,actor=None):return self.h.api('POST','/api/memory',{},actor or self.a,body)
 def page(self):return self.h.api('GET','/api/memory',{'project':[self.project]},self.b,{})
 def source(self,revision=1,accepted=True):return {'anchor':'a'*64,'revision':revision,'digest':('b' if revision==1 else 'c')*64,'accepted':accepted,'engine':'pi'}
 def entry(self):return {'id':str(uuid.uuid4()),'project':self.project,'kind':'fact','title':'Build','text':'Use documented build','source':self.source(),'expiresAt':int(time.time()*1000)+86400000}
 def save(self,e,expected=None):return self.call({'action':'save','expected':expected,'entry':e})
 def review(self,e,action='approve',actor=None):return self.call({'action':action,'id':e['id'],'expected':e['revision']},actor)
 def test_explicit_ids_do_not_merge_names_and_reject_private_identity_fields(self):
  other=str(uuid.uuid4());self.call({'action':'project','id':other,'title':'Project'});self.assertEqual(len(self.page()['projects']),2)
  for body in [{'action':'project','id':str(uuid.uuid4()),'title':'/Users/owner/repo'}, {'action':'project','id':str(uuid.uuid4()),'title':'Project','remote':'https://user:pass@host/repo'}]:
   with self.assertRaises(m.Fault):self.call(body)
  self.assertEqual(self.call({'action':'project','id':self.project,'title':'Project'})['id'],self.project)
 def test_candidate_requires_separate_owner_review_and_records_actual_reviewer(self):
  e=self.save(self.entry());self.assertEqual(e['state'],'candidate');approved=self.review(e,actor=self.b);self.assertEqual(approved['state'],'approved');self.assertEqual(approved['sourceDevice'],self.a['id'])
  with self.h.connection() as c:self.assertEqual(c.execute('SELECT device FROM memory_versions WHERE id=? ORDER BY revision DESC',(e['id'],)).fetchone()[0],self.b['id'])
  self.assertEqual(self.page()['entries'][0],approved)
 def test_concurrent_edits_cannot_overwrite_and_edit_needs_new_approval(self):
  raw=self.entry();e=self.save(raw);approved=self.review(e);raw['text']='Updated fact';candidate=self.save(raw,approved['revision']);self.assertEqual(candidate['state'],'candidate')
  with self.assertRaises(m.Fault):self.save({**raw,'text':'stale overwrite'},approved['revision'])
  with self.assertRaises(m.Fault):self.review(approved)
  self.assertEqual(self.page()['entries'][0]['text'],'Updated fact')
 def test_source_changes_invalidate_and_old_notifications_do_not_resurrect(self):
  e=self.review(self.save(self.entry()));self.assertEqual(self.call({'action':'sources','sources':[self.source(2)]})['invalidated'],1)
  self.assertEqual(self.page()['entries'][0]['state'],'stale');self.call({'action':'sources','sources':[self.source()]});self.assertEqual(self.page()['entries'][0]['state'],'stale')
  with self.assertRaises(m.Fault):self.save(self.entry())
  self.assertEqual(self.call({'action':'sources','sources':[self.source(2)]})['invalidated'],0)
 def test_withdrawn_acceptance_invalidates_without_text_upload(self):
  e=self.save(self.entry());self.call({'action':'sources','sources':[self.source(2,False)]});self.assertEqual(self.page()['entries'][0]['state'],'stale')
  with self.assertRaises(m.Fault):self.review({**e,'revision':2})
 def test_source_ownership_isolated_across_devices(self):
  e=self.review(self.save(self.entry()));self.call({'action':'sources','sources':[self.source(2)]},self.b);self.assertEqual(self.page()['entries'][0]['state'],'approved')
  raw={k:e[k] for k in self.entry()};raw['text']='Different device';
  with self.assertRaises(m.Fault):self.call({'action':'save','expected':e['revision'],'entry':raw},self.b)
 def test_expiry_prevents_approval_and_excludes_old_approved_entry(self):
  raw=self.entry();e=self.save(raw)
  with patch.object(m._memory_module.time,'time',return_value=raw['expiresAt']/1000+1):
   with self.assertRaises(m.Fault):self.review(e)
  self.review(e)
  with patch.object(m._memory_module.time,'time',return_value=raw['expiresAt']/1000+1):self.assertEqual(self.page()['entries'][0]['state'],'expired')
 def test_invalid_batch_rolls_back_and_unaccepted_source_is_rejected(self):
  with self.assertRaises(m.Fault):self.call({'action':'sources','sources':[self.source(2),{**self.source(),'directory':'/secret'}]})
  with self.h.connection() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM memory_sources').fetchone()[0],0)
  with self.assertRaises(m.Fault):self.save({**self.entry(),'source':self.source(1,False)})
  with self.assertRaises(m.Fault):self.save({**self.entry(),'source':{**self.source(),'anchor':'/private'}})
 def test_filters_paths_and_known_secrets_without_changing_source_digest(self):
  raw=self.entry();raw['text']='Build /private/project/main.ts and D:\\work\\project\\main.ts password=verysecret https://person:verysecret@host/doc'
  e=self.save(raw);self.assertNotIn('verysecret',e['text']);self.assertNotIn('/private/project',e['text']);self.assertNotIn('D:\\work',e['text']);self.assertEqual(e['source']['digest'],raw['source']['digest']);self.assertNotIn('directory',json.dumps(e))
 def retrieve(self,query='Build',project=None,limit=5,budget=4096):
  return self.h.api('POST','/api/memory/retrieve',{},self.b,{'project':project or self.project,'query':query,'limit':limit,'budget':budget})
 def test_retrieval_only_current_approved_same_project_and_source(self):
  approved=self.review(self.save(self.entry()));candidate=self.save({**self.entry(),'source':{**self.source(),'anchor':'d'*64}})
  result=self.retrieve();self.assertEqual([e['id'] for e in result['results']],[approved['id']]);self.assertEqual(result['eligible'],1)
  self.assertIn('revision=2',result['results'][0]['href']);self.assertNotIn('sourceDevice',json.dumps(result));self.assertNotIn(candidate['id'],json.dumps(result))
  other=str(uuid.uuid4());self.call({'action':'project','id':other,'title':'Other'});self.assertEqual(self.retrieve(project=other)['results'],[])
  self.call({'action':'sources','sources':[self.source(2)]});self.assertEqual(self.retrieve()['results'],[])
 def test_retrieval_expiry_and_source_recheck(self):
  e=self.review(self.save(self.entry()))
  with patch.object(m._memory_module.time,'time',return_value=e['expiresAt']/1000+1):self.assertEqual(self.retrieve()['results'],[])
  with self.h.connection() as c:c.execute('UPDATE memory_sources SET accepted=0 WHERE device=?',(self.a['id'],))
  self.assertEqual(self.retrieve()['results'],[])
 def test_retrieval_unicode_ranking_whole_facts_and_wire_budget(self):
  for i in range(10):
   raw={**self.entry(),'title':'Сборка Windows' if i==0 else 'Заметка','text':'сборка '+('я'*1500 if i==1 else 'поддерживает русский язык'), 'source':{**self.source(),'anchor':format(i,'064x')}}
   self.review(self.save(raw))
  result=self.retrieve(query='СБОРКА',limit=2,budget=1500);self.assertEqual(result['results'][0]['title'],'Сборка Windows');self.assertLessEqual(len(result['results']),2)
  self.assertLessEqual(len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode()),1500);self.assertEqual(result['matched'],10);self.assertEqual(result['omitted'],10-len(result['results']))
  self.assertTrue(all(len(e['text'])<100 for e in result['results']));self.assertEqual(self.retrieve(query='unrelated')['results'],[])
 def test_retrieval_rejects_unbounded_or_private_selectors(self):
  for patch in [{'budget':8193},{'budget':True},{'limit':100},{'query':' '},{'query':'x'*257},{'directory':'/private'},{'project':'../../private'}]:
   with self.assertRaises(m.Fault):self.h.api('POST','/api/memory/retrieve',{},self.a,{'project':self.project,'query':'Build','limit':5,'budget':4096,**patch})
