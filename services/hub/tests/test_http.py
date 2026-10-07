import contextlib, http.client, json, ssl, subprocess, tempfile, threading, unittest
from pathlib import Path
from test_hub import m
class HTTP(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();p=Path(self.tmp.name);self.h=m.Hub(p/'db');self.key=self.h.provision('test','macos')['token']
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',str(p/'key'),'-out',str(p/'cert')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  self.server=m.Server(('127.0.0.1',0),self.h,Path(__file__).parents[1]/'web');ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(p/'cert',p/'key');self.server.socket=ctx.wrap_socket(self.server.socket,server_side=True,do_handshake_on_connect=False);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.ctx=ssl.create_default_context(cafile=str(p/'cert'))
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
 def req(self,path,method='GET',body=None,headers=None):
  c=http.client.HTTPSConnection('localhost',self.server.server_port,context=self.ctx,timeout=5);h=headers or {};raw=json.dumps(body) if body is not None else None
  if raw:h={'Content-Type':'application/json',**h}
  c.request(method,path,body=raw,headers=h);r=c.getresponse();data=r.read();code=r.status;headers=dict(r.getheaders());c.close();return code,headers,data
 def test_auth_transport_and_security_headers(self):
  self.assertEqual(self.req('/health')[0],200);self.assertEqual(self.req('/api/metrics')[0],401);code,h,b=self.req('/api/me',headers={'Authorization':'Bearer '+self.key});self.assertEqual(code,200);self.assertNotIn(self.key,b.decode());self.assertIn("frame-ancestors 'none'",h['Content-Security-Policy']);self.assertEqual(self.req('/api/login','POST',{'token':self.key}, {'Origin':'https://other.site'})[0],403)
 def test_cookie_login_and_safe_static(self):
  code,h,_=self.req('/api/login','POST',{'token':self.key});self.assertEqual(code,200);self.assertIn('HttpOnly',h['Set-Cookie']);self.assertIn('Secure',h['Set-Cookie']);cookie=h['Set-Cookie'].split(';')[0];self.assertEqual(self.req('/api/catalog',headers={'Cookie':cookie})[0],200);self.assertEqual(self.req('/../server.py')[0],404);self.assertEqual(self.req('/')[0],200)
 def test_wrong_ca_rejected(self):
  c=http.client.HTTPSConnection('localhost',self.server.server_port,context=ssl.create_default_context(),timeout=5)
  with self.assertRaises(ssl.SSLCertVerificationError):c.request('GET','/health')
  c.close()
