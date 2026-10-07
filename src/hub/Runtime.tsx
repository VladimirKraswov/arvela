import { useEffect } from "react";
import { store } from "../state/store";
import { isNative } from "../native/platform";
import { config, disable, drain, idle, install, request, spool, type HubItem } from "./client";
import { record, type HubRecord } from "./records";
export function HubRuntime(){useEffect(()=>{
 if(!isNative())return;
 let disposed=false,busy=false,lastCatalog=0,failures=0,next=0;
 const observed=new Map<string,string>();
 async function tick(){if(disposed||busy||Date.now()<next)return;busy=true;
 try{const c=await config();if(disposed||!c.enabled)return;
 const records:HubRecord[]=[];
 for(const [sid,chat] of Object.entries(store.state.chat.sessions)){
  const session=store.state.sessions.find(s=>s.id===sid)??{id:sid,title:store.state.prefs.piSessions?.[sid]?.title??"",directory:store.state.directory??""};
  for(const id of chat.messageOrder){const m=chat.messages[id];if(!m)continue;
   const parts=(chat.partsByMessage[id]??[]).map(p=>chat.parts[p]).filter(Boolean);
   const r=record(store.engineIdFor(sid,session.directory)==="pi"?"pi":"opencode",session,m,parts,c.shareText);if(!r)continue;
   const key=r.engine+":"+sid+":"+id,value=JSON.stringify(r);if(observed.get(key)!==value){records.push(r);}
  }
 }
 if(observed.size>5000)observed.clear();
 for(let i=0;i<records.length;i+=50){if(disposed)break;const batch=records.slice(i,i+50);await spool("enqueue",batch);for(const r of batch)observed.set(r.engine+":"+r.sessionId+":"+r.id,JSON.stringify(r));}
 await drain();failures=0;next=Date.now()+10000;
 if(idle()&&!store.state.ui.settingsOpen&&Date.now()-lastCatalog>300000){const items=(await request<{items:HubItem[]}>("catalog")).items;for(const x of items){if(disposed)break;if(c.installed[x.id]&&!x.enabled)await disable(x);else if(x.enabled&&c.installed[x.id]&&c.installed[x.id]!==x.revision&&x.kind!=="tool")await install(x,true);}lastCatalog=Date.now();}
 }catch{failures++;next=Date.now()+Math.min(60000,2000*2**Math.min(5,failures));}finally{busy=false;}}
 const timer=setInterval(()=>void tick(),10000);void tick();return()=>{disposed=true;clearInterval(timer);};
 },[]);return null;}
