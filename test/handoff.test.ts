import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, OpenCodeClient } from "../src/api/client";
import type { Session } from "../src/api/types";
import { deliverHandoff, handoffConnection, handoffText, prepareHandoff, recipientProfile } from "../src/state/handoff";
import { DEFAULT_PREFS } from "../src/state/prefs";
import { setHostPassword } from "../src/native/hosts";
vi.mock("../src/native/hosts", async (original) => ({ ...(await original<typeof import("../src/native/hosts")>()), connectSsh: vi.fn(async () => "http://127.0.0.1:4500") }));
const session = (id: string, directory: string): Session => ({ id, directory, title: id, projectID: "fixture", time: { created: 1, updated: 1 } });
const sourceSession = session("ses_source", "/source"), target = session("ses_target", "/target");
const sourceClient = new OpenCodeClient();
const source = { session: sourceSession, connection: { client: sourceClient, key: DEFAULT_PREFS.endpoint, hostId: "local", label: "Mac" } };
const client = new OpenCodeClient();
const connection = { client, key: DEFAULT_PREFS.endpoint, hostId: "local", label: "Mac" };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client, "getSession").mockResolvedValue(target);
  vi.spyOn(client, "sessionStatuses").mockResolvedValue({});
  vi.spyOn(client, "pendingPermissions").mockResolvedValue([]);
  vi.spyOn(client, "pendingQuestions").mockResolvedValue([]);
  vi.spyOn(client, "prompt").mockResolvedValue(undefined);
});
it("uses the recipient profile and exact directory, never the source model or permissions", async () => {
  const prefs = { ...DEFAULT_PREFS, modelChoice: { "session:ses_source": { providerID: "source", modelID: "large" }, "session:ses_target": { providerID: "target", modelID: "small", variant: "low" } }, agentChoice: { "session:ses_target": "target-agent" } };
  const receipt = await deliverHandoff(connection, target, source, "Deploy on the second host", "Decision: use port 9090", prefs);
  expect(receipt.state).toBe("accepted");
  expect(client.prompt).toHaveBeenCalledExactlyOnceWith(target.id, "/target", expect.objectContaining({ model: { providerID: "target", modelID: "small" }, agent: "target-agent", variant: "low", messageID: receipt.messageID, parts: [{ type: "text", text: expect.stringContaining("Decision: use port 9090") }] }));
  expect(client.prompt.mock.calls[0][2]).not.toHaveProperty("permission");
});
it("omits absent model overrides so the engine restores the recipient's own defaults", () => {
  expect(recipientProfile({ ...DEFAULT_PREFS, modelChoice: { "*": { providerID: "source", modelID: "big" } } }, DEFAULT_PREFS.endpoint, target)).not.toHaveProperty("model");
});
it("isolates model preferences for the same session ID on another host", () => {
  const prefs = { ...DEFAULT_PREFS, modelChoice: { "session:ses_target": { providerID: "wrong", modelID: "wrong" } }, endpointState: { "ssh:other:4096": { modelChoice: { "session:ses_target": { providerID: "right", modelID: "right" } } } } };
  expect(recipientProfile(prefs, "ssh:other:4096", target).model?.providerID).toBe("right");
});
it("rejects self-send, archived/moved targets and busy recipients without submitting", async () => {
  await expect(deliverHandoff(connection, sourceSession, source, "Task", "Context", DEFAULT_PREFS)).rejects.toThrow("другую");
  vi.mocked(client.getSession).mockResolvedValueOnce({ ...target, time: { ...target.time, archived: 4 } });
  await expect(deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS)).rejects.toThrow("архивирована");
  vi.mocked(client.getSession).mockResolvedValueOnce({ ...target, directory: "/moved" });
  await expect(deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS)).rejects.toThrow("перемещена");
  vi.mocked(client.sessionStatuses).mockResolvedValue({ [target.id]: { type: "busy" } });
  await expect(deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS)).rejects.toThrow("занята");
  expect(client.prompt).not.toHaveBeenCalled();
});
it("does not bypass pending questions even when status is idle", async () => {
  vi.mocked(client.pendingQuestions).mockResolvedValue([{ sessionID: target.id } as any]);
  await expect(deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS)).rejects.toThrow("ожидает ответа");
  expect(client.prompt).not.toHaveBeenCalled();
});
it("does not repeat a prompt after a lost acknowledgement and verifies its exact ID", async () => {
  vi.mocked(client.prompt).mockRejectedValue(new Error("timeout"));
  const request = vi.spyOn(client, "request").mockImplementation(async (_method, path) => ({ info: { id: path.split("/").pop() } }) as any);
  const receipt = await deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS);
  expect(receipt.state).toBe("accepted"); expect(client.prompt).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("GET", `/session/${target.id}/message/${receipt.messageID}`, { query: { directory: "/target" } });
});
it("reports uncertainty rather than success or automatic resend after an unverifiable timeout", async () => {
  vi.mocked(client.prompt).mockRejectedValue(new Error("timeout")); vi.spyOn(client, "request").mockRejectedValue(new Error("offline"));
  expect((await deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS)).state).toBe("uncertain");
  expect(client.prompt).toHaveBeenCalledTimes(1);
});
it("surfaces server rejection without claiming delivery", async () => {
  vi.mocked(client.prompt).mockRejectedValue(new ApiError(403, "Denied"));
  await expect(deliverHandoff(connection, target, source, "Task", "Context", DEFAULT_PREFS)).rejects.toThrow("Denied");
});
it("bounds the packet and distinguishes source environment from destination", () => {
  expect(handoffText(source, "Deploy elsewhere", "Use SSH alias machine-a")).toContain('"project":"/source"');
  expect(handoffText(source, "Deploy elsewhere", "context")).toContain("не считай их своим окружением");
  expect(() => handoffText(source, "", "ctx")).toThrow();
  expect(() => handoffText(source, "task", "x".repeat(24001))).toThrow("24 000");
});
it("uses the destination SSH tunnel and credentials without mutating the source client", async () => {
  setHostPassword("ssh:other:4096", "fixture-password");
  vi.spyOn(OpenCodeClient.prototype, "health").mockResolvedValue({ healthy: true, version: "1.18.18" });
  const next = await handoffConnection({ ...DEFAULT_PREFS, remoteHosts: [{ id: "other", name: "Other host", target: "other", port: 4096 }] }, sourceClient, "other");
  expect(next.client.baseUrl).toBe("http://127.0.0.1:4500"); expect(next.client.headers.Authorization).toBeTruthy();
  expect(sourceClient.headers.Authorization).toBeUndefined(); expect(sourceClient.baseUrl).toBe(DEFAULT_PREFS.endpoint);
  setHostPassword("ssh:other:4096", "");
});
it("prepares from a full fork with tools denied, then archives only that fork", async () => {
  vi.spyOn(sourceClient, "sessionStatuses").mockResolvedValue({});
  const request = vi.spyOn(sourceClient, "request").mockResolvedValue(session("ses_preparation", "/source"));
  const update = vi.spyOn(sourceClient, "updateSession").mockResolvedValue(session("ses_preparation", "/source"));
  const prompt = vi.spyOn(sourceClient, "prompt").mockResolvedValue(undefined);
  vi.spyOn(sourceClient, "messages").mockImplementation(async () => ({ messages: [{ info: { id: "msg_answer", role: "assistant", parentID: prompt.mock.calls[0][2].messageID, time: { created: 1, completed: 2 }, finish: "stop" } as any, parts: [{ id: "part", sessionID: "ses_preparation", messageID: "msg_answer", type: "text", text: "Goal; early decision; files; access; tests; next step" }] }] }));
  const result = await prepareHandoff(source, "Deploy on host B", target, connection, {}, new AbortController().signal, { pollMs: 1, timeoutMs: 1000 });
  expect(result).toContain("early decision");
  expect(request).toHaveBeenCalledWith("POST", "/session/ses_source/fork", { query: { directory: "/source" }, body: {} });
  expect(update.mock.calls[0][1].permission).toEqual([{ permission: "*", pattern: "*", action: "deny" }]);
  expect(update).toHaveBeenLastCalledWith("ses_preparation", { time: { archived: expect.any(Number) } }, "/source");
  expect(prompt.mock.calls[0][0]).toBe("ses_preparation");
  expect(prompt.mock.calls[0][2].parts[0].text).toContain("ВСЕЙ доступной истории");
});
it("refuses concurrent preparation while a source-server task is running", async () => {
  vi.spyOn(sourceClient, "sessionStatuses").mockResolvedValue({ busy: { type: "busy" } });
  const request = vi.spyOn(sourceClient, "request");
  await expect(prepareHandoff(source, "Task", target, connection, {}, new AbortController().signal)).rejects.toThrow("выполняет задачу");
  expect(request).not.toHaveBeenCalled();
});
it("cancels and archives its own preparation without aborting the source", async () => {
  vi.spyOn(sourceClient, "sessionStatuses").mockResolvedValue({});
  vi.spyOn(sourceClient, "request").mockResolvedValue(session("ses_preparation", "/source"));
  const update = vi.spyOn(sourceClient, "updateSession").mockResolvedValue(session("ses_preparation", "/source"));
  const controller = new AbortController();
  vi.spyOn(sourceClient, "prompt").mockImplementation(async () => { controller.abort(); });
  const abort = vi.spyOn(sourceClient, "abort").mockResolvedValue(undefined);
  await expect(prepareHandoff(source, "Task", target, connection, {}, controller.signal)).rejects.toThrow("отменена");
  expect(abort).toHaveBeenCalledExactlyOnceWith("ses_preparation", "/source");
  expect(update).toHaveBeenLastCalledWith("ses_preparation", { time: { archived: expect.any(Number) } }, "/source");
});
