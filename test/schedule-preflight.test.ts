import { expect, it } from "vitest";
import { chatBlocker, liveModelProblem, modelProblem, type ChatActivity } from "../src/schedules/preflight";
import type { ScheduledTask } from "../src/schedules/tasks";

const task: ScheduledTask = { id: "t", server: "local", directory: "/p", sessionID: "s", engine: "opencode", title: "CI", prompt: "check",
  minutes: 15, model: { providerID: "local", modelID: "qwen", variant: "medium" }, agent: "build", enabled: true, nextAt: 0, state: "ready" };
const idle: ChatActivity = { permissions: [], questions: [], queued: 0, running: false, locked: false, dialog: false };
const catalog = (variants: Record<string, object> | null = { medium: {} }) => ({
  all: [{ id: "local", models: { qwen: { id: "qwen", providerID: "local", variants } } }], connected: ["local"], default: null,
});

it("waits for the user's permission, question, dialog and queue before anything else", () => {
  expect(chatBlocker("s", idle)).toBeNull();
  expect(chatBlocker("s", { ...idle, permissions: [{ id: "p", sessionID: "s", permission: "bash" }] })).toContain("разрешения");
  expect(chatBlocker("s", { ...idle, permissions: [{ id: "p", sessionID: "other", permission: "bash" }] })).toBeNull();
  expect(chatBlocker("s", { ...idle, questions: [{ id: "q", sessionID: "s", questions: [] }] })).toContain("ответа");
  expect(chatBlocker("s", { ...idle, dialog: true })).toContain("ответа");
  expect(chatBlocker("s", { ...idle, queued: 1 })).toContain("очереди");
  expect(chatBlocker("s", { ...idle, status: { type: "busy" } })).toContain("занят");
  expect(chatBlocker("s", { ...idle, status: { type: "retry" } })).toContain("занят");
  expect(chatBlocker("s", { ...idle, running: true })).toContain("занят");
});

it("blocks a removed model, disconnected provider, dropped variant or agent; an empty catalog proves nothing", () => {
  expect(modelProblem(task, catalog(), [{ name: "build" }])).toBeNull();
  expect(modelProblem(task, { all: [], connected: [], default: null }, [])).toBeNull();
  expect(modelProblem(task, null, null)).toBeNull();
  expect(modelProblem({ ...task, model: { ...task.model, modelID: "gone" } }, catalog(), [])).toContain("local/gone");
  expect(modelProblem(task, { ...catalog(), connected: ["other"] }, [])).toContain("не подключён");
  expect(modelProblem(task, catalog({ high: {} }), [])).toContain("medium");
  expect(modelProblem(task, catalog(null), [])).toBeNull(); // the server lists no variants: it decides
  expect(modelProblem(task, catalog(), [{ name: "plan" }])).toContain("build");
});

it("never sends a scheduled Pi prompt into a running process with another model", () => {
  const pi = { ...task, engine: "pi", agent: undefined };
  expect(liveModelProblem(pi, { providerID: "local", modelID: "qwen", thinking: "medium" })).toBeNull();
  expect(liveModelProblem(pi, { providerID: "local", modelID: "qwen" })).toBeNull();
  expect(liveModelProblem(pi, { providerID: "cloud", modelID: "big" })).toContain("cloud/big");
  expect(liveModelProblem(pi, { providerID: "local", modelID: "qwen", thinking: "high" })).toContain("high");
  expect(liveModelProblem(pi, null)).toContain("не сообщил");
});
