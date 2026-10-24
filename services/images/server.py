"""Enki CPU image worker. One resident OpenVINO pipeline; durable, bounded jobs."""
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import queue
import secrets
import sqlite3
import threading
import time
import uuid
import zipfile
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from runtime import PROFILES, resolve_profile
from procedural import resolve_surface
MODEL = "enki-image-auto"

class Material(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strength: float = Field(default=4.0, ge=0, le=16)
    blur: float = Field(default=1.0, ge=0, le=8)
    roughness: float = Field(default=0.7, ge=0, le=1)
    metallic: float = Field(default=0, ge=0, le=1)
    convention: str = 'opengl'
    tileable: bool = False
    invert_height: bool = False
    surface: str = 'auto'
    @model_validator(mode="after")
    def validate_material(self):
        if self.convention not in ('opengl','directx'): raise ValueError('convention: opengl/directx')
        if self.surface not in ('auto','image','brick','granite'): raise ValueError('surface: auto/image/brick/granite')
        return self

class Request(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=2000)
    model: str = MODEL
    width: int = Field(default=1024, ge=256, le=1536)
    height: int = Field(default=1024, ge=256, le=1536)
    steps: int = Field(default=4, ge=2, le=8)
    seed: int = Field(default=42, ge=0, le=2147483647)
    material: Material | None = None
    items: list[str] = Field(default_factory=list, max_length=8)
    @model_validator(mode="after")
    def validate_request(self):
        if not self.prompt.strip(): raise ValueError("Нужен непустой prompt")
        resolve_profile(self.model, self.prompt, self.material is not None)
        if self.width % 8 or self.height % 8 or self.width*self.height > 1048576:
            raise ValueError("Размеры кратны 8; не больше 1048576 пикселей")
        if self.model == 'lcm-dreamshaper-v7' and self.width*self.height > 640000:
            raise ValueError('Черновая LCM: не больше 640000 пикселей')
        if self.material and self.items: raise ValueError("Материал создаётся из одной согласованной текстуры")
        if any(not s.strip() or len(s)>160 for s in self.items):
            raise ValueError("Элементы набора: от 1 до 160 символов")
        return self

class Jobs:
    def __init__(self, root, generate, max_pending=8):
        self.root=Path(root); self.root.mkdir(parents=True, exist_ok=True)
        self.generate=generate; self.pending=queue.Queue(max_pending); self.lock=threading.RLock()
        self.db=sqlite3.connect(self.root/'jobs.sqlite', check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, key TEXT UNIQUE, fingerprint TEXT, body TEXT, result TEXT)')
        # A restart never silently repeats a generation whose result may have been delivered.
        for jid, raw in self.db.execute('SELECT id,result FROM jobs').fetchall():
            state=json.loads(raw)
            if state['status'] in ('queued','running'):
                state.update(status='interrupted', detail='Сервис перезапущен. Уже готовые изображения сохранены; создайте новое задание для оставшихся.')
                self.db.execute('UPDATE jobs SET result=? WHERE id=?',(json.dumps(state),jid))
        self.db.commit()
        self.ready=False; self.load_error=False
    def get(self, jid):
        with self.lock:
            row=self.db.execute('SELECT result FROM jobs WHERE id=?',(jid,)).fetchone()
            if not row: raise HTTPException(404,'Задание не найдено или удалено по сроку хранения')
            return json.loads(row[0])
    def update(self,jid,**fields):
        with self.lock:
            state=self.get(jid); state.update(fields)
            self.db.execute('UPDATE jobs SET result=? WHERE id=?',(json.dumps(state),jid));self.db.commit()
            return state
    def submit(self,body,key):
        if not key or len(key)>160: raise HTTPException(400,'Нужен Idempotency-Key (до 160 символов)')
        if not self.ready: raise HTTPException(503,'Модель загружается' if not self.load_error else 'Модель не загрузилась; проверьте журнал сервиса')
        # Adding an optional recipe must not invalidate old accepted request keys.
        raw=body.model_dump_json(exclude={'material':{'surface'}} if body.material and body.material.surface=='auto' else None); fingerprint=hashlib.sha256(raw.encode()).hexdigest()
        with self.lock:
            row=self.db.execute('SELECT id,fingerprint FROM jobs WHERE key=?',(key,)).fetchone()
            if row:
                if row[1]!=fingerprint: raise HTTPException(409,'Ключ уже использован с другими параметрами')
                return self.get(row[0])
            self.prune()
            count=self.db.execute('SELECT count(*) FROM jobs').fetchone()[0]
            if count>=200: raise HTTPException(507,'Хранилище изображений заполнено; удалите старые задания')
            if self.pending.full(): raise HTTPException(429,'Очередь генерации заполнена. Повторите позже с тем же ключом')
            selected=resolve_profile(body.model,body.prompt,body.material is not None)
            recipe=resolve_surface(body.material.surface,body.prompt) if body.material else None
            actual_steps=0 if recipe else PROFILES[selected]['steps'] or body.steps
            if recipe:selected='procedural-'+recipe+'-v1'
            jid=str(uuid.uuid4());state={'id':jid,'status':'queued','created':time.time(),'completed':0,'total':len(body.items) or 1,'step':0,'steps':actual_steps,'files':[],'width':body.width,'height':body.height,'model':selected}
            self.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?)',(jid,key,fingerprint,raw,json.dumps(state)));self.db.commit()
            self.pending.put_nowait((jid,body));return state
    def prune(self):
        import shutil
        for jid,raw in self.db.execute('SELECT id,result FROM jobs').fetchall():
            state=json.loads(raw)
            if state['status'] not in ('queued','running') and time.time()-state['created']>7*86400:
                shutil.rmtree(self.root/jid,ignore_errors=True);self.db.execute('DELETE FROM jobs WHERE id=?',(jid,))
        self.db.commit()
    def cancel(self,jid):
        with self.lock:
            state=self.get(jid)
            if state['status'] in ('queued','running'): return self.update(jid,status='cancelled',detail='Отменено; готовые файлы сохранены')
            return state
    def run(self):
        while True:
            jid,body=self.pending.get()
            try:
                if self.get(jid)['status']=='cancelled': continue
                folder=self.root/jid;folder.mkdir(exist_ok=True)
                self.update(jid,status='running',started=time.time());started=time.monotonic()
                def progress(step,steps,*_):
                    cancelled=self.get(jid)['status']=='cancelled'
                    if time.monotonic()-started>1200: raise TimeoutError('job deadline')
                    if not cancelled: self.update(jid,step=step+1,steps=steps)
                    return cancelled
                def phase(name, detail, **extra):
                    if self.get(jid)['status'] == 'cancelled': raise InterruptedError('cancelled')
                    if 'inference' in extra:
                        extra.update(model=extra['inference']['model'], steps=extra['inference']['steps'])
                    self.update(jid, phase=name, detail=detail, **extra)
                progress.phase = phase
                files=[]
                for index,item in enumerate(body.items or ['']):
                    if self.get(jid)['status']=='cancelled': break
                    prompt=body.prompt if not item else f'{item}. {body.prompt}'
                    self.update(jid,step=0)
                    image=self.generate(prompt,body,progress)
                    if self.get(jid)['status']=='cancelled': break
                    if body.material:
                        from materials import make_material
                        image.save(folder/'image-01.png')
                        files=[{'name':'image-01.png','label':'basecolor','seed':body.seed,'mime':'image/png'}]
                        self.update(jid,completed=1,files=files)
                        params=body.material.model_dump();params.pop('surface')
                        maps=make_material(image,**params,height_map=image.info.get('enki_height'))
                        files=[]
                        for name,output in maps.items():
                            output.save(folder/name)
                            files.append({'name':name,'label':'basecolor' if name=='image-01.png' else name[:-4],'seed':body.seed,'mime':'image/png'})
                            self.update(jid,completed=1,files=files)
                    else:
                        name=f'image-{index+1:02d}.png'; image.save(folder/name)
                        files.append({'name':name,'label':item or body.prompt,'seed':body.seed,'mime':'image/png'})
                    self.update(jid,completed=index+1,files=files)
                inference=self.get(jid).get('inference')
                manifest={'model':inference['model'] if inference else body.model,'engine':'OpenVINO GenAI CPU','request':body.model_dump(),'inference':inference,'files':files,'transparency':False,'vision_review':'pending: inspect returned images with a vision-capable agent'}
                if body.material: manifest.update(material=body.material.model_dump(),height_source=inference.get('height_source') if inference and inference.get('height_source') else 'Approximation from the base image luminance; not measured or recovered geometry',color_spaces={'image-01.png':'sRGB color','normal.png':'linear / non-color tangent normal','height.png':'linear 16-bit height','roughness.png':'linear roughness, NOT glossiness','metallic.png':'linear metallic'},preview='relight.png and relight-right.png use the selected normal convention under opposite side lights; tile-preview.png shows repetition when enabled')
                (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
                with zipfile.ZipFile(folder/'images.zip','w',compression=zipfile.ZIP_DEFLATED) as archive:
                    for name in [f['name'] for f in files]+['manifest.json']: archive.write(folder/name,name)
                if self.get(jid)['status']!='cancelled': self.update(jid,status='completed',phase='completed',detail='Изображения и архив готовы',finished=time.time(),seconds=round(time.monotonic()-started,2))
            except Exception:
                if self.get(jid)['status']!='cancelled': self.update(jid,status='error',detail='Ошибка генерации. Готовые файлы сохранены. Проверьте журнал сервиса; задание автоматически не повторяется.')
                import logging;logging.exception('Image worker failed for job %s',jid)
            finally: self.pending.task_done()

def create_app(jobs,token,load=None):
    if len(token)<32: raise ValueError('Set a private API token of at least 32 characters')
    def auth(authorization: str=Header(default='')):
        if not hmac.compare_digest(authorization,'Bearer '+token): raise HTTPException(401,'Нужен API-ключ генератора')
    @asynccontextmanager
    async def lifespan(app):
        def start():
            try:
                if load: load()
                jobs.ready=True; jobs.run()
            except Exception:
                jobs.load_error=True
                import logging;logging.exception('Image model load failed')
        threading.Thread(target=start,daemon=True).start()
        yield
    app=FastAPI(title='Enki CPU Images',lifespan=lifespan,dependencies=[Depends(auth)])
    @app.get('/health')
    def health(): return {'status':'ready' if jobs.ready else 'error' if jobs.load_error else 'loading','model':MODEL,'models':list(PROFILES),'material_surfaces':['auto','image','brick','granite'],'engine':'OpenVINO GenAI CPU','queue':jobs.pending.qsize(),'max_items':8,'max_pixels':1048576}
    @app.post('/jobs',status_code=202)
    def submit(body:Request,idempotency_key:str=Header(default='')): return jobs.submit(body,idempotency_key)
    @app.get('/jobs/{jid}')
    def status(jid:str): return jobs.get(jid)
    @app.delete('/jobs/{jid}')
    def cancel(jid:str): return jobs.cancel(jid)
    @app.get('/jobs/{jid}/files/{name}')
    def file(jid:str,name:str):
        state=jobs.get(jid)
        names=[f['name'] for f in state['files']]+['manifest.json','images.zip']
        if name not in names or '/' in jid or '\\' in jid or not (jobs.root/jid/name).is_file(): raise HTTPException(404,'Файл не готов')
        return FileResponse(jobs.root/jid/name,filename=name,media_type='image/png' if name.endswith('.png') else 'application/zip' if name.endswith('.zip') else 'application/json')
    @app.get('/jobs/{jid}/preview/{name}')
    def preview(jid:str,name:str):
        from PIL import Image
        from fastapi.responses import Response
        state=jobs.get(jid)
        if name not in [f['name'] for f in state['files']]: raise HTTPException(404,'Файл не готов')
        image=Image.open(jobs.root/jid/name)
        if image.mode.startswith('I'):
            import numpy as np
            image=Image.fromarray((np.asarray(image,dtype=np.float32)/257).clip(0,255).astype(np.uint8))
        image.thumbnail((256,256));output=io.BytesIO();image.save(output,format='PNG')
        return Response(output.getvalue(),media_type='image/png')
    @app.post('/v1/images/generations')
    def compatible(body:dict,idempotency_key:str=Header(default='')):
        # Compatibility path intentionally bounded; Enki uses asynchronous /jobs.
        allowed={'prompt','model','size','n','response_format','seed'}
        if set(body)-allowed or body.get('n',1)!=1 or body.get('response_format','b64_json')!='b64_json': raise HTTPException(400,'Поддерживаются n=1 и response_format=b64_json; для наборов используйте /jobs')
        try:
            width,height=map(int,body.get('size','512x512').split('x'))
            req=Request(prompt=body.get('prompt',''),model=body.get('model',MODEL),width=width,height=height,seed=body.get('seed',42))
        except (ValueError,TypeError): raise HTTPException(400,'Некорректный запрос изображения')
        state=jobs.submit(req,idempotency_key or secrets.token_hex(16)); end=time.monotonic()+600
        while state['status'] in ('queued','running') and time.monotonic()<end:
            time.sleep(.2);state=jobs.get(state['id'])
        if state['status']!='completed': raise HTTPException(503,{'job_id':state['id'],'status':state['status'],'detail':'Проверьте задание; не повторяйте POST автоматически'})
        return {'created':int(time.time()),'data':[{'b64_json':base64.b64encode((jobs.root/state['id']/state['files'][0]['name']).read_bytes()).decode()}]}
    return app

if __name__=='__main__':
    import uvicorn
    from PIL import Image
    from runtime import ImageRuntime
    def load():
        root=Path(os.getenv('IMAGE_MODELS_DIR','/opt/enki-images/models'))
        if any(not (root / p['folder'] / 'model_index.json').exists() for p in PROFILES.values() if p['folder']):
            raise RuntimeError('Quality models are not installed')
    jobs=Jobs(os.getenv('IMAGE_STATE_DIR','/var/lib/enki-images/jobs'),ImageRuntime())
    token=Path(os.environ['IMAGE_TOKEN_FILE']).read_text().strip()
    uvicorn.run(create_app(jobs,token,load),host='127.0.0.1',port=18084,log_level='warning')
