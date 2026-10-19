import { expect, it } from 'vitest';
import { repetitiveOutput } from '../src/chat/outputLimit';
import type { AssistantMessage, MessagePart } from '../src/api/types';
const message = {id:'a',sessionID:'s',role:'assistant',time:{created:1,completed:2},finish:'length'} as AssistantMessage;
const part = (text:string,type='reasoning') => ({id:'p',messageID:'a',sessionID:'s',type,text} as MessagePart);
it('recognizes the observed terminal punctuation loop without reading tool contents',()=>{
 expect(repetitiveOutput(message,[part('Analysis\n'+'?!'.repeat(8000))])).toBe(true);
 expect(repetitiveOutput(message,[part('word '.repeat(500))])).toBe(true);
 expect(repetitiveOutput(message,[part(' '.repeat(8000))])).toBe(false);
 expect(repetitiveOutput(message,[part('?!'.repeat(8000),'tool')])).toBe(false);
});
it('keeps ordinary length stops, short repeats and ongoing reasoning distinct',()=>{
 expect(repetitiveOutput(message,[part(Array.from({length:600},(_,i)=>`step ${i}: evidence`).join('\n'))])).toBe(false);
 expect(repetitiveOutput(message,[part('?!'.repeat(100))])).toBe(false);
 expect(repetitiveOutput({...message,finish:'tool-calls'},[part('?!'.repeat(8000))])).toBe(false);
 expect(repetitiveOutput({...message,finish:'stop'},[part('?!'.repeat(8000))])).toBe(false);
 expect(repetitiveOutput({...message,finish:undefined,error:{name:'MessageOutputLengthError'}},[part('?!'.repeat(8000))])).toBe(true);
});
