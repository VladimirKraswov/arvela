import { afterEach, expect, it, vi } from "vitest";
import { DISPATCH_LIMIT_MS, PREFLIGHT_MS, ScheduleBlocked, TaskScheduler, parseTasks, type ScheduledTask } from "../src/schedules/tasks";
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

// A real keyed store, so backups and leases do not collide with the schedule itself.
const KEY = "ocdesktop.scheduled-prompts.v1", LEASE = "ocdesktop.scheduled-prompts.lease.v1";
const keyed = () => {
 const m = new Map<string, string>(); let failing = false;
 return { m, fail: (value: boolean) => { failing = value; }, getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => { if (failing) throw new Error("disk full"); m.set(k, v); } };
};
const untilAbort = (_: ScheduledTask, signal: AbortSignal) =>
 new Promise<{ kind: "cancelled" }>(resolve => signal.addEventListener("abort", () => resolve({ kind: "cancelled" })));
afterEach(() => { vi.useRealTimers(); });

it("a send whose outcome cannot be stored is never treated as due again", async () => {
 const db = keyed(), scheduler = new TaskScheduler(db); scheduler.add(task, 0);
 const dispatch = vi.fn(async () => { db.fail(true); return { kind: "sent" as const }; });
 await expect(scheduler.tick("local", dispatch, 900000)).rejects.toThrow();
 expect(scheduler.snapshot()[0].state).toBe("sent"); expect(scheduler.status().storage).toBe("unavailable");
 db.fail(false);
 await scheduler.tick("local", dispatch, Date.now() + 99999999); expect(dispatch).toHaveBeenCalledOnce();
 expect(() => scheduler.add(task)).toThrow();
});
it("a definite refusal pauses with the app's own explanation instead of 'uncertain delivery'", async () => {
 const scheduler = new TaskScheduler(keyed()); scheduler.add(task, 0);
 await scheduler.tick("local", async () => { throw new ScheduleBlocked("Чат удалён"); }, 900000);
 expect(scheduler.snapshot()[0]).toMatchObject({ enabled: false, state: "error", detail: "Чат удалён" });
});
it("pausing during the pre-send check withdraws it without sending or retrying", async () => {
 const scheduler = new TaskScheduler(keyed()), t = scheduler.add(task, 0);
 let seen: AbortSignal | undefined;
 const dispatch = vi.fn((x: ScheduledTask, signal: AbortSignal) => { seen = signal; return untilAbort(x, signal); });
 const pending = scheduler.tick("local", dispatch, 900000);
 expect(scheduler.status().flight).toBe(t.id);
 scheduler.toggle(t.id); expect(scheduler.status().pending[t.id]).toBe("pause"); expect(seen?.aborted).toBe(true);
 await pending;
 expect(scheduler.snapshot()[0]).toMatchObject({ enabled: false, state: "ready" });
 expect(scheduler.status().flight).toBeNull(); expect(scheduler.status().pending).toEqual({});
 await scheduler.tick("local", dispatch, Date.now() + 99999999); expect(dispatch).toHaveBeenCalledOnce();
});
it("a check that never answers is withdrawn and retried later; a send that never answers pauses", async () => {
 vi.useFakeTimers();
 const scheduler = new TaskScheduler(keyed()); scheduler.add(task, 0);
 const checking = scheduler.tick("local", untilAbort, 900000);
 await vi.advanceTimersByTimeAsync(PREFLIGHT_MS); await checking;
 expect(scheduler.snapshot()[0]).toMatchObject({ enabled: true, state: "waiting" });
 const hung = scheduler.tick("local", () => new Promise(() => {}), 960000);
 await vi.advanceTimersByTimeAsync(DISPATCH_LIMIT_MS); await hung;
 expect(scheduler.snapshot()[0]).toMatchObject({ enabled: false, state: "error" }); expect(scheduler.status().flight).toBeNull();
});
it("unreadable stored data is reported and kept in a backup instead of being overwritten", () => {
 const db = keyed(); db.m.set(KEY, "{not json");
 const scheduler = new TaskScheduler(db); expect(scheduler.status().skipped).toBe(1);
 scheduler.add(task, 0);
 expect(db.m.get(`${KEY}.unreadable`)).toBe("{not json"); expect(parseTasks(db.m.get(KEY)!).tasks).toHaveLength(1);
});
it("drops duplicate ids and unknown fields from stored entries", () => {
 const entry = { ...task, id: "a", enabled: true, nextAt: 1, state: "ready", injected: "<script>" };
 const { tasks, skipped } = parseTasks(JSON.stringify([entry, { ...entry, title: "dup" }]));
 expect(skipped).toBe(1); expect(tasks[0]).not.toHaveProperty("injected"); expect(tasks[0].title).toBe("CI");
});
it("two windows sharing a profile never dispatch the same due task twice and see each other's edits", async () => {
 const db = keyed(), a = new TaskScheduler(db, { owner: "a" }), b = new TaskScheduler(db, { owner: "b" });
 a.add(task, 0); b.refresh(); expect(b.snapshot()).toHaveLength(1);
 const sendA = vi.fn(async () => ({ kind: "sent" as const })), sendB = vi.fn(async () => ({ kind: "sent" as const }));
 await Promise.all([a.tick("local", sendA, 900000), b.tick("local", sendB, 900000)]);
 expect(sendA.mock.calls.length + sendB.mock.calls.length).toBe(1);
 b.remove(b.snapshot()[0].id); await a.tick("local", sendA, Date.now() + 99999999);
 expect(sendA.mock.calls.length + sendB.mock.calls.length).toBe(1); expect(a.snapshot()).toHaveLength(0);
});
it("a 'dispatching' record left by a closed window is paused for review, never resent", async () => {
 const db = keyed(), a = new TaskScheduler(db, { owner: "a" }); a.add(task, 0);
 const stored = JSON.parse(db.m.get(KEY)!); stored[0].state = "dispatching"; db.m.set(KEY, JSON.stringify(stored));
 db.m.set(LEASE, JSON.stringify({ owner: "a", until: Date.now() + 60000 }));
 const b = new TaskScheduler(db, { owner: "b" }); expect(b.snapshot()[0].state).toBe("dispatching"); // a may still be sending
 const send = vi.fn(async () => ({ kind: "sent" as const }));
 await b.tick("local", send, Date.now() + 120000); // a's lease lapsed without renewal
 expect(send).not.toHaveBeenCalled(); expect(b.snapshot()[0]).toMatchObject({ enabled: false, state: "error" });
});
