import { expect, it, vi } from "vitest";
import { TaskScheduler, type ScheduledTask } from "../src/schedules/tasks";
const task = { server: "local", directory: "/project", sessionID: "s", engine: "opencode", title: "CI", prompt: "Проверь CI", minutes: 15, model: { providerID: "p", modelID: "m", variant: "medium" } };
const storage = () => { let value: string | null = null; return { getItem: () => value, setItem: (_: string, v: string) => { value = v; } }; };
it("runs only the original server at the interval and never catches up missed ticks", async () => {
 const scheduler = new TaskScheduler(storage()); scheduler.add(task, 0);
 const dispatch = vi.fn(async () => ({ kind: "sent" as const }));
 await scheduler.tick("remote", dispatch, 99999999); expect(dispatch).not.toHaveBeenCalled();
 await scheduler.tick("local", dispatch, 99999999); expect(dispatch).toHaveBeenCalledTimes(1);
 await scheduler.tick("local", dispatch, Date.now()); expect(dispatch).toHaveBeenCalledTimes(1);
 expect(scheduler.snapshot()[0].model.variant).toBe("medium");
});
it("waits for busy/permission state without backlog, then sends once", async () => {
 const scheduler = new TaskScheduler(storage());scheduler.add(task, 0);
 const busy=vi.fn(async()=>({kind:"waiting" as const,detail:"Агент занят"}));
 await scheduler.tick("local",busy,900000);await scheduler.tick("local",busy,900001);expect(busy).toHaveBeenCalledTimes(1);
 expect(scheduler.snapshot()[0].state).toBe("waiting");
 const send=vi.fn(async()=>({kind:"sent" as const}));await scheduler.tick("local",send,915000);expect(send).toHaveBeenCalledTimes(1);
});
it("serializes ticks and persists dispatch before the network side effect",async()=>{
 const db=storage(),scheduler=new TaskScheduler(db);scheduler.add(task,0);
 let resolve!:(value:{kind:"sent"})=>void;
 const dispatch=vi.fn(()=>new Promise<{kind:"sent"}>(r=>{resolve=r;}));
 const pending=scheduler.tick("local",dispatch,900000);await scheduler.tick("local",dispatch,900000);
 expect(dispatch).toHaveBeenCalledTimes(1);expect(JSON.parse(db.getItem()!)[0].state).toBe("dispatching");
 scheduler.remove(scheduler.snapshot()[0].id);expect(scheduler.snapshot()).toHaveLength(1);
 resolve({kind:"sent"});await pending;
});
it("pauses ambiguous delivery, including a restart during dispatch; never stores error bodies",async()=>{
 const db=storage(),scheduler=new TaskScheduler(db);scheduler.add(task,0);
 const dispatch=vi.fn(async()=>{throw new Error("secret-token");});await scheduler.tick("local",dispatch,900000);await scheduler.tick("local",dispatch,99999999);
 expect(dispatch).toHaveBeenCalledTimes(1);expect(scheduler.snapshot()[0].enabled).toBe(false);expect(db.getItem()).not.toContain("secret-token");
 const crashed:ScheduledTask={...scheduler.snapshot()[0],enabled:true,state:"dispatching"};db.setItem("",JSON.stringify([crashed]));
 const restored=new TaskScheduler(db);expect(restored.snapshot()[0].enabled).toBe(false);
 await restored.tick("local",dispatch,Date.now()+99999999);expect(dispatch).toHaveBeenCalledTimes(1);
});
it("rejects corrupted/unbounded schedules and stops when durable storage fails",async()=>{
 const db=storage();db.setItem("",JSON.stringify([{...task,id:"bad",enabled:true,nextAt:1,state:"ready",minutes:0}]));
 const scheduler=new TaskScheduler(db);expect(scheduler.snapshot()).toHaveLength(0);
 expect(()=>scheduler.add({...task,prompt:" ".repeat(5)})).toThrow();
 const fail=new TaskScheduler({getItem:()=>null,setItem:()=>{throw new Error("disk");}});expect(()=>fail.add(task)).toThrow();
});
it("retains tasks across relaunch, postpones stale intervals and allows explicit pause/resume/delete",()=>{
 const db=storage(),scheduler=new TaskScheduler(db),t=scheduler.add(task,0);
 const restored=new TaskScheduler(db);expect(restored.snapshot()[0].nextAt).toBeGreaterThan(Date.now());
 restored.toggle(t.id);expect(restored.snapshot()[0].enabled).toBe(false);restored.toggle(t.id);expect(restored.snapshot()[0].enabled).toBe(true);
 restored.remove(t.id);expect(new TaskScheduler(db).snapshot()).toHaveLength(0);
});
