import { expect, it, vi } from "vitest";
vi.mock("../src/api/events", () => ({ runEventStream: vi.fn(async () => {}), globalEventStreamUrl: () => "http://localhost/global/event", eventStreamUrl: () => "http://localhost/event" }));
it("opening a child retains its own model and agent without adding it to root sidebar chats", async () => {
 const { store } = await import("../src/state/store");
 const child = { id: "child", parentID: "parent", directory: "/test/project", title: "Child", projectID: "p", agent: "child-agent", model: { providerID: "p", id: "child-model", variant: "medium" }, time: { created: 1, updated: 1 } };
 store.state = { ...store.state, directory: child.directory, activeSessionId: "parent", sessions: [], connectedProviderIds: ["p"], prefs: { ...store.state.prefs, modelChoice: { "/test/project": { providerID: "p", modelID: "root-model" } }, agentChoice: { "/test/project": "root-agent" } } };
 vi.spyOn(store.client, "messages").mockResolvedValue({ messages: [] });
 vi.spyOn(store.client, "getSession").mockResolvedValue(child);
 await store.openChat(child);
 expect(store.state.activeSessionId).toBe("child");
 expect(store.getModelChoice()).toEqual({ providerID: "p", modelID: "child-model", variant: "medium" });
 expect(store.getAgentChoice()).toBe("child-agent");
 expect(store.state.sessions.some(s => s.id === "child")).toBe(false);
});
it("updates permissions for an open child without promoting it to the root sidebar",async()=>{
 const { store }=await import("../src/state/store");
 const { accessRules }=await import("../src/state/access");
 const child={id:"child-access",parentID:"parent",directory:"/test/project",title:"Child",projectID:"p",permission:[],time:{created:1,updated:1}};
 store.state={...store.state,directory:child.directory,activeSessionId:null,sessions:[]};
 vi.spyOn(store.client,"messages").mockResolvedValue({messages:[]});
 vi.spyOn(store.client,"updateSession").mockResolvedValue({...child,permission:accessRules("read")});
 await store.openChat(child);await store.setAccessMode("read");
 expect(store.getAccessMode()).toBe("read");expect(store.state.sessions).toEqual([]);
});
