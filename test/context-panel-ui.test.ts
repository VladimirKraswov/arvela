// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { emptySessionChat } from "../src/state/chatReducer";
import { TaskScheduler } from "../src/schedules/tasks";
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
 const files=vi.fn();window.addEventListener("composer-add-files",files);await mount();await click("Добавить источник в черновик");expect(files).toHaveBeenCalledOnce();window.removeEventListener("composer-add-files",files);
 await act(async()=>document.querySelector("aside")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(fake.setUi).toHaveBeenCalledWith({contextOpen:false});
});
