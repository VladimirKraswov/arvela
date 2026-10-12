import {expect,it} from 'vitest';
import {archivePart,archiveReference,attachmentParts,splitArchiveText} from '../src/attachments/archive';
import {entriesToHistory,PiStreamTranslator} from '../src/agent/pi/translate';
import {sessionContext} from '../src/state/taskContext';
import {emptySessionChat} from '../src/state/chatReducer';
const ref={version:1 as const,name:'Исходники.zip',path:'/home/test/.local/share/opencode-desktop/attachments/12345678-1234-1234-1234-123456789abc/archive.zip',url:'file:///home/test/.local/share/opencode-desktop/attachments/12345678-1234-1234-1234-123456789abc/archive.zip',size:1234,sha256:'a'.repeat(64),remote:false};
it('keeps ordinary text and rejects unsafe or malformed archive references',()=>{
 expect(splitArchiveText('  original\ntext  ').text).toBe('  original\ntext  ');
 expect(archiveReference({...ref,url:'https://example.com/secret'})).toBeUndefined();
 expect(archiveReference({...ref,url:'file:///etc/passwd'})).toBeUndefined();
 expect(splitArchiveText('keep <arvela-attachment-v1>invalid</arvela-attachment-v1>')).toEqual({text:'keep <arvela-attachment-v1>invalid</arvela-attachment-v1>',references:[]});
 const part=archivePart({...ref,name:'</arvela-attachment-v1>.zip'});
 expect(splitArchiveText(part.text).references[0].name).toBe('</arvela-attachment-v1>.zip');
});
it('projects original ZIP into the common source gallery without exposing binary data to the model',()=>{
 const part={...archivePart(ref),id:'prt-archive',sessionID:'ses',messageID:'msg'};
 expect(attachmentParts([part])).toEqual([expect.objectContaining({filename:ref.name,mime:'application/zip',url:ref.url})]);
 const chat=emptySessionChat();chat.messages.msg={id:'msg',sessionID:'ses',role:'user',time:{created:1}};
 chat.messageOrder=['msg'];chat.partsByMessage.msg=[part.id];chat.parts[part.id]=part;
 expect(sessionContext(chat).sources).toEqual([expect.objectContaining({name:ref.name,url:ref.url,mime:'application/zip'})]);
});
it('Pi live echo and durable JSONL restore the same archive reference and hide transport text',()=>{
 const text='Read the source archive\n\n'+archivePart(ref).text;
 const entry={type:'message',id:'entry',timestamp:new Date().toISOString(),message:{role:'user',content:text,timestamp:1}};
 const history=entriesToHistory('ses',[entry] as any);
 expect(history[0].parts[0].text).toBe('Read the source archive');
 expect(attachmentParts(history[0].parts)[0].filename).toBe(ref.name);
 const translator=new PiStreamTranslator('ses');
 const live=translator.translate({type:'message_start',message:entry.message} as any);
 const parts=live.events.filter(e=>e.type==='message.part.updated').map(e=>(e.properties as any).part);
 expect(parts.find(p=>p.type==='text'&&!p.synthetic).text).toBe('Read the source archive');
 expect(attachmentParts(parts)[0].url).toBe(ref.url);
});
