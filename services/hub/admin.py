#!/usr/bin/env python3
"""Import a reviewed local TEXT bundle; no SSH or third-party packages required."""
import argparse,json,ssl,urllib.request
from pathlib import Path
from urllib.parse import urlsplit
p=argparse.ArgumentParser();p.add_argument('--endpoint',required=True);p.add_argument('--certificate',required=True);p.add_argument('--key-file',required=True);p.add_argument('--directory',required=True);p.add_argument('--id',required=True);p.add_argument('--kind',choices=['skill','prompt','tool','template','runbook'],required=True);p.add_argument('--title',required=True);p.add_argument('--description',default='');a=p.parse_args()
u=urlsplit(a.endpoint)
if u.scheme!='https' or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):p.error('Use a HTTPS origin without credentials')
raw=Path(a.key_file).read_text();key=json.loads(raw)['token'] if raw.lstrip().startswith('{') else raw.strip();ctx=ssl.create_default_context(cafile=a.certificate)
def call(path,data=None):
 q=urllib.request.Request(a.endpoint.rstrip('/')+'/api/'+path,data=json.dumps(data,ensure_ascii=False).encode() if data else None,headers={'Authorization':'Bearer '+key,**({'Content-Type':'application/json'} if data else {})});return json.load(urllib.request.urlopen(q,context=ctx,timeout=20))
root=Path(a.directory);files={}
for file in sorted(root.rglob('*')):
 if file.is_symlink():p.error('Symlinks are not portable bundle files')
 if file.is_file():
  if file.stat().st_size>262144:p.error('File exceeds256KiB')
  files[file.relative_to(root).as_posix()]=file.read_text(encoding='utf-8')
if len(files)>128:p.error('Bundle exceeds128files')
item={'id':a.id,'kind':a.kind,'title':a.title,'description':a.description,'files':files}
for old in call('catalog')['items']:
 if old['id']==a.id:item['expectedRevision']=old['revision']
print(json.dumps(call('catalog',item)))
