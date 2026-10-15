import {hash} from './packet.mjs';
// A successful upload is not a successful rollout until the client-facing head
// and BOTH downloadable signed packets match the reviewed local release.
export async function verifyPublication(head, expected, envelopes, download){
  if(head?.available!==true||head.version!==expected.version||head.nativeFingerprint!==expected.nativeFingerprint||typeof head.revision!=='string'||!head.revision)
    throw Error('Published Hub head does not match this release');
  const artifacts={};
  for(const kind of ['hot','source']){
    const wanted=envelopes[kind], raw=Buffer.from(wanted.payload,'base64'),digest=hash(raw),descriptor=head.artifacts?.[kind];
    if(descriptor?.digest!==digest||descriptor.bytes!==raw.length)throw Error(`Hub ${kind} descriptor mismatch`);
    const actual=await download(digest);
    if(actual?.payload!==wanted.payload||actual.signature?.trim()!==wanted.signature.trim())throw Error(`Hub ${kind} downloaded packet mismatch`);
    artifacts[kind]={digest,bytes:raw.length};
  }
  return{version:head.version,nativeFingerprint:head.nativeFingerprint,revision:head.revision,artifacts};
}
