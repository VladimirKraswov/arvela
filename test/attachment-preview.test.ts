import {expect,it} from 'vitest';
import {attachmentBlob,imageThumbnail,previewKind} from '../src/attachments/preview';
import {sessionContext} from '../src/state/taskContext';
import {emptySessionChat} from '../src/state/chatReducer';
it('previews raster data without fetching remote resources or rendering SVG/HTML',async()=>{
 expect(imageThumbnail({key:'x',name:'x',url:'https://private.test/image.png'})).toBeUndefined();
 expect(imageThumbnail({key:'x',name:'x',url:'data:image/svg+xml;base64,PHN2Zz4='})).toBeUndefined();
 expect(previewKind('text/html')).toBe('text');expect(previewKind('image/svg+xml')).toBe('other');
 await expect(attachmentBlob({key:'x',name:'x',url:'https://private.test/image.png'},false)).rejects.toThrow();
 await expect(attachmentBlob({key:'x',name:'x',url:'file:///private/local.txt'},true)).rejects.toThrow();
 const b=await attachmentBlob({key:'x',name:'x',url:'data:text/plain;base64,SGVsbG8='},false);expect(await b.text()).toBe('Hello');
});
it('retains attachment bytes from the same scoped transcript, not assistant output',()=>{
 const chat=emptySessionChat();chat.messageOrder=['u','a'];chat.messages.u={id:'u',sessionID:'s',role:'user',time:{created:1}};chat.messages.a={id:'a',sessionID:'s',role:'assistant',time:{created:2}};chat.partsByMessage={u:['f'],a:['g']};chat.parts={f:{id:'f',sessionID:'s',messageID:'u',type:'file',filename:'x.png',mime:'image/png',url:'data:image/png;base64,eA=='},g:{id:'g',sessionID:'s',messageID:'a',type:'file',url:'data:text/plain;base64,eA=='}};
 expect(sessionContext(chat).sources).toEqual([expect.objectContaining({key:'f',url:'data:image/png;base64,eA=='})]);
});
