import importlib.util
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from fastapi.testclient import TestClient
import sys
sys.path.insert(0,str(Path(__file__).parents[1]))
spec=importlib.util.spec_from_file_location('enki_images',Path(__file__).parents[1]/'server.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class JobTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.jobs=module.Jobs(self.tmp.name,lambda *_:Image.new('RGB',(256,256),'blue'));self.jobs.ready=True
 def test_idempotency_preserves_one_job_and_rejects_changed_payload(self):
  req=module.Request(prompt='blue crystal');first=self.jobs.submit(req,'stable')
  self.assertEqual(self.jobs.submit(req,'stable')['id'],first['id']);self.assertEqual(self.jobs.pending.qsize(),1)
  with self.assertRaises(module.HTTPException) as cm:self.jobs.submit(module.Request(prompt='red crystal'),'stable')
  self.assertEqual(cm.exception.status_code,409)
 def test_queue_bound_and_cancel(self):
  for i in range(8):self.jobs.submit(module.Request(prompt='a'),'k'+str(i))
  with self.assertRaises(module.HTTPException) as cm:self.jobs.submit(module.Request(prompt='a'),'overflow')
  self.assertEqual(cm.exception.status_code,429)
  jid=self.jobs.pending.queue[0][0];self.assertEqual(self.jobs.cancel(jid)['status'],'cancelled')
 def test_accepted_job_reports_actual_distilled_steps_not_requested_draft_steps(self):
  state=self.jobs.submit(module.Request(prompt='anime portrait',steps=8),'quality-steps')
  self.assertEqual(state['model'],'sdxl-lightning');self.assertEqual(state['steps'],2)
 def test_restart_marks_interrupted_without_replaying(self):
  jid=self.jobs.submit(module.Request(prompt='a'),'key')['id'];other=module.Jobs(self.tmp.name,None)
  self.assertEqual(other.get(jid)['status'],'interrupted');self.assertTrue(other.pending.empty())
 def test_rejects_sizes_and_items_before_work(self):
  for params in [{'width':801},{'width':1536,'height':1536},{'model':'lcm-dreamshaper-v7','width':832,'height':832},{'model':'unknown'},{'items':['']},{'prompt':' '}]:
   with self.assertRaises(ValueError):module.Request(**({'prompt':'valid'}|params))
 def test_auth_and_traversal(self):
  app=module.create_app(self.jobs,'x'*32);client=TestClient(app)
  self.assertEqual(client.get('/health').status_code,401)
  self.assertEqual(client.get('/health',headers={'Authorization':'Bearer '+'x'*32}).status_code,200)
  self.assertEqual(client.get('/jobs/no/files/no',headers={'Authorization':'Bearer '+'x'*32}).status_code,404)
 def test_partial_outputs_survive_cancellation_during_inference(self):
  import threading,time,zipfile
  calls=[]
  jid=self.jobs.submit(module.Request(prompt='blue icons',items=['crystal','shield']),'partial')['id']
  def generate(*args):
   calls.append(1)
   if len(calls)==2:self.jobs.cancel(jid)
   args[2](0,4)
   return Image.new('RGB',(256,256),'blue')
  self.jobs.generate=generate
  threading.Thread(target=self.jobs.run,daemon=True).start()
  deadline=time.monotonic()+2
  while self.jobs.pending.unfinished_tasks and time.monotonic()<deadline:time.sleep(.01)
  state=self.jobs.get(jid);self.assertEqual(state['status'],'cancelled');self.assertEqual(len(state['files']),1)
  with zipfile.ZipFile(Path(self.tmp.name)/jid/'images.zip') as archive:self.assertEqual(archive.namelist(),['image-01.png','manifest.json'])
 def test_material_worker_exports_consistent_maps_and_manifest(self):
  import threading,time,zipfile,json
  jid=self.jobs.submit(module.Request(prompt='rough stone grain',material=module.Material(tileable=True,convention='directx')),'material')['id']
  threading.Thread(target=self.jobs.run,daemon=True).start();deadline=time.monotonic()+3
  while self.jobs.pending.unfinished_tasks and time.monotonic()<deadline:time.sleep(.01)
  state=self.jobs.get(jid);self.assertEqual(state['status'],'completed');self.assertEqual(len(state['files']),8)
  with zipfile.ZipFile(Path(self.tmp.name)/jid/'images.zip') as archive:
   self.assertIsNone(archive.testzip());manifest=json.loads(archive.read('manifest.json'));self.assertEqual(manifest['material']['convention'],'directx');self.assertIn('linear',manifest['color_spaces']['normal.png']);self.assertIn('relight-right.png',archive.namelist())
 def test_procedural_material_is_reported_honestly_and_exports_authored_relief(self):
  import threading,time,json
  from runtime import ImageRuntime
  self.jobs.generate=ImageRuntime()
  req=module.Request(prompt='regular red bricks',width=256,height=256,material=module.Material(surface='brick',tileable=True))
  accepted=self.jobs.submit(req,'recipe');self.assertEqual(accepted['model'],'procedural-brick-v1');self.assertEqual(accepted['steps'],0)
  threading.Thread(target=self.jobs.run,daemon=True).start();deadline=time.monotonic()+3
  while self.jobs.pending.unfinished_tasks and time.monotonic()<deadline:time.sleep(.01)
  state=self.jobs.get(accepted['id']);self.assertEqual(state['status'],'completed');self.assertEqual(len(state['files']),8)
  manifest=json.loads((Path(self.tmp.name)/accepted['id']/'manifest.json').read_text())
  self.assertEqual(manifest['height_source'],'authored procedural relief');self.assertEqual(manifest['inference']['model'],'procedural-brick-v1')
 def test_pre_recipe_idempotency_key_survives_added_auto_default(self):
  import hashlib,json
  legacy='{"prompt":"brick","model":"enki-image-auto","width":512,"height":512,"steps":4,"seed":42,"material":{"strength":4.0,"blur":1.0,"roughness":0.7,"metallic":0.0,"convention":"opengl","tileable":false,"invert_height":false},"items":[]}'
  self.jobs.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?)',('old','before-upgrade',hashlib.sha256(legacy.encode()).hexdigest(),legacy,json.dumps({'id':'old','status':'completed'})));self.jobs.db.commit()
  req=module.Request(prompt='brick',width=512,height=512,material=module.Material(metallic=0))
  self.assertEqual(self.jobs.submit(req,'before-upgrade')['id'],'old');self.assertTrue(self.jobs.pending.empty())
if __name__=='__main__':unittest.main()
