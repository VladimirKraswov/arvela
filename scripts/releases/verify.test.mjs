import {test} from 'node:test';import assert from 'node:assert/strict';
import {verifyPublication,publishAndVerify} from './verify.mjs';import {hash} from './packet.mjs';
function fixture(){
 const envelopes=Object.fromEntries(['hot','source'].map(kind=>[kind,{payload:Buffer.from(kind).toString('base64'),signature:`signed-${kind}`}]))
 const head={available:true,version:'1.2.3',nativeFingerprint:'fp',revision:'revision',artifacts:Object.fromEntries(['hot','source'].map(kind=>[kind,{digest:hash(Buffer.from(kind)),bytes:kind.length}]))};
 const download=async digest=>Object.values(envelopes).find(e=>hash(Buffer.from(e.payload,'base64'))===digest);
 return{head,envelopes,download,expected:{version:'1.2.3',nativeFingerprint:'fp'}};
}
test('publication succeeds only after head and both client-download packets match',async()=>{const f=fixture();const receipt=await verifyPublication(f.head,f.expected,f.envelopes,f.download);assert.equal(receipt.version,'1.2.3');assert.equal(Object.keys(receipt.artifacts).length,2);});
test('unavailable/other/stale heads, missing/mismatched descriptor or failed download cannot mark a release published',async()=>{
 for(const change of [h=>h.available=false,h=>h.version='1.2.2',h=>h.nativeFingerprint='other',h=>delete h.revision,h=>delete h.artifacts.source,h=>h.artifacts.hot.bytes++,h=>h.artifacts.source.digest='other']){
  const f=fixture();change(f.head);await assert.rejects(()=>verifyPublication(f.head,f.expected,f.envelopes,f.download));
 }
 const f=fixture();await assert.rejects(()=>verifyPublication(f.head,f.expected,f.envelopes,async()=>{throw Error('offline')}));
 await assert.rejects(()=>verifyPublication(f.head,f.expected,f.envelopes,async digest=>({...await f.download(digest),signature:'tampered'})));
});

test('lost POST acknowledgement verifies committed release once and never replays publication',async()=>{
 const f=fixture();let writes=0;const result=await publishAndVerify(async()=>{writes++;throw Error('socket hang up')},async()=>f.head,f.expected,f.envelopes,f.download);
 assert.equal(writes,1);assert.equal(result.recoveredAcknowledgement,true);
});
test('an uncommitted failed POST cannot be reported as released or retried',async()=>{
 const f=fixture();let writes=0;await assert.rejects(()=>publishAndVerify(async()=>{writes++;throw Error('socket hang up')},async()=>({...f.head,version:'1.2.2'}),f.expected,f.envelopes,f.download));assert.equal(writes,1);
});
