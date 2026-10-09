import { expect, it } from 'vitest';
import { executionEvidence, executionLabel } from '../src/chat/execution';
it('does not infer live execution from unfinished history when disconnected or idle',()=>{
 expect(executionEvidence(false,true,false)).toBe('unconfirmed');
 expect(executionEvidence(false,false,true)).toBe('inactive');
 expect(executionEvidence(true,true,true)).toBe('inactive');
 expect(executionEvidence(false,true,true)).toBe('active');
 expect(executionLabel('unconfirmed')).toContain('нет связи');
});
