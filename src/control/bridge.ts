// Native agent-control bridge.
//
// Commands arrive through the private native socket/MCP adapter, but are
// executed against the same Store instance as the visible UI.  This prevents a
// second automation state machine from drifting away from what the user sees.

import type { PermissionRequest, QuestionRequest } from "../api/types";
import type { EngineId } from "../state/engines";
import { store } from "../state/store";
import { isNative } from "../native/platform";
import { installAgentControlMcp } from "./install";

interface ControlCommand {
  id: string;
  method: string;
  params?: unknown;
}

type Params = Record<string, unknown>;

const MAX_MALFORMED_TOOL_RECOVERIES = 2;
const TOOL_RECOVERY_PROMPT =
  "Системное восстановление: предыдущий ответ завершился без выполнения, потому что вызов инструмента был выведен как обычный текст. Повтори тот же шаг сейчас через настоящий встроенный инструмент OpenCode с корректными структурированными аргументами, затем продолжи исходную задачу. Не описывай XML-теги и не завершай работу до проверки результата.";

interface ManagedRun {
  directory: string;
  messagesBeforeSend: Set<string>;
  recoveredMessages: Set<string>;
  attempts: number;
}

// This state belongs to the long-lived Desktop process, not to the short-lived
// MCP stdio client.  Therefore a later desktop_wait can recover a desktop_send
// even though each MCP invocation used a different process.
const managedRuns = new Map<string, ManagedRun>();

function object(value: unknown): Params {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("parameters must be an object");
  return value as Params;
}

function text(params: Params, name: string, required = true): string | undefined {
  const value = params[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && !value.trim()))
    throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function integer(
  params: Params,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = params[name] ?? fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value as number;
}

function boolean(params: Params, name: string, fallback: boolean): boolean {
  const value = params[name] ?? fallback;
  if (typeof value !== "boolean") throw new Error(`${name} must be boolean`);
  return value;
}

function engine(params: Params, required = false): EngineId | undefined {
  const id = text(params, "engine", required);
  if (id === undefined) return undefined;
  if (id !== "opencode" && id !== "pi")
    throw new Error("engine must be opencode or pi");
  return id;
}

function activeStatus(sessionId: string | null = store.state.activeSessionId) {
  if (!sessionId) return { type: "idle" };
  return (
    store.state.activityStatuses[sessionId] ??
    store.state.statuses[sessionId] ??
    store.state.chat.sessions[sessionId]?.status ??
    { type: "idle" }
  );
}

function sessionSummary(session: (typeof store.state.sessions)[number]) {
  return {
    id: session.id,
    title: session.title,
    directory: session.directory,
    engine: store.engineIdFor(session.id, session.directory),
    status: activeStatus(session.id),
    updated: session.time.updated,
    archived: session.time.archived ?? null,
    agent: session.agent ?? null,
    model: session.model ?? null,
  };
}

function pending(sessionId: string) {
  const interactions = store.pendingInteraction(sessionId);
  return {
    permissions: interactions.permissions,
    questions: interactions.questions,
  };
}

function status() {
  const id = store.state.activeSessionId;
  const model = store.getModelChoice();
  const interactions = id ? pending(id) : { permissions: [], questions: [] };
  return {
    connection: store.state.connection,
    directory: store.state.directory,
    sessionId: id,
    engine: store.engineIdFor(),
    model,
    agent: store.getAgentChoice(),
    status: activeStatus(id),
    sending: store.state.ui.sending,
    error: store.state.ui.sendError ?? store.state.ui.historyError,
    pending: {
      permissions: interactions.permissions.length,
      questions: interactions.questions.length,
    },
    view: {
      settingsOpen: store.state.ui.settingsOpen,
      sidebarOpen: store.state.prefs.layout.sidebarOpen,
      reviewOpen: store.state.prefs.layout.rightOpen,
      terminalOpen: store.state.prefs.layout.bottomOpen,
    },
  };
}

async function selectDirectory(directory: string): Promise<void> {
  if (store.state.directory === directory) return;
  const known = store.state.projects.some((project) => project.worktree === directory);
  if (known) await store.setDirectory(directory);
  else await store.addProjectDirectory(directory);
  if (store.state.directory !== directory)
    throw new Error(`OpenCode Desktop did not select ${directory}`);
}

async function selectSession(directory: string, sessionId?: string): Promise<void> {
  await selectDirectory(directory);
  if (sessionId) {
    if (!store.state.sessions.some((session) => session.id === sessionId))
      await store.refreshSessions();
    if (!store.state.sessions.some((session) => session.id === sessionId))
      throw new Error(`session ${sessionId} is not available in ${directory}`);
    await store.selectSession(sessionId);
  }
}

function configure(params: Params): void {
  const providerID = text(params, "provider_id", false);
  const modelID = text(params, "model_id", false);
  if (Boolean(providerID) !== Boolean(modelID))
    throw new Error("provider_id and model_id must be supplied together");
  if (providerID && modelID) {
    const variant = params.variant;
    if (variant !== undefined && variant !== null && typeof variant !== "string")
      throw new Error("variant must be a string or null");
    store.setModelChoice(providerID, modelID, (variant as string | null | undefined) ?? null);
  }
  const agent = text(params, "agent", false);
  if (agent) store.setAgentOverride(store.state.directory ?? "*", agent);
}

async function send(params: Params) {
  const directory = text(params, "directory")!;
  const sessionId = text(params, "session_id", false);
  const requestedEngine = engine(params);
  await selectSession(directory, sessionId);
  if (!sessionId) {
    await store.selectSession(null);
    if (requestedEngine) store.setSessionEngine(null, requestedEngine);
  } else if (
    requestedEngine &&
    store.engineIdFor(sessionId, directory) !== requestedEngine
  ) {
    throw new Error(
      "an existing chat cannot change engines; create a new chat or use the existing engine",
    );
  }
  configure(params);
  const messagesBeforeSend = new Set(
    store.state.activeSessionId
      ? (store.state.chat.sessions[store.state.activeSessionId]?.messageOrder ?? [])
      : [],
  );
  const accepted = await store.sendPrompt(text(params, "text")!);
  const acceptedSession = store.state.activeSessionId;
  if (!accepted || !acceptedSession) {
    throw new Error(store.state.ui.sendError ?? "the prompt was not accepted");
  }
  managedRuns.set(acceptedSession, {
    directory,
    messagesBeforeSend,
    recoveredMessages: new Set(),
    attempts: 0,
  });
  return {
    accepted: true,
    sessionId: acceptedSession,
    directory,
    engine: store.engineIdFor(acceptedSession, directory),
    status: activeStatus(acceptedSession),
  };
}

function waitForStateChange(sessionId: string, deadline: number): Promise<unknown> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    let unsubscribe = () => {};
    const finish = (result: unknown) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    const inspect = () => {
      const interaction = pending(sessionId);
      const runStatus = activeStatus(sessionId);
      const running =
        runStatus.type === "busy" ||
        runStatus.type === "retry" ||
        (store.state.activeSessionId === sessionId && store.state.ui.sending);
      if (interaction.permissions.length || interaction.questions.length) {
        finish({ outcome: "needs_input", status: runStatus, ...interaction });
      } else if (store.state.chat.sessions[sessionId]?.lastError) {
        finish({
          outcome: "failed",
          status: runStatus,
          error: store.state.chat.sessions[sessionId].lastError,
        });
      } else if (!running) {
        finish({ outcome: "idle", status: runStatus });
      } else if (Date.now() >= deadline) {
        finish({ outcome: "timeout", status: runStatus });
      }
    };
    unsubscribe = store.subscribe(inspect);
    timer = setTimeout(inspect, Math.max(0, deadline - Date.now()));
    inspect();
  });
}

function malformedToolCallMessage(
  message: { id: string; role: string; finish?: string | null },
  parts: Array<{ type: string; text?: string }>,
): boolean {
  if (message.role !== "assistant" || message.finish !== "stop") return false;
  if (parts.some((part) => part.type === "tool")) return false;
  const output = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  return (
    output.includes("<tool_call>") &&
    output.includes("<function=") &&
    (output.includes("<parameter=") || output.includes("</parameter>"))
  );
}

function recoverableMalformedToolMessage(sessionId: string, run: ManagedRun) {
  const chat = store.state.chat.sessions[sessionId];
  if (!chat) return null;
  for (const messageId of [...chat.messageOrder].reverse()) {
    if (run.messagesBeforeSend.has(messageId) || run.recoveredMessages.has(messageId)) continue;
    const message = chat.messages[messageId];
    if (!message || message.role !== "assistant") continue;
    const parts = (chat.partsByMessage[messageId] ?? [])
      .map((partId) => chat.parts[partId])
      .filter((part): part is NonNullable<typeof part> => Boolean(part));
    return malformedToolCallMessage(message, parts) ? message : null;
  }
  return null;
}

async function waitUntilSettled(sessionId: string, timeoutSeconds: number): Promise<unknown> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const result = (await waitForStateChange(sessionId, deadline)) as {
      outcome: string;
      status: unknown;
      [key: string]: unknown;
    };
    if (result.outcome !== "idle") return { ...result, timeoutSeconds };

    const run = managedRuns.get(sessionId);
    if (!run) return result;
    const malformed = recoverableMalformedToolMessage(sessionId, run);
    if (!malformed) {
      managedRuns.delete(sessionId);
      return result;
    }
    if (run.attempts >= MAX_MALFORMED_TOOL_RECOVERIES) {
      managedRuns.delete(sessionId);
      return {
        outcome: "recovery_exhausted",
        status: result.status,
        attempts: run.attempts,
        messageId: malformed.id,
      };
    }

    // Keep the recovery in the same visible conversation. Selection is explicit
    // because the user may have inspected another chat between send and wait.
    await selectSession(run.directory, sessionId);
    run.recoveredMessages.add(malformed.id);
    run.attempts += 1;
    const accepted = await store.sendPrompt(TOOL_RECOVERY_PROMPT);
    if (!accepted) {
      managedRuns.delete(sessionId);
      return {
        outcome: "recovery_failed",
        status: activeStatus(sessionId),
        attempts: run.attempts,
        error: store.state.ui.sendError ?? "OpenCode rejected the recovery prompt",
      };
    }
    if (Date.now() >= deadline) {
      return {
        outcome: "timeout",
        status: activeStatus(sessionId),
        timeoutSeconds,
        recoveryAttempted: true,
      };
    }
  }
}

function conversation(sessionId: string, limit: number, maxChars: number) {
  const chat = store.state.chat.sessions[sessionId];
  if (!chat) return { sessionId, status: activeStatus(sessionId), messages: [] };
  const selected = chat.messageOrder.slice(-limit);
  const messages: unknown[] = [];
  let chars = 0;
  // Prefer the newest turns when the caller's byte budget cannot hold all of
  // them. Tool payloads can contain megabytes, so project only useful fields.
  for (const id of [...selected].reverse()) {
    const info = chat.messages[id];
    const item = {
      info: info
        ? {
            id: info.id,
            role: info.role,
            time: info.time,
            error: info.error,
            ...("agent" in info ? { agent: info.agent } : {}),
            ...(info.role === "assistant"
              ? { modelID: info.modelID, providerID: info.providerID, finish: info.finish }
              : { model: info.model }),
          }
        : null,
      parts: (chat.partsByMessage[id] ?? []).map((partId) => {
        const part = chat.parts[partId];
        const state = part.state
          ? {
              status: part.state.status,
              title: part.state.title,
              output:
                typeof part.state.output === "string"
                  ? part.state.output.slice(0, 20_000)
                  : part.state.output,
              error: part.state.error,
            }
          : undefined;
        return {
          id: part.id,
          type: part.type,
          text: part.text?.slice(0, 40_000),
          tool: part.tool,
          state,
        };
      }),
    };
    const size = JSON.stringify(item).length;
    if (chars + size > maxChars) {
      if (!messages.length) {
        messages.push({
          info: item.info,
          parts: [{ type: "truncated", text: JSON.stringify(item).slice(0, maxChars) }],
        });
      }
      break;
    }
    messages.unshift(item);
    chars += size;
  }
  return {
    sessionId,
    status: chat.status,
    lastError: chat.lastError,
    truncated: selected.length > messages.length,
    messages,
  };
}

async function execute(method: string, raw: unknown): Promise<unknown> {
  const params = object(raw ?? {});
  switch (method) {
    case "status":
      return status();
    case "projects":
      if (boolean(params, "refresh", true)) await store.refreshProjects();
      return store.state.projects.map((project) => ({
        id: project.id,
        directory: project.worktree,
        vcs: project.vcs,
        selected: project.worktree === store.state.directory,
      }));
    case "select": {
      const directory = text(params, "directory")!;
      const sessionId = text(params, "session_id", false);
      await selectSession(directory, sessionId);
      return status();
    }
    case "sessions": {
      const directory = text(params, "directory")!;
      await selectDirectory(directory);
      if (boolean(params, "refresh", true)) await store.refreshSessions();
      return [...store.state.sessions, ...store.state.archivedSessions].map(sessionSummary);
    }
    case "new_chat": {
      const directory = text(params, "directory")!;
      await selectDirectory(directory);
      await store.selectSession(null);
      const requestedEngine = engine(params);
      if (requestedEngine) store.setSessionEngine(null, requestedEngine);
      return status();
    }
    case "configure":
      configure(params);
      return status();
    case "send":
      return send(params);
    case "wait":
      return waitUntilSettled(
        text(params, "session_id")!,
        integer(params, "timeout_seconds", 120, 1, 300),
      );
    case "conversation": {
      const directory = text(params, "directory")!;
      const sessionId = text(params, "session_id")!;
      await selectSession(directory, sessionId);
      return conversation(
        sessionId,
        integer(params, "limit", 40, 1, 200),
        integer(params, "max_chars", 120_000, 1_000, 500_000),
      );
    }
    case "stop": {
      const sessionId = text(params, "session_id")!;
      await store.stopSession(sessionId);
      managedRuns.delete(sessionId);
      return { stopped: true, sessionId, status: activeStatus(sessionId) };
    }
    case "interactions":
      return pending(text(params, "session_id")!);
    case "reply_permission": {
      const requestId = text(params, "request_id")!;
      const reply = text(params, "reply")!;
      if (reply !== "once" && reply !== "always" && reply !== "reject")
        throw new Error("reply must be once, always or reject");
      const request = store.state.chat.permissions[requestId] as PermissionRequest | undefined;
      if (!request) throw new Error(`permission request ${requestId} is not pending`);
      if (request.sessionID !== store.state.activeSessionId)
        throw new Error("open the permission request's session before replying");
      await store.replyPermission(request, reply);
      return { replied: true, requestId, reply };
    }
    case "answer_question": {
      const requestId = text(params, "request_id")!;
      const request = store.state.chat.questions[requestId] as QuestionRequest | undefined;
      if (!request) throw new Error(`question ${requestId} is not pending`);
      if (request.sessionID !== store.state.activeSessionId)
        throw new Error("open the question's session before replying");
      if (boolean(params, "reject", false)) {
        await store.rejectQuestion(request);
        return { rejected: true, requestId };
      }
      const answers = params.answers;
      if (
        !Array.isArray(answers) ||
        !answers.every(
          (answer) => Array.isArray(answer) && answer.every((item) => typeof item === "string"),
        )
      )
        throw new Error("answers must be an array of string arrays");
      await store.replyQuestion(request, answers as string[][]);
      return { answered: true, requestId };
    }
    case "set_view": {
      if (params.settings_open !== undefined)
        store.setUi({ settingsOpen: boolean(params, "settings_open", false) });
      const layout: Partial<typeof store.state.prefs.layout> = {};
      if (params.sidebar_open !== undefined)
        layout.sidebarOpen = boolean(params, "sidebar_open", false);
      if (params.review_open !== undefined)
        layout.rightOpen = boolean(params, "review_open", false);
      if (params.terminal_open !== undefined) {
        const open = boolean(params, "terminal_open", false);
        if (open !== store.state.prefs.layout.bottomOpen) await store.toggleTerminal();
      }
      if (Object.keys(layout).length) store.setLayout(layout);
      return status();
    }
    case "install_mcp":
      return {
        enabled: boolean(params, "enabled", true),
        notice: await installAgentControlMcp(boolean(params, "enabled", true)),
      };
    default:
      throw new Error(`unknown desktop control method: ${method}`);
  }
}

let stopBridge: (() => void) | null = null;

export async function startAgentControl(): Promise<() => void> {
  if (!isNative() || stopBridge) return stopBridge ?? (() => {});
  const [{ listen }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ]);
  const unlisten = await listen<ControlCommand>("agent-control://command", (event) => {
    const command = event.payload;
    void execute(command.method, command.params ?? {})
      .then((result) =>
        invoke("agent_control_complete", {
          completion: { id: command.id, result, error: null },
        }),
      )
      .catch((error) =>
        invoke("agent_control_complete", {
          completion: {
            id: command.id,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          },
        }),
      );
  });
  await invoke("agent_control_ready", { ready: true });
  stopBridge = () => {
    void invoke("agent_control_ready", { ready: false });
    unlisten();
    stopBridge = null;
  };
  return stopBridge;
}

export const agentControlForTest = { execute, malformedToolCallMessage };
