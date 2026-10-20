import {expect,it} from 'vitest';
import {workshopParts,workshopVisibleText,workshopReminder,WORKSHOP_RELEASE_CONTEXT} from '../src/workshop/policy';
import type {WorkshopRecord} from '../src/workshop/workspace';
import {entriesToHistory,PiStreamTranslator} from '../src/agent/pi/translate';
import type {PiEntry} from '../src/agent/pi/protocol';
const record:WorkshopRecord={directory:'/workshop',sourceDirectory:'/source',session:{id:'workshop',directory:'/workshop',title:'Мастерская Arvela',projectID:'global',time:{created:1,updated:1}}};
it('does not add release authority to another session, directory or an unconfigured endpoint',()=>{
 const parts=[{type:'text' as const,text:'hello'}];
 expect(workshopParts(undefined,'workshop','/workshop',parts)).toBe(parts);
 expect(workshopParts(record,'other','/workshop',parts)).toBe(parts);
 expect(workshopParts(record,'workshop','/other',parts)).toBe(parts);
});
it('preserves user instructions/files and appends one hidden release reminder',()=>{
 const parts=[{type:'text' as const,text:'Только анализ, не выкатывать'}, {type:'file' as const,mime:'image/png',url:'data:image/png;base64,fixture'}];
 const sent=workshopParts(record,'workshop','/workshop',parts);
 expect(sent.slice(0,2)).toEqual(parts);expect(parts).toHaveLength(2);
 expect(sent[2]).toMatchObject({type:'text',synthetic:true,metadata:{arvelaWorkshopRelease:1}});
 expect(sent[2]).toHaveProperty('text',workshopReminder('workshop'));
 expect(workshopParts(record,'workshop','/workshop',sent)).toBe(sent);
 expect(WORKSHOP_RELEASE_CONTEXT).toContain('не требуется');
 expect(WORKSHOP_RELEASE_CONTEXT).toContain('обновление НЕ выпущено');
 expect(WORKSHOP_RELEASE_CONTEXT).toContain('просьба пользователя только про анализ');
});
it('Pi hides the exact app reminder in live and reloaded user history, preserving assistant output',()=>{
 const text='Исправь цвет\n\n'+workshopReminder('workshop');
 const user={role:'user' as const,content:[{type:'text' as const,text}]};
 const entry={id:'u',parentId:null,type:'message' as const,timestamp:'2026-10-16T00:00:00Z',message:user};
 const history=entriesToHistory('workshop',[entry]);expect(history[0].parts[0].text).toBe('Исправь цвет');
 const live=new PiStreamTranslator('workshop').translate({type:'message_start',message:user});
 const part=live.events.find(e=>e.type==='message.part.updated')?.properties.part;
 expect(part?.text).toBe('Исправь цвет');
 const assistant={...entry,id:'a',message:{...user,role:'assistant',provider:'p',model:'m'}} as PiEntry;
 expect(entriesToHistory('workshop',[assistant])[0].parts[0].text).toBe(text);
});
it('preserves arbitrary markers, quoted reminders and file contents',()=>{
 for(const text of ['before <arvela-workshop-release-v1>arbitrary</arvela-workshop-release-v1>', 'quoted:'+workshopReminder('workshop'), '<attached_file name="x">\n\n'+workshopReminder('workshop')+'\n\n</attached_file>'])expect(workshopVisibleText(text,'workshop')).toBe(text);
 const text='request\n\n'+workshopReminder('workshop')+'\n\n<attached_file name="x">\ncontents\n</attached_file>';
 expect(workshopVisibleText(text,'workshop')).toContain('<attached_file name="x">\ncontents\n</attached_file>');
 expect(workshopVisibleText(text,'other')).toBe(text);
 expect(workshopVisibleText(text,'workshop')).not.toContain('<arvela-workshop-release-v1>');
});

it('keeps the exact legacy workshop reminder hidden after the display-name migration',()=>{
 const old=workshopReminder('workshop').replace('для Мастерской:','для Мастерской Arvela:');
 expect(workshopVisibleText('текст\n\n'+old,'workshop')).toBe('текст');
 expect(workshopVisibleText('quoted:'+old,'workshop')).toBe('quoted:'+old);
});
