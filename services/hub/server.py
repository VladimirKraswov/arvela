#!/usr/bin/env python3
"""Arvela's private, single-account LAN catalog and observability store.
No agent loop, inference, execution of uploaded files, or external reporting.
"""
from __future__ import annotations
import contextlib, math, argparse, hashlib, http.cookies, ipaddress, json, os, re, secrets, sqlite3, ssl, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlsplit

MAX_BODY = 2 * 1024 * 1024
KINDS = {'skill', 'prompt', 'tool', 'template', 'runbook'}
KEY = re.compile(r'^[a-z][a-z0-9-]{0,63}$')
SECRET = re.compile(r'\b(?:sk-|gh[pousr]_|github_pat_|hf_|xox[baprs]-)[A-Za-z0-9_-]{8,}')
ASSIGN = re.compile(r'''(?i)((?:api[_-]?key|password|passwd|pass|pas|pwd|пароль|API-ключ|access[_-]?token|refresh[_-]?token|secret|authorization|token)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;<>]+)''')

def scrub(value: object, limit: int = 16000) -> str:
    s = str(value or '')[:262144]
    s = re.sub(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)', '[PRIVATE KEY REMOVED]', s)
    s = SECRET.sub('[KEY REMOVED]', s)
    s = re.sub(r'(?i)\bBearer\s+[^\s"\']+', 'Bearer [KEY REMOVED]', s)
    s = ASSIGN.sub(r'\1[VALUE REMOVED]', s)
    s = re.sub(r'(https?://)[^/\s:@]+:[^/\s@]+@', r'\1[AUTH REMOVED]@', s)
    s = re.sub(r'([?&](?:key|token|api_key|password|secret|auth|signature)=)[^&#\s]+', r'\1[VALUE REMOVED]', s, flags=re.I)
    s = re.sub(r'(?i)(?:/Users/|/home/)[^/\s]+', '/home/[user]', s)
    s = re.sub(r'(?i)C:[\\/]Users[\\/][^\\/\s]+', r'C:/Users/[user]', s)
    return s[:limit]

def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def number(value):
    return min(9*10**15, max(0, int(value))) if isinstance(value, (int, float)) and math.isfinite(value) else 0

class Fault(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

class Hub:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = root / 'hub.sqlite'
        self.lock = threading.RLock()
        self.cookies = {}
        with self.connection() as c:
            c.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT, platform TEXT,
                app_version TEXT, token_hash TEXT UNIQUE, admin INTEGER DEFAULT 0, revoked INTEGER DEFAULT 0,
                created INTEGER, seen INTEGER);
            CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY, kind TEXT, title TEXT, description TEXT,
                revision TEXT, enabled INTEGER, created INTEGER, updated INTEGER);
            CREATE TABLE IF NOT EXISTS versions(item_id TEXT, revision TEXT, manifest TEXT, created INTEGER,
                PRIMARY KEY(item_id,revision));
            CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, engine TEXT, title TEXT, project TEXT,
                first_device TEXT, created INTEGER, updated INTEGER, verdict TEXT DEFAULT 'unreviewed', notes TEXT DEFAULT '');
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id),
                source_id TEXT, device_id TEXT, role TEXT, provider TEXT, model TEXT, variant TEXT,
                created INTEGER, completed INTEGER, input INTEGER, output INTEGER, cache_read INTEGER,
                cache_write INTEGER, reasoning INTEGER, total INTEGER, text TEXT, error TEXT, tools TEXT,
                finish TEXT, truncated INTEGER, updated INTEGER);
            CREATE INDEX IF NOT EXISTS records_date ON records(created);
            CREATE INDEX IF NOT EXISTS records_session ON records(session_id);
            CREATE INDEX IF NOT EXISTS records_device ON records(device_id);
            CREATE TABLE IF NOT EXISTS observations(record_id TEXT, device_id TEXT, seen INTEGER,
                PRIMARY KEY(record_id,device_id));
            CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY, title TEXT, tool TEXT, example TEXT,
                state TEXT DEFAULT 'candidate', created INTEGER, updated INTEGER);
            CREATE TABLE IF NOT EXISTS issue_hits(issue_id TEXT, record_id TEXT, session_id TEXT, call_id TEXT,
                PRIMARY KEY(issue_id,record_id,call_id));
            CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY, value TEXT);
            INSERT OR IGNORE INTO settings VALUES ('retention','{"textDays":180,"metadataDays":730}');
            ''')
        os.chmod(self.db, 0o600)

    @contextlib.contextmanager
    def connection(self):
        c = sqlite3.connect(self.db, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        try:
            with c:
                yield c
        finally:
            c.close()

    def provision(self, name, platform, admin=False):
        token, id_, now = secrets.token_urlsafe(40), str(uuid.uuid4()), int(time.time()*1000)
        with self.lock, self.connection() as c:
            c.execute('INSERT INTO devices VALUES (?,?,?,?,?,?,0,?,?)',
                (id_, scrub(name, 80), scrub(platform, 32), '', digest(token), int(admin), now, now))
        return {'id': id_, 'name': name, 'token': token, 'admin': admin}

    def authenticate(self, token):
        if not isinstance(token, str) or not 20 <= len(token) <= 256:
            raise Fault(401, 'Нужен ключ устройства или администратора.')
        with self.connection() as c:
            row = c.execute('SELECT * FROM devices WHERE token_hash=? AND revoked=0', (digest(token),)).fetchone()
        if not row:
            raise Fault(401, 'Неверный или отозванный ключ.')
        return dict(row)

    @staticmethod
    def admin(actor):
        if not actor['admin']:
            raise Fault(403, 'Нужен ключ администратора.')

    def item(self, data):
        id_, kind = data.get('id', ''), data.get('kind', '')
        if not isinstance(id_, str) or not KEY.fullmatch(id_) or kind not in KINDS:
            raise Fault(400, 'Проверьте идентификатор и вид записи.')
        files = data.get('files')
        if not isinstance(files, dict) or not 1 <= len(files) <= 128:
            raise Fault(400, 'Нужен текстовый пакет до128файлов.')
        clean = {}
        for name, content in files.items():
            p = PurePosixPath(name)
            if (not isinstance(content, str) or len(content.encode()) > 262144 or p.is_absolute()
                or any(part in {'', '.', '..'} for part in name.split('/')) or '\\' in name or ':' in name
                or len(name) > 240 or '\x00' in name or len(p.parts) > 8):
                raise Fault(400, 'Небезопасное имя или слишком большой текстовый файл.')
            # Catalog scripts are never executed here. Credentials must be installed per device.
            if scrub(content, 262144) != content:
                raise Fault(400, 'В пакете обнаружены секреты или персональные пути; удалите их перед публикацией.')
            clean[name] = content
        if len(encode(clean).encode()) > MAX_BODY//2:
            raise Fault(400, 'Пакет превышает1МиБ.')
        if kind == 'skill':
            skill = clean.get('SKILL.md', '')
            if len(skill.encode())>65536 or not skill.startswith('---\n') or '\n---' not in skill[4:]:
                raise Fault(400, 'SKILL.md: нужны YAML-заголовок и размер до64КиБ.')
            front=skill[4:].split('\n---',1)[0]
            if not re.search(r'^name:\s*["\']?'+re.escape(id_)+r'["\']?\s*$', front, re.M) or not re.search(r'^description:\s*\S', front, re.M):
                raise Fault(400, 'SKILL.md должен содержать name, совпадающий с id, и description.')
        if kind == 'tool':
            try:
                spec = json.loads(clean['tool.json'])
                if not isinstance(spec,dict) or set(spec)-{'kind','url','name','envKeys','bearer'}: raise ValueError()
                if not isinstance(spec.get('envKeys',[]),list) or len(spec.get('envKeys',[]))>32 or any(not isinstance(k,str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}',k) for k in spec.get('envKeys',[])): raise ValueError()
                if not isinstance(spec.get('bearer',False),bool): raise ValueError()
                if spec.get('kind') != 'http' or urlsplit(spec.get('url', '')).scheme != 'https':
                    raise ValueError()
                if any(key in spec for key in ('token', 'authorization', 'headers', 'password', 'env')):
                    raise ValueError()
                if not urlsplit(spec['url']).hostname or urlsplit(spec['url']).query or urlsplit(spec['url']).fragment or urlsplit(spec['url']).username or urlsplit(spec['url']).password:
                    raise ValueError()
            except (KeyError, ValueError, TypeError):
                raise Fault(400, 'tool.json: переносимый HTTPS MCP без ключей; секрет задаётся отдельно на устройстве.')
        manifest = {'id': id_, 'kind': kind, 'files': clean,
            'hashes': {name:digest(content) for name,content in sorted(clean.items())}}
        revision = digest(encode(manifest))
        now = int(time.time()*1000)
        with self.lock, self.connection() as c:
            old = c.execute('SELECT revision FROM catalog WHERE id=?', (id_,)).fetchone()
            if old and data.get('expectedRevision') != old['revision']:
                raise Fault(409, 'Запись уже изменена. Обновите каталог; чужая версия сохранена.')
            c.execute('INSERT OR IGNORE INTO versions VALUES (?,?,?,?)', (id_, revision, encode(manifest), now))
            c.execute('''INSERT INTO catalog VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                kind=excluded.kind,title=excluded.title,description=excluded.description,revision=excluded.revision,
                enabled=excluded.enabled,updated=excluded.updated''',
                (id_,kind,scrub(data.get('title',id_),160),scrub(data.get('description',''),2048),revision,
                 int(data.get('enabled',True)),now,now))
        return {'id': id_, 'revision': revision}

    def ingest(self, actor, data):
        records = data.get('records', [])
        if not isinstance(records, list) or len(records) > 50:
            raise Fault(400, 'Пакет должен содержать не больше50сообщений.')
        normalized = []
        now = int(time.time()*1000)
        for r in records:
            if not isinstance(r, dict) or r.get('role') not in {'user','assistant'} or r.get('engine') not in {'opencode','pi'}:
                raise Fault(400, 'Некорректное сообщение.')
            session, mid = r.get('sessionId'), r.get('id')
            if not all(isinstance(x, str) and 1 <= len(x) <= 512 for x in (session,mid)):
                raise Fault(400, 'Нужен идентификатор сессии и сообщения.')
            engine = r['engine']
            sid, rid = digest(engine+':'+session), digest(engine+':'+session+':'+mid)
            tools = []
            if not isinstance(r.get('tools', []), list): raise Fault(400, 'Некорректные шаги.')
            for tool in (r.get('tools') or [])[:128]:
                if not isinstance(tool,dict): raise Fault(400,'Некорректный шаг инструмента.')
                tools.append({'id':scrub(tool.get('id',''),160),'name':scrub(tool.get('name',''),160),
                    'status':tool.get('status') if tool.get('status') in {'pending','running','completed','error'} else 'unknown',
                    'durationMs':number(tool.get('durationMs')), 'error':scrub(tool.get('error',''),1500)})
            t = r.get('tokens') or {}
            if not isinstance(t,dict): raise Fault(400,'Некорректные счётчики.')
            input_, output = number(t.get('input')), number(t.get('output'))
            cache_read, cache_write = number(t.get('cacheRead')), number(t.get('cacheWrite'))
            total = max(number(t.get('total')),input_+output+cache_read+cache_write)
            if r['role']=='user': input_=output=cache_read=cache_write=total=0
            text = scrub(r.get('text',''))
            normalized.append((r,sid,rid,tools,text,input_,output,cache_read,cache_write,total))
        with self.lock, self.connection() as c:
            c.execute('UPDATE devices SET seen=?,app_version=? WHERE id=?', (now,scrub(data.get('appVersion',''),40),actor['id']))
            for r,sid,rid,tools,text,input_,output,cache_read,cache_write,total in normalized:
                created, completed = number(r.get('created')) or now, number(r.get('completed'))
                c.execute('''INSERT INTO sessions(id,engine,title,project,first_device,created,updated) VALUES (?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET updated=MAX(updated,excluded.updated),
                    title=CASE WHEN excluded.title!='' THEN excluded.title ELSE title END''',
                    (sid,r['engine'],scrub(r.get('title',''),180),scrub(r.get('project',''),100),actor['id'],created,max(created,completed)))
                values=(rid,sid,r['id'],actor['id'],r['role'],scrub(r.get('provider',''),160),scrub(r.get('model',''),160),
                    scrub(r.get('variant',''),64),created,completed,input_,output,cache_read,cache_write,
                    min(output,number((r.get('tokens') or {}).get('reasoning'))),total,text,scrub(r.get('error',''),1500),
                    encode(tools),scrub(r.get('finish',''),64),int(bool(r.get('truncated')) or len(str(r.get('text','')))>16000),now)
                # An older/partial viewer snapshot cannot downgrade a completed record or add tokens twice.
                c.execute('''INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET completed=MAX(completed,excluded.completed),
                    input=MAX(input,excluded.input),output=MAX(output,excluded.output),
                    cache_read=MAX(cache_read,excluded.cache_read),cache_write=MAX(cache_write,excluded.cache_write),
                    reasoning=MAX(reasoning,excluded.reasoning),total=MAX(total,excluded.total),
                    provider=CASE WHEN excluded.provider!='' THEN excluded.provider ELSE provider END,
                    model=CASE WHEN excluded.model!='' THEN excluded.model ELSE model END,
                    variant=CASE WHEN excluded.variant!='' THEN excluded.variant ELSE variant END,
                    finish=CASE WHEN excluded.finish!='' THEN excluded.finish ELSE finish END,
                    truncated=MAX(truncated,excluded.truncated),
                    text=CASE WHEN excluded.completed>=completed AND length(excluded.text)>=length(text) THEN excluded.text ELSE text END,
                    tools=CASE WHEN excluded.completed>=completed THEN excluded.tools ELSE tools END,
                    error=CASE WHEN excluded.error!='' THEN excluded.error ELSE error END,updated=excluded.updated''',values)
                c.execute('INSERT OR REPLACE INTO observations VALUES (?,?,?)',(rid,actor['id'],now))
                errors=[(x['name'],x['id'],x['error']) for x in tools if x['status']=='error' and x['error']]
                if r.get('error'): errors.append(('agent',r['id'],scrub(r['error'],1500)))
                for tool,call,error in errors:
                    pattern=re.sub(r'\b[0-9a-f]{12,}\b|\b\d+\b','[id]',error.lower())
                    iid=digest(tool+':'+pattern)
                    c.execute('''INSERT INTO issues(id,title,tool,example,created,updated) VALUES (?,?,?,?,?,?)
                        ON CONFLICT(id) DO UPDATE SET updated=excluded.updated''',
                        (iid,scrub(tool+': '+error,180),tool,error,now,now))
                    c.execute('INSERT OR IGNORE INTO issue_hits VALUES (?,?,?,?)',(iid,rid,sid,call))
        return {'accepted':len(records),'deviceId':actor['id']}

    def metrics(self, device=None, days=30):
        where='role="assistant" AND created>=?'
        args=[int((time.time()-days*86400)*1000)]
        if device: where+=' AND device_id=?';args.append(device)
        sums='SUM(input) input,SUM(output) output,SUM(cache_read) cacheRead,SUM(cache_write) cacheWrite,SUM(reasoning) reasoning,SUM(total) total,COUNT(*) replies'
        with self.connection() as c:
            totals=dict(c.execute('SELECT '+sums+' FROM records WHERE '+where,args).fetchone())
            models=[dict(x) for x in c.execute('''SELECT (SELECT engine FROM sessions WHERE id=session_id) engine,provider,model,variant,'''+sums+''',COUNT(DISTINCT session_id) sessions,
                SUM(CASE WHEN completed>created THEN completed-created ELSE 0 END) durationMs
                FROM records WHERE '''+where+' GROUP BY engine,provider,model,variant ORDER BY total DESC',args)]
            days_=[dict(x) for x in c.execute('SELECT date(created/1000,"unixepoch") day,SUM(total) total FROM records WHERE '+where+' GROUP BY day ORDER BY day',args)]
            counts={name:c.execute('SELECT COUNT(*) FROM '+name).fetchone()[0] for name in ('devices','sessions','records','catalog','issues')}
            tools=[dict(x) for x in c.execute('''SELECT json_extract(j.value,'$.name') name,COUNT(*) calls,
                SUM(json_extract(j.value,'$.status')='error') errors,SUM(json_extract(j.value,'$.durationMs')) durationMs
                FROM records,json_each(records.tools) j WHERE '''+where+' GROUP BY name ORDER BY calls DESC LIMIT50'.replace('LIMIT50','LIMIT 50'),args)]
        return {'totals':{k:v or 0 for k,v in totals.items()},'models':models,'days':days_,'counts':counts,'tools':tools,
            'attribution':'Первое устройство, загрузившее сообщение; повторные просмотры не прибавляют токены.',
            'reasoning':'Рассуждения входят в выходные токены и не прибавляются к итогу повторно.'}

    def api(self, method, path, query, actor, data):
        with self.connection() as c:
            if method=='GET' and path=='/api/me':
                return {k:actor[k] for k in ('id','name','platform','admin')}
            if method=='GET' and path=='/api/catalog':
                return {'items':[dict(x) for x in c.execute('SELECT * FROM catalog ORDER BY kind,title')]}
            if method=='GET' and path.startswith('/api/catalog/'):
                id_=path.split('/')[-1]
                rev=query.get('revision',[None])[0]
                if not rev:
                    row=c.execute('SELECT revision FROM catalog WHERE id=?',(id_,)).fetchone()
                    rev=row['revision'] if row else None
                row=c.execute('SELECT manifest FROM versions WHERE item_id=? AND revision=?',(id_,rev)).fetchone()
                if not row: raise Fault(404,'Пакет не найден.')
                return {**json.loads(row['manifest']),'revision':rev}
            if method=='POST' and path=='/api/catalog': self.admin(actor);return self.item(data)
            if method=='POST' and path=='/api/ingest': return self.ingest(actor,data)
            if method=='GET' and path=='/api/metrics':
                return self.metrics(query.get('device',[None])[0],min(730,max(1,int(query.get('days',['30'])[0]))))
            if method=='GET' and path=='/api/devices':
                return {'devices':[dict(x) for x in c.execute('SELECT id,name,platform,app_version,admin,revoked,created,seen FROM devices ORDER BY seen DESC')]}
            if method=='POST' and path=='/api/devices':
                self.admin(actor);return self.provision(data.get('name','Устройство'),data.get('platform','other'))
            if method=='POST' and path=='/api/devices/revoke':
                self.admin(actor)
                if data.get('id')==actor['id']:raise Fault(400,'Нельзя отозвать ключ, которым вы вошли.')
                c.execute('UPDATE devices SET revoked=1 WHERE id=?',(data.get('id'),));return {'ok':True}
            if method=='GET' and path=='/api/sessions':
                rows=c.execute('SELECT * FROM sessions ORDER BY updated DESC LIMIT 100').fetchall()
                return {'sessions':[dict(x) for x in rows]}
            if method=='GET' and path.startswith('/api/sessions/'):
                sid=path.split('/')[-1]
                row=c.execute('SELECT * FROM sessions WHERE id=?',(sid,)).fetchone()
                if not row:raise Fault(404,'Сессия не найдена.')
                records=[dict(x) for x in c.execute('SELECT * FROM records WHERE session_id=? ORDER BY created,id LIMIT 1000',(sid,))]
                for record in records:record['tools']=json.loads(record['tools'])
                return {'session':dict(row),'records':records,'limit':1000}
            if method=='POST' and path=='/api/sessions/review':
                self.admin(actor)
                if data.get('verdict') not in {'approved','rejected','unreviewed'}:raise Fault(400,'Неизвестная оценка.')
                c.execute('UPDATE sessions SET verdict=?,notes=? WHERE id=?',(data['verdict'],scrub(data.get('notes',''),2000),data.get('id')))
                return {'ok':True}
            if method=='GET' and path=='/api/issues':
                return {'issues':[dict(x) for x in c.execute('''SELECT i.*,COUNT(h.record_id) occurrences,
                    COUNT(DISTINCT h.session_id) sessions FROM issues i LEFT JOIN issue_hits h ON h.issue_id=i.id
                    GROUP BY i.id ORDER BY occurrences DESC LIMIT 100''')]}
            if method=='POST' and path=='/api/issues/review':
                self.admin(actor)
                if data.get('state') not in {'candidate','confirmed','ignored','resolved'}:raise Fault(400,'Неизвестный статус.')
                c.execute('UPDATE issues SET state=? WHERE id=?',(data['state'],data.get('id')));return {'ok':True}
            if method=='GET' and path=='/api/settings':
                return {'retention':json.loads(c.execute('SELECT value FROM settings WHERE id="retention"').fetchone()[0]),'schemaVersion':1}
            if method=='POST' and path=='/api/settings':
                self.admin(actor)
                keep={'textDays':min(730,max(1,number(data.get('textDays',180)))),'metadataDays':min(3650,max(1,number(data.get('metadataDays',730))))}
                if keep['metadataDays']<keep['textDays']:raise Fault(400,'Метаданные должны храниться не меньше текстов.')
                c.execute('UPDATE settings SET value=? WHERE id="retention"',(encode(keep),));return {'retention':keep}
            if method=='GET' and path=='/api/export':
                self.admin(actor)
                result=[]
                for s in c.execute('SELECT * FROM sessions WHERE verdict="approved" ORDER BY created LIMIT 500'):
                    records=[dict(r) for r in c.execute('SELECT * FROM records WHERE session_id=? ORDER BY created,id',(s['id'],))]
                    result.append({'session':dict(s),'messages':[{k:r[k] for k in ('role','text','provider','model','variant','input','output','reasoning','error','tools','created','completed','truncated')} for r in records],
                        'status':'reviewed-candidate','schemaVersion':1})
                if len(encode(result).encode()) > 6*1024*1024: raise Fault(413, 'Экспорт слишком большой. Сократите набор одобренных сессий.')
                return {'jsonl':'\n'.join(encode(x) for x in result),'sessions':len(result),'limit':500}
        raise Fault(404,'Неизвестный метод API.')

    def maintain(self):
        now=int(time.time()*1000)
        with self.lock, self.connection() as c:
            keep=json.loads(c.execute('SELECT value FROM settings WHERE id="retention"').fetchone()[0])
            cutoff=now-keep['textDays']*86400000
            for row in c.execute('SELECT id,tools FROM records WHERE created<?', (cutoff,)).fetchall():
                steps=json.loads(row['tools'])
                for step in steps: step['error']=''
                c.execute('UPDATE records SET text="",error="",tools=? WHERE id=?', (encode(steps),row['id']))
            c.execute('UPDATE sessions SET notes="",title="" WHERE updated<?',(cutoff,))
            c.execute('UPDATE issues SET example="",title=tool WHERE updated<?',(cutoff,))
            c.execute('DELETE FROM observations WHERE record_id IN (SELECT id FROM records WHERE created<?)',(now-keep['metadataDays']*86400000,))
            c.execute('DELETE FROM issue_hits WHERE record_id IN (SELECT id FROM records WHERE created<?)',(now-keep['metadataDays']*86400000,))
            c.execute('DELETE FROM records WHERE created<?',(now-keep['metadataDays']*86400000,))
            c.execute('DELETE FROM sessions WHERE NOT EXISTS (SELECT 1 FROM records WHERE session_id=sessions.id)')
        with self.connection() as c:
            c.execute('PRAGMA wal_checkpoint(TRUNCATE)')

class Server(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=32
    def __init__(self, address, hub, web):
        self.hub,self.web,self.slots=hub,web,threading.BoundedSemaphore(16)
        super().__init__(address, Handler)
    def verify_request(self,request,client_address):
        address=ipaddress.ip_address(client_address[0])
        return address.is_loopback or address in ipaddress.ip_network("192.168.31.0/24")
    def process_request(self,request,client_address):
        if not self.slots.acquire(False):request.close();return
        try:super().process_request(request,client_address)
        except BaseException:self.slots.release();raise
    def process_request_thread(self,request,client_address):
        try:super().process_request_thread(request,client_address)
        finally:self.slots.release()

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    server_version='ArvelaHub'
    def setup(self):
        super().setup();self.connection.settimeout(15)
        if isinstance(self.connection, ssl.SSLSocket): self.connection.do_handshake()
    def log_message(self,fmt,*args):
        # Never log URL query, payload, authorization or personal session titles.
        print(encode({'method':self.command,'path':urlsplit(self.path).path,'status':str(args[1]) if len(args)>1 else ''}),flush=True)
    def respond(self,code,body,kind='application/json; charset=utf-8',cookie=None):
        raw=encode(body).encode() if kind.startswith('application/json') else body
        self.send_response(code)
        for k,v in [('Content-Type',kind),('Content-Length',str(len(raw))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff'),('Referrer-Policy','no-referrer'),('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")]:self.send_header(k,v)
        if cookie:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(raw)
    def actor(self):
        auth=self.headers.get('Authorization','')
        if auth.startswith('Bearer '):return self.server.hub.authenticate(auth[7:])
        cookies=http.cookies.SimpleCookie(self.headers.get('Cookie',''))
        sid=cookies.get('arvela_session')
        entry=self.server.hub.cookies.get(sid.value if sid else '')
        if entry and entry[1]>time.time():return self.server.hub.authenticate(entry[0])
        raise Fault(401,'Войдите по ключу.')
    def dispatch(self):
        try:
            parsed=urlsplit(self.path)
            path=parsed.path
            origin=self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host'):
                raise Fault(403,'Запрос с другого сайта отклонён.')
            if self.command=='GET' and path=='/health':return self.respond(200,{'service':'arvela-hub','apiVersion':1})
            data={}
            if self.command=='POST':
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=MAX_BODY or self.headers.get('Transfer-Encoding'):raise Fault(413,'Запрос слишком велик.')
                if not self.headers.get('Content-Type','').startswith('application/json'):raise Fault(415,'Нужен JSON.')
                data=json.loads(self.rfile.read(size))
                if not isinstance(data,dict):raise Fault(400,'Нужен JSON-объект.')
            if self.command=='POST' and path=='/api/login':
                actor=self.server.hub.authenticate(data.get('token'))
                sid=secrets.token_urlsafe(32)
                with self.server.hub.lock:
                    self.server.hub.cookies={k:v for k,v in self.server.hub.cookies.items() if v[1]>time.time()}
                    if len(self.server.hub.cookies)>1000:raise Fault(429,'Слишком много входов.')
                    self.server.hub.cookies[sid]=(data['token'],time.time()+1800)
                return self.respond(200,{'name':actor['name'],'admin':actor['admin']},cookie='arvela_session='+sid+'; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=1800')
            if self.command=='POST' and path=='/api/logout':
                cookie=http.cookies.SimpleCookie(self.headers.get('Cookie',''));sid=cookie.get('arvela_session')
                if sid:self.server.hub.cookies.pop(sid.value,None)
                return self.respond(200,{'ok':True},cookie='arvela_session=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0')
            if path.startswith('/api/'):
                return self.respond(200,self.server.hub.api(self.command,path,parse_qs(parsed.query),self.actor(),data))
            if self.command=='GET' and path in {'/','/app.js','/style.css'}:
                file=self.server.web/({'/':'index.html'}.get(path,path[1:]))
                kind={'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8'}[path]
                return self.respond(200,file.read_bytes(),kind)
            raise Fault(404,'Страница не найдена.')
        except Fault as e:
            if e.status in (400,413,415): self.close_connection=True
            self.respond(e.status,{'error':e.message})
        except (ValueError,TypeError,KeyError):self.respond(400,{'error':'Некорректный запрос.'})
        except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
        except Exception:
            # No payload or credential is included in the error/log.
            self.respond(500,{'error':'Ошибка хранилища. Проверьте журнал сервиса.'})
    do_GET=dispatch
    do_POST=dispatch

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',default='/var/lib/arvela-hub')
    parser.add_argument('--listen',default='0.0.0.0')
    parser.add_argument('--port',type=int,default=8443)
    parser.add_argument('--cert');parser.add_argument('--key')
    parser.add_argument('--provision');parser.add_argument('--platform',default='other');parser.add_argument('--admin',action='store_true')
    parser.add_argument('--backup');parser.add_argument('--maintain',action='store_true')
    args=parser.parse_args();hub=Hub(Path(args.data))
    if args.provision:print(encode(hub.provision(args.provision,args.platform,args.admin)))
    elif args.backup:
        with hub.connection() as src,sqlite3.connect(args.backup) as dst:src.backup(dst)
    elif args.maintain:hub.maintain()
    else:
        if not args.cert or not args.key:parser.error('Production serving requires --cert and --key (HTTPS).')
        server=Server((args.listen,args.port),hub,Path(__file__).parent/'web')
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(args.cert,args.key);server.socket=context.wrap_socket(server.socket,server_side=True,do_handshake_on_connect=False)
        server.serve_forever()
