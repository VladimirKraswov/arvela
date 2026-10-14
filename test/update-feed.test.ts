import {it,expect} from 'vitest';
// @ts-expect-error Node release tooling is intentionally independent of the renderer.
import {manifest} from '../scripts/update-feed.mjs';
const signature=Buffer.from('untrusted comment: fixture\nfixture\ntrusted comment: timestamp:0\tfile:a.tar.gz\tversion:0.2.53\nfixture\n').toString('base64');
it('publishes exact version-bound assets and rejects cross-version or unsafe feeds',()=>{
 const args={version:'0.2.53',channel:'stable',platform:'darwin-aarch64',artifact:'Arvela.app.tar.gz',signature};
 expect(manifest(args).platforms['darwin-aarch64'].url).toMatch(/\/v0.2.53\/Arvela.app.tar.gz$/);
 expect(()=>manifest({...args,version:'9.9.9'})).toThrow('bind');
 expect(()=>manifest({...args,artifact:'../../other.zip'})).toThrow();
 expect(()=>manifest({...args,channel:'stable',version:'0.2.54-preview.1'})).toThrow('Preview');
});
