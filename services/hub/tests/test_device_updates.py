import base64,copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('device_hub',Path(__file__).parents[1]/'server.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d=m._device_module
b64=lambda b:base64.b64encode(b).decode()
def candidate(version='1.0.0'):
    files={'package.json':json.dumps({'version':version}),'package-lock.json':json.dumps({'version':version,'packages':{'':{'version':version}}}),
     'src-tauri/tauri.conf.json':json.dumps({'version':version,'productName':'Enki','identifier':'dev.local.opencodedesktop'}),
     'src-tauri/Cargo.toml':'[package]\nname = "enki"\nversion = "'+version+'"\n',
     'src-tauri/Cargo.lock':'[[package]]\nname = "enki"\nversion = "'+version+'"\n','src/main.tsx':'source','src-tauri/src/lib.rs':'native'}
    files={k:b64(v.encode()) for k,v in files.items()};fp=d.native_fingerprint(files)
    packet=lambda kind,fs:b64(json.dumps(dict(schemaVersion=1,kind=kind,version=version,nativeFingerprint=fp,notes='',files=fs)).encode())
    return dict(channel='stable',expectedRevision=None,source=packet('source',files),hot=packet('hot',{'index.html':b64(b'UI')}),validation=dict(checks=d.CHECKS,platform='win32',commit='a'*40))
def fake_sign(body,fault):
    version=json.loads(base64.b64decode(body['source']))['version']
    return {k:dict(payload=body[k],signature=b64(('untrusted comment: fixture\nsig\ntrusted comment: timestamp:1\tversion:'+version+'\nsig').encode())) for k in ('source','hot')}
class DevicePublication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.h=m.Hub(Path(self.tmp.name));self.actor=self.h.authenticate(self.h.provision('publisher','windows')['token'])
    def tearDown(self):self.tmp.cleanup()
    def publish(self,body):return d.publish(self.h.releases,self.actor,body)
    def test_device_can_publish_without_admin_and_both_served_packets_match(self):
        body=candidate()
        with patch.object(d,'sign',side_effect=fake_sign):result=self.publish(body)
        self.assertEqual(result['publication']['device'],self.actor['id'])
        for kind,a in result['head']['artifacts'].items():
            self.assertEqual(self.h.releases.read(self.h.releases.root/(a['digest']+'.json'))['payload'],body[kind])
        with self.assertRaises(m.Fault) as e:self.h.releases.api('POST','/api/updates',self.actor,{})
        self.assertEqual(e.exception.status,403)
    def test_missing_attestation_or_bad_native_fingerprint_never_reaches_signer(self):
        for change in ('checks','native','version','private'):
            b=candidate()
            if change=='checks':b['validation']['checks']=[]
            else:
                s=json.loads(base64.b64decode(b['source']))
                if change=='native':s['files']['src-tauri/src/lib.rs']=b64(b'changed native')
                if change=='version':s['files']['package.json']=b64(b'{"version":"8.0.0"}')
                if change=='private':s['files']['.pi/private.txt']=b64(b'private')
                b['source']=b64(json.dumps(s).encode())
            with patch.object(d,'sign') as signer:
                with self.assertRaises(m.Fault):self.publish(b)
                signer.assert_not_called()
    def test_channel_race_during_signing_does_not_overwrite_new_release(self):
        b=candidate()
        def race(data,fault):
            envelopes=fake_sign(data,fault);self.h.releases.api('POST','/api/updates',{'admin':True},dict(channel='stable',expectedRevision=None,**envelopes));return envelopes
        with patch.object(d,'sign',side_effect=race):
            with self.assertRaises(m.Fault) as e:self.publish(b)
        self.assertEqual(e.exception.status,409);self.assertEqual(self.h.releases.head('stable')['version'],'1.0.0')
    def test_signer_outage_and_wrong_payload_never_expose_a_release(self):
        for side in (m.Fault(503,'offline'),lambda data,fault:{'source':{'payload':'wrong'},'hot':{}}):
            with patch.object(d,'sign',side_effect=side):
                with self.assertRaises(m.Fault):self.publish(candidate())
            self.assertFalse(self.h.releases.head('stable')['available'])
    def test_revocation_while_signing_cannot_publish(self):
        def revoke(data,fault):
            signed=fake_sign(data,fault)
            with self.h.connection() as c:c.execute('UPDATE devices SET revoked=1 WHERE id=?',(self.actor['id'],))
            return signed
        with patch.object(d,'sign',side_effect=revoke):
            with self.assertRaises(m.Fault) as e:self.h.api('POST','/api/updates/device',{},self.actor,candidate())
        self.assertEqual(e.exception.status,401);self.assertFalse(self.h.releases.head('stable')['available'])
    def test_hub_api_authentication_routes_device_publication_only(self):
        with patch.object(d,'sign',side_effect=fake_sign):
            result=self.h.api('POST','/api/updates/device',{},self.actor,candidate())
        self.assertEqual(result['head']['version'],'1.0.0')
