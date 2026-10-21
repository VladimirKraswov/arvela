import {expect,it} from 'vitest';
import {McpNotices} from '../src/capabilities/notices';
it('announces an outage once, permits a new outage after recovery, and clears only its own toast',()=>{
 const notices=new McpNotices(),issues=[{id:'compass',name:'Web Compass'}];
 const first=notices.update('scope',issues,null)!;expect(first).toContain('Web Compass');
 expect(notices.update('scope',issues,null)).toBeUndefined();
 expect(notices.update('scope',[],first)).toBeNull();
 const second=notices.update('scope',issues,'other');expect(second).toBe(first);
 expect(notices.update('scope',[],'other')).toBeUndefined();
});
