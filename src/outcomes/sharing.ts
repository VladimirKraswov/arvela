import type {HubRecord} from '../hub/records';
import {outcomes,scopeKey,sharedAssessment,type Outcome} from './store';
/** Missing optional browser storage must not stop ordinary history upload. */
export async function assessmentIndex():Promise<Map<string,Outcome>> {
 try{return new Map((await outcomes.list()).map(t=>[t.id,t]));}catch{return new Map();}
}
export function attachAssessment(record:HubRecord|null,index:Map<string,Outcome>,server:string,directory:string,shareText:boolean):HubRecord|null {
 if(!record||record.role!=='user')return record;
 const scope={server,directory,engine:record.engine,sessionID:record.sessionId};
 const t=index.get(JSON.stringify([scopeKey(scope),record.id])),assessment=t&&sharedAssessment(t,shareText);
 return assessment?{...record,assessment}:record;
}
