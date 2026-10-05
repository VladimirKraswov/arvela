// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emptySessionChat } from "../src/state/chatReducer";
import { TaskScheduler } from "../src/schedules/tasks";
import { registerComposer } from "../src/attachments/composerBridge";
import { attachmentScope } from "../src/attachments/drafts";
const fake=vi.hoisted(()=>({state:{} as any,engine:"opencode",draft:"user draft",setDraft:vi.fn(),setUi:vi.fn(),children:vi.fn(),statuses:vi.fn(),openChat:vi.fn(),scheduler:null as any}));
vi.mock("../src/state/store",()=>({useAppState:()=>fake.state,store:{engineIdFor:()=>fake.engine,getModelChoice:()=>({providerID:"p",modelID:"m",variant:"medium"}),getAgentChoice:()=>"build",getDraft:()=>fake.draft,setDraft:fake.setDraft,setUi:fake.setUi,openChat:fake.openChat,client:{sessionChildren:fake.children,sessionStatuses:fake.statuses}}}));
vi.mock("../src/schedules/tasks",async original=>({...await original<object>(),taskScheduler:()=>fake.scheduler}));
import { ContextPanel } from "../src/components/ContextPanel";
let root:Root;
beforeEach(()=>{
 vi.resetAllMocks();vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);fake.engine="opencode";fake.draft="user draft";
 let raw:string|null=null;fake.scheduler=new TaskScheduler({getItem:()=>raw,setItem:(_:string,v:string)=>{raw=v;}});
 const chat=emptySessionChat();chat.messageOrder=["u"];chat.messages.u={id:"u",sessionID:"s",role:"user",time:{created:1}};chat.partsByMessage.u=["f"];chat.parts.f={id:"f",messageID:"u",sessionID:"s",type:"file",filename:"source.pdf"};
 fake.state={prefs:{endpoint:"local"},directory:"/project",activeSessionId:"s",chat:{sessions:{s:chat}},connection:{phase:"connected"},ui:{sending:false},historyCursors:{},olderExhausted:{}};
 fake.children.mockResolvedValue([]);fake.statuses.mockResolvedValue({});const node=document.createElement("div");document.body.append(node);root=createRoot(node);
});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML="";vi.useRealTimers();vi.unstubAllGlobals();});
const mount=()=>act(async()=>root.render(createElement(ContextPanel)));
const click=async(label:string)=>act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
it("sources navigate to the scoped message and creating a result appends to the existing draft",async()=>{
 await mount();await act(async()=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="source.pdf")!.click());
 expect(fake.setUi).toHaveBeenCalledWith({revealMessage:{server:"local",directory:"/project",sessionID:"s",messageID:"u"},contextOpen:false});
 await click("Подготовить запрос на создание результата");expect(fake.setDraft).toHaveBeenCalledWith("user draft\n\nСоздай файл с результатом: ");
});
it("does not request OpenCode children for Pi and cancels stale child responses after switching chat",async()=>{
 fake.engine="pi";await mount();expect(fake.children).not.toHaveBeenCalled();expect(document.body.textContent).toContain("Pi не предоставляет");
 fake.engine="opencode";let resolve!:(v:unknown)=>void;fake.children.mockReturnValue(new Promise(r=>{resolve=r;}));await mount();
 const signal=fake.children.mock.calls[0][2] as AbortSignal;fake.state={...fake.state,activeSessionId:"other"};await mount();expect(signal.aborted).toBe(true);
 await act(async()=>resolve([{id:"child",parentID:"s",directory:"/project",title:"stale",time:{}}]));expect(document.body.textContent).not.toContain("stale");
});
it("saving a recurrence retains its chat, agent and reasoning model without starting inference",async()=>{
 await mount();await click("Добавить повторяющееся задание");
 await act(async()=>{
  const inputs=document.querySelectorAll("input");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
  setter.call(inputs[0],"CI check");inputs[0].dispatchEvent(new Event("input",{bubbles:true}));
  const text=document.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(text,"Check CI");text.dispatchEvent(new Event("input",{bubbles:true}));
 });
 await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(fake.scheduler.snapshot()).toEqual([expect.objectContaining({server:"local",sessionID:"s",directory:"/project",title:"CI check",prompt:"Check CI",minutes:15,engine:"opencode",agent:"build",model:{providerID:"p",modelID:"m",variant:"medium"}})]);
 expect(document.body.textContent).toContain("Следующий запуск");expect(fake.setDraft).not.toHaveBeenCalled();
});
it("source plus uses the existing composer file picker and escape closes the disclosure",async()=>{
 const files=vi.fn(()=>true);const stop=registerComposer({scope:()=>attachmentScope("local","/project","s"),openFiles:files,focus:vi.fn()});
 await mount();await click("Добавить источник в черновик");expect(files).toHaveBeenCalledOnce();stop();
 await act(async()=>document.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(fake.setUi).toHaveBeenCalledWith({contextOpen:false});
});
it("source plus never opens a composer editing another chat and says why instead of doing nothing",async()=>{
 const files=vi.fn(()=>true);const stop=registerComposer({scope:()=>attachmentScope("local","/project","other"),openFiles:files,focus:vi.fn()});
 await mount();await click("Добавить источник в черновик");stop();
 expect(files).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')?.textContent).toContain("не принимает файлы");
});
it("labels only task-reported children as subagents and does not show a count before the first answer",async()=>{
 let resolve!:(v:unknown)=>void;fake.children.mockReturnValue(new Promise(r=>{resolve=r;}));
 const chat=fake.state.chat.sessions.s;chat.messageOrder=[...chat.messageOrder,"a"];chat.messages.a={id:"a",sessionID:"s",role:"assistant",time:{created:2}};
 chat.partsByMessage.a=["t"];chat.parts.t={id:"t",messageID:"a",sessionID:"s",type:"tool",tool:"task",state:{status:"completed",metadata:{sessionId:"sub"}}};
 await mount();expect(document.body.textContent).toContain("Субагенты и ветки · …");
 await act(async()=>resolve([{id:"sub",parentID:"s",directory:"/project",title:"Research",time:{}},{id:"fork",parentID:"s",directory:"/project",title:"Fork",time:{}}]));
 const rows=Array.from(document.querySelectorAll("li")).map(li=>li.textContent);
 expect(rows.find(r=>r?.includes("Research"))).toContain("Субагент · вернул ответ");
 expect(rows.find(r=>r?.includes("Fork"))).toContain("Дочерняя сессия");expect(rows.find(r=>r?.includes("Fork"))).not.toContain("Субагент");
});
it("shows bidi-control file names inertly and keeps scheduled tasks of other chats out of this chat",async()=>{
 const rlo=String.fromCharCode(0x202e),mark=String.fromCharCode(0xfffd);
 fake.state.chat.sessions.s.parts.f={...fake.state.chat.sessions.s.parts.f,filename:`report${rlo}fdp.exe`};
 fake.scheduler.add({server:"local",directory:"/project",sessionID:"elsewhere",engine:"opencode",title:"Other chat",prompt:"x",minutes:5,model:{providerID:"p",modelID:"m"}});
 await mount();
 expect(document.body.textContent).not.toContain(rlo);expect(document.body.textContent).toContain(`report${mark}fdp.exe`);
 expect(document.body.textContent).not.toContain("Other chat");expect(document.body.textContent).toContain("других чатах этого сервера: 1");
});
it("updates sources from streaming events when the reducer retains the chat object",async()=>{
 await mount();
 const chat=fake.state.chat.sessions.s;
 const { reduceEvent }=await import("../src/state/chatReducer");
 reduceEvent(fake.state.chat,{type:"message.part.updated",properties:{part:{id:"f2",messageID:"u",sessionID:"s",type:"file",filename:"streamed-source.txt"}}});
 expect(fake.state.chat.sessions.s).toBe(chat);
 await mount();expect(document.body.textContent).toContain("streamed-source.txt");
});
it("cancels child reads when an SSH endpoint changes under the same server identity",async()=>{
 fake.state={...fake.state,prefs:{endpoint:"http://127.0.0.1:5001",workspaceKey:"same-host"}};
 let resolve!:(value:unknown)=>void;fake.children.mockResolvedValue([]).mockReturnValueOnce(new Promise(r=>{resolve=r;}));await mount();
 const signal=fake.children.mock.calls[0][2] as AbortSignal;
 fake.state={...fake.state,prefs:{...fake.state.prefs,endpoint:"http://127.0.0.1:5002"}};await mount();
 expect(signal.aborted).toBe(true);
 await act(async()=>resolve([{id:"old-child",parentID:"s",directory:"/project",title:"OLD_ENDPOINT_CHILD",time:{}}]));
 expect(document.body.textContent).not.toContain("OLD_ENDPOINT_CHILD");
});
