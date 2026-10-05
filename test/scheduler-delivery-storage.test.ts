import { expect, it } from "vitest";
import { TaskScheduler } from "../src/schedules/tasks";
it("never re-delivers an accepted scheduled prompt when writing its acknowledgement fails", async () => {
 let value: string | null = null, writes = 0, deliveries = 0;
 const scheduler = new TaskScheduler({ getItem: () => value, setItem: (_key, next) => {
   writes++; if (writes === 3) throw new Error("temporary storage failure after acceptance"); value = next;
 } });
 scheduler.add({ server: "local", directory: "/project", sessionID: "s", engine: "opencode", title: "CI", prompt: "check", minutes: 15, model: { providerID: "p", modelID: "m" } }, 0);
 const dispatch = async () => { deliveries++; return { kind: "sent" as const }; };
 await scheduler.tick("local", dispatch, 900000).catch(() => {});
 await scheduler.tick("local", dispatch, 915000);
 expect(deliveries).toBe(1);
});
it("preserves corrupt raw schedules if their backup cannot be written",()=>{
 const key="ocdesktop.scheduled-prompts.v1",raw="{bad schedule";
 const values=new Map([[key,raw]]);
 const scheduler=new TaskScheduler({getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(k.endsWith(".unreadable"))throw new Error("backup denied");values.set(k,v);}});
 expect(scheduler.status().storage).toBe("unavailable");
 expect(()=>scheduler.add({server:"local",directory:"/project",sessionID:"s",engine:"opencode",title:"CI",prompt:"check",minutes:15,model:{providerID:"p",modelID:"m"}})).toThrow();
 expect(values.get(key)).toBe(raw);
});
