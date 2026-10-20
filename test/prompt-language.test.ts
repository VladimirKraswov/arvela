import { expect, it } from 'vitest';
import { agentParts, languageReminder, visiblePromptText, steeringParts, steeringReminder, isSteeringText } from '../src/agent/promptPolicy';
import { entriesToHistory, PiStreamTranslator } from '../src/agent/pi/translate';
import type { PiEntry } from '../src/agent/pi/protocol';
import { toolWorkflowReminder } from '../src/agent/toolWorkflow';
it('adds one hidden Russian-language policy without altering user text or files', () => {
    const parts = [{ type: 'text' as const, text: 'request' }, { type: 'file' as const, mime: 'image/png', url: 'data:image/png;base64,AAAA' }];
    const sent = agentParts(undefined, 's', '/work', parts);
    expect(sent.slice(0, 2)).toEqual(parts);
    expect(parts).toHaveLength(2);
    expect(sent[2]).toMatchObject({ type: 'text', synthetic: true, text: languageReminder('s') });
    expect(sent[3]).toMatchObject({ type: 'text', synthetic: true, text: toolWorkflowReminder('s') });
    expect(languageReminder('s')).toContain('на русском');
    expect(languageReminder('s')).toContain('на английском');
    expect(languageReminder('s')).toContain('Не переходи на украинский');
    expect(agentParts(undefined, 's', '/work', sent)).toBe(sent);
});
it('both engines receive guidance, while Pi renders only the unchanged user text and files', () => {
    const parts = [{ type: 'text' as const, text: 'исправь игру' }, { type: 'file' as const, mime: 'application/zip', url: 'file:///owned/input.zip' }];
    const sent = agentParts(undefined, 'own', '/work', parts);
    expect(sent.filter(p => p.type === 'file')).toEqual([parts[1]]);
    const flattened = sent.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
    expect(visiblePromptText(flattened, 'own')).toBe('исправь игру');
    const attached = flattened + '\n\n<attached_file name="x">\n\n' + toolWorkflowReminder('own') + '\n\n</attached_file>';
    expect(visiblePromptText(attached, 'own')).toBe('исправь игру\n\n<attached_file name="x">\n\n' + toolWorkflowReminder('own') + '\n\n</attached_file>');
    expect(visiblePromptText(flattened, 'foreign')).toBe(flattened);
    expect(visiblePromptText('quoted:' + toolWorkflowReminder('own'), 'own')).toBe('quoted:' + toolWorkflowReminder('own'));
});
it('Pi hides the policy in live and durable user entries only', () => {
    const text = 'задание\n\n' + languageReminder('s');
    const user = { role: 'user' as const, content: [{ type: 'text' as const, text }] };
    const entry = { id: 'u', parentId: null, type: 'message' as const, timestamp: '2026-10-18T00:00:00Z', message: user };
    expect(entriesToHistory('s', [entry])[0].parts[0].text).toBe('задание');
    const live = new PiStreamTranslator('s').translate({ type: 'message_start', message: user });
    expect(live.events.find(e => e.type === 'message.part.updated')?.properties.part.text).toBe('задание');
    const assistant = { ...entry, id: 'a', message: { ...user, role: 'assistant', provider: 'p', model: 'm' } } as PiEntry;
    expect(entriesToHistory('s', [assistant])[0].parts[0].text).toBe(text);
});
it('does not remove foreign-session, quoted or attached content', () => {
    const marker = languageReminder('s');
    for (const text of ['quoted:' + marker, '<attached_file name="x">\n\n' + marker + '\n\n</attached_file>'])
        expect(visiblePromptText(text, 's')).toBe(text);
    expect(visiblePromptText('request\n\n' + marker, 'other')).toContain(marker);
});

it('corrections keep visible text, gain durable metadata, and survive Pi live/history translation',()=>{
 const parts=agentParts(undefined,'s','/work',steeringParts('s',[{type:'text',text:'Учитывай Windows'}]));
 expect(parts[0]).toMatchObject({text:'Учитывай Windows',metadata:{arvelaSteering:1}});
 expect(steeringParts('s',parts)).toHaveLength(parts.length);
 const text=parts.filter(p=>p.type==='text').map(p=>p.text).join('\n\n');
 expect(isSteeringText(text,'s')).toBe(true);expect(isSteeringText(text,'other')).toBe(false);
 expect(visiblePromptText(text,'s')).toBe('Учитывай Windows');
 const message={role:'user' as const,content:[{type:'text' as const,text}]};
 const entries=[{id:'u',parentId:null,type:'message' as const,timestamp:'2026-10-20T00:00:00Z',message}];
 expect(entriesToHistory('s',entries)[0].parts[0]).toMatchObject({text:'Учитывай Windows',metadata:{arvelaSteering:1}});
 const live=new PiStreamTranslator('s').translate({type:'message_start',message});
 expect(live.events.find(e=>e.type==='message.part.updated')?.properties.part).toMatchObject({text:'Учитывай Windows',metadata:{arvelaSteering:1}});
 expect(isSteeringText('<attached_file name="x">\n\n'+steeringReminder('s'),'s')).toBe(false);
});

it('keeps pre-Enki language reminders hidden without rewriting old Pi history',()=>{
 const old=languageReminder('s').replace('Язык общения Enki:','Язык общения Arvela:');
 expect(visiblePromptText('старое сообщение\n\n'+old,'s')).toBe('старое сообщение');
 expect(visiblePromptText('quoted:'+old,'s')).toBe('quoted:'+old);
});
