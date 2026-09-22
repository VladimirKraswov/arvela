import { beforeEach, expect, it, vi } from "vitest";
import { accessRules, accessMode } from "../src/state/access";
import { newMessageId } from "../src/state/queue";
vi.mock("../src/api/events", () => ({
  eventStreamUrl: () => "",
  runEventStream: vi.fn(() => Promise.resolve()),
}));
let store: any;
const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  store = (await import("../src/state/store")).store;
  store.state = {
    ...store.state,
    directory: "/test",
    activeSessionId: "ses_a",
    connection: {
      ...store.state.connection,
      phase: "connected",
      streamState: "open",
    },
    statuses: { ses_a: { type: "busy" } },
    connectedProviderIds: ["p"],
  };
  store.setModelChoice("p", "m", "medium");
  vi.spyOn(store.client, "prompt").mockResolvedValue(undefined);
});
const status = (type: string) =>
  store.handleEvent({
    type: "session.status",
    properties: { sessionID: "ses_a", status: { type } },
  });
it("queues during generation, sends exactly once on idle, and retains captured model", async () => {
  store.setDraft("next");
  expect(store.enqueuePrompt("next")).toBe(true);
  expect(store.getDraft()).toBe("");
  expect(store.client.prompt).not.toHaveBeenCalled();
  store.setModelChoice("p", "other");
  status("idle");
  status("idle");
  await flush();
  expect(store.client.prompt).toHaveBeenCalledTimes(1);
  expect(store.client.prompt.mock.calls[0][2].model.modelID).toBe("m");
  expect(store.getQueue()).toEqual([]);
});
it("steers through the existing engine loop without aborting and ignores double clicks", async () => {
  const abort = vi.spyOn(store.client, "abort");
  store.enqueuePrompt("correction");
  const id = store.getQueue()[0].id;
  await Promise.all([store.steerQueued(id), store.steerQueued(id)]);
  expect(store.client.prompt).toHaveBeenCalledTimes(1);
  expect(abort).not.toHaveBeenCalled();
});
it("stop/error pause queued execution and never auto-retry uncertain POST outcomes", async () => {
  vi.spyOn(store.client, "abort").mockResolvedValue(undefined);
  store.enqueuePrompt("later");
  await store.stopSession("ses_a");
  status("idle");
  await flush();
  expect(store.client.prompt).not.toHaveBeenCalled();
  vi.mocked(store.client.prompt).mockRejectedValue(new Error("timeout"));
  store.resumeQueue();
  await flush();
  expect(store.getQueue()[0].state).toBe("uncertain");
  status("idle");
  store.resumeQueue();
  await flush();
  expect(store.client.prompt).toHaveBeenCalledTimes(1);
});
it("session error does not trigger the remaining queue on idle", async () => {
  store.enqueuePrompt("later");
  store.handleEvent({
    type: "session.error",
    properties: {
      sessionID: "ses_a",
      error: { name: "Aborted", data: { message: "stopped" } },
    },
  });
  status("idle");
  await flush();
  expect(store.client.prompt).not.toHaveBeenCalled();
  expect(store.isQueueArmed()).toBe(false);
});
it("keeps queue in its original session and does not bypass permission waits", async () => {
  store.enqueuePrompt("later");
  store.state.activeSessionId = "ses_b";
  status("idle");
  await flush();
  expect(store.client.prompt).not.toHaveBeenCalled();
  store.state.activeSessionId = "ses_a";
  store.state.chat.permissions.per_a = {
    id: "per_a",
    sessionID: "ses_a",
    permission: "edit",
  };
  await store.steerQueued(store.getQueue()[0].id);
  expect(store.client.prompt).not.toHaveBeenCalled();
});
it("restored queue requires explicit resumption and dictation cannot leak across endpoints", async () => {
  store.state.prefs.queues = {
    ses_a: [
      {
        id: "q",
        text: "later",
        directory: "/test",
        sessionID: "ses_a",
        model: { providerID: "p", modelID: "m" },
        state: "ready",
      },
    ],
  };
  status("idle");
  await flush();
  expect(store.client.prompt).not.toHaveBeenCalled();
  store.appendDictation("http://127.0.0.1:9999", "ses_old", "recognized");
  expect(store.getDraft()).toBe("");
  expect(
    store.state.prefs.endpointState["http://127.0.0.1:9999"].drafts.ses_old,
  ).toBe("recognized");
});
it("applies permission changes only to the selected session and rejects busy changes", async () => {
  store.state.sessions = [{ id: "ses_a", permission: [] }];
  const update = vi
    .spyOn(store.client, "updateSession")
    .mockResolvedValue({ id: "ses_a", permission: accessRules("read") });
  await store.setAccessMode("read");
  expect(update).not.toHaveBeenCalled();
  status("idle");
  await store.setAccessMode("read");
  expect(update).toHaveBeenCalledWith(
    "ses_a",
    { permission: accessRules("read") },
    "/test",
  );
  expect(store.getAccessMode()).toBe("read");
});
it("access mapping is explicit and message IDs retain engine-compatible width and ordering", () => {
  expect(accessRules("full")[0]).toEqual({
    permission: "*",
    pattern: "*",
    action: "allow",
  });
  expect(accessMode(accessRules("ask"))).toBe("ask");
  expect(
    accessMode([{ permission: "bash", pattern: "*", action: "deny" }]),
  ).toBe("custom");
  const a = newMessageId(),
    b = newMessageId();
  expect(a).toMatch(/^msg_[a-zA-Z0-9]{26}$/);
  expect(b > a).toBe(true);
});

it("returning to an endpoint makes interrupted sends reviewable, never stranded or auto-replayed", async () => {
  const { switchEndpointPrefs } = await import("../src/state/prefs");
  const item = {
    id: "q",
    text: "task",
    directory: "/test",
    sessionID: "ses_a",
    model: { providerID: "p", modelID: "m" },
    state: "sending" as const,
  };
  const original = { ...store.state.prefs, queues: { ses_a: [item] } };
  const other = switchEndpointPrefs(original, "http://127.0.0.1:4097");
  const back = switchEndpointPrefs(other, original.endpoint);
  expect(back.queues?.ses_a[0].state).toBe("uncertain");
});
