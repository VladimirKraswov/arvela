// Pure stream reducer: normalizes OpenCode events into per-session chat state.
// Keyed by session/message/part ids; deduplicates replayed events; tolerates
// deltas that arrive before the part snapshot (creates a provisional part).

import type {
  Message,
  MessagePart,
  PermissionRequest,
  QuestionRequest,
  ServerEvent,
  SessionStatus,
} from "../api/types";

export interface SessionChatState {
  messageOrder: string[];
  messages: Record<string, Message>;
  partsByMessage: Record<string, string[]>;
  parts: Record<string, MessagePart>;
  status: SessionStatus;
  lastError: string | null;
  lastEventAt: number;
}

export interface ChatRootState {
  sessions: Record<string, SessionChatState>;
  permissions: Record<string, PermissionRequest>;
  questions: Record<string, QuestionRequest>;
  sessionPatched: Record<string, number>; // session -> bump counter on session.updated/diff
  seenEventIds: string[];
  seenEventIndex: Record<string, true>;
}

export function emptySessionChat(): SessionChatState {
  return {
    messageOrder: [],
    messages: {},
    partsByMessage: {},
    parts: {},
    status: { type: "idle" },
    lastError: null,
    lastEventAt: 0,
  };
}

export function emptyChatRoot(): ChatRootState {
  return {
    sessions: {},
    permissions: {},
    questions: {},
    sessionPatched: {},
    seenEventIds: [],
    seenEventIndex: {},
  };
}

const DEDUPE_CAP = 4000;

function seen(root: ChatRootState, id: string | undefined): boolean {
  if (!id) return false;
  if (root.seenEventIndex[id]) return true;
  root.seenEventIndex[id] = true;
  root.seenEventIds.push(id);
  if (root.seenEventIds.length > DEDUPE_CAP) {
    for (const drop of root.seenEventIds.splice(
      0,
      root.seenEventIds.length - DEDUPE_CAP,
    )) {
      delete root.seenEventIndex[drop];
    }
  }
  return false;
}

function sessionSlot(root: ChatRootState, sessionID: string): SessionChatState {
  return (root.sessions[sessionID] ??= emptySessionChat());
}

function upsertPart(state: SessionChatState, part: MessagePart): void {
  if (!part?.id || !part.messageID) return;
  const existing = state.parts[part.id];
  if (!existing) {
    state.parts[part.id] = part;
    const order = (state.partsByMessage[part.messageID] ??= []);
    if (!order.includes(part.id)) order.push(part.id);
  } else {
    // Keep accumulated streaming text if snapshot arrives with stale/empty text.
    const merged = { ...existing, ...part };
    if (
      existing.type === "text" &&
      (part.text === undefined || part.text === "") &&
      existing.text
    ) {
      merged.text = existing.text;
    }
    if (
      existing.type === "reasoning" &&
      (part.text === undefined || part.text === "") &&
      existing.text
    ) {
      merged.text = existing.text;
    }
    if (
      part.type === "tool" &&
      part.state?.status === "pending" &&
      existing.state &&
      existing.state.status !== "pending"
    ) {
      merged.state = existing.state;
    }
    state.parts[part.id] = merged;
    if (!state.partsByMessage[part.messageID]) {
      (state.partsByMessage[part.messageID] ??= []).push(part.id);
    }
  }
}

/** Apply one server event. Mutates `root` (callers keep the outer React state frozen by cloning shallowly). */
export function reduceEvent(root: ChatRootState, event: ServerEvent): boolean {
  const props = (event.properties ?? {}) as Record<string, unknown>;
  const sessionID =
    typeof props.sessionID === "string" ? props.sessionID : undefined;
  let changed = false;

  switch (event.type) {
    case "message.updated": {
      const info = props.info as Message | undefined;
      if (!info?.id || !info.sessionID) break;
      if (seen(root, event.id)) break;
      const slot = sessionSlot(root, info.sessionID);
      if (!slot.messages[info.id]) slot.messageOrder.push(info.id);
      const prev = slot.messages[info.id];
      slot.messages[info.id] = prev ? { ...prev, ...info } : info;
      if (info.role === "assistant" && info.error) {
        slot.lastError = describeMessageError(info.error);
      }
      slot.lastEventAt = Date.now();
      changed = true;
      break;
    }
    case "message.part.updated": {
      const part = props.part as MessagePart | undefined;
      if (!part?.id) break;
      if (seen(root, event.id)) break;
      const slot = sessionSlot(root, part.sessionID);
      upsertPart(slot, part);
      slot.lastEventAt = Date.now();
      changed = true;
      break;
    }
    case "message.part.delta": {
      const { messageID, partID, field, delta } = props as {
        messageID?: string;
        partID?: string;
        field?: string;
        delta?: string;
      };
      if (
        !sessionID ||
        !messageID ||
        !partID ||
        field !== "text" ||
        typeof delta !== "string"
      )
        break;
      if (seen(root, event.id)) break;
      const slot = sessionSlot(root, sessionID);
      const part = slot.parts[partID];
      if (part) {
        slot.parts[partID] = { ...part, text: (part.text ?? "") + delta };
      } else {
        // Provisional part; the authoritative snapshot merges later without losing text.
        upsertPart(slot, {
          id: partID,
          sessionID,
          messageID,
          type: "text",
          text: delta,
        });
      }
      slot.lastEventAt = Date.now();
      changed = true;
      break;
    }
    case "message.part.removed": {
      const partID = props.partID as string | undefined;
      if (!sessionID || !partID) break;
      const slot = root.sessions[sessionID];
      if (slot?.parts[partID]) {
        const msg = slot.parts[partID].messageID;
        slot.partsByMessage[msg] = (slot.partsByMessage[msg] ?? []).filter(
          (p) => p !== partID,
        );
        delete slot.parts[partID];
        changed = true;
      }
      break;
    }
    case "message.removed": {
      const messageID = props.messageID as string | undefined;
      if (!sessionID || !messageID) break;
      const slot = root.sessions[sessionID];
      if (slot?.messages[messageID]) {
        delete slot.messages[messageID];
        slot.messageOrder = slot.messageOrder.filter((m) => m !== messageID);
        for (const pid of slot.partsByMessage[messageID] ?? [])
          delete slot.parts[pid];
        delete slot.partsByMessage[messageID];
        changed = true;
      }
      break;
    }
    case "session.status": {
      if (!sessionID) break;
      const slot = sessionSlot(root, sessionID);
      slot.status = (props.status as SessionStatus) ?? { type: "idle" };
      if (slot.status.type === "busy") slot.lastError = null;
      changed = true;
      break;
    }
    case "session.idle": {
      if (!sessionID) break;
      const slot = sessionSlot(root, sessionID);
      slot.status = { type: "idle" };
      changed = true;
      break;
    }
    case "session.error": {
      const target = sessionID ?? String(props.sessionID ?? "");
      const slot = sessionSlot(root, target);
      slot.status = { type: "idle" };
      slot.lastError = describeMessageError(props.error) || "Session error";
      changed = true;
      break;
    }
    case "session.updated":
    case "session.diff": {
      if (!sessionID) break;
      root.sessionPatched[sessionID] =
        (root.sessionPatched[sessionID] ?? 0) + 1;
      changed = true;
      break;
    }
    case "permission.asked":
    case "permission.v2.asked": {
      const req = props as unknown as PermissionRequest;
      if (!req?.id || !req.sessionID) break;
      root.permissions[req.id] = req;
      changed = true;
      break;
    }
    case "permission.replied":
    case "permission.v2.replied": {
      const id = props.requestID as string | undefined;
      if (id && root.permissions[id]) {
        delete root.permissions[id];
        changed = true;
      }
      break;
    }
    case "question.asked":
    case "question.v2.asked": {
      const req = props as unknown as QuestionRequest;
      if (!req?.id || !req.sessionID) break;
      root.questions[req.id] = req;
      changed = true;
      break;
    }
    case "question.replied":
    case "question.rejected":
    case "question.v2.replied":
    case "question.v2.rejected": {
      const id = props.requestID as string | undefined;
      if (id && root.questions[id]) {
        delete root.questions[id];
        changed = true;
      }
      break;
    }
    default:
      break;
  }
  return changed;
}

/**
 * Absolute paths touched by `patch` parts of a session. Verified against 1.18.18:
 * `/session/{id}/diff` can legitimately return [] even after a successful write tool,
 * while the stream's patch parts carry the real file list — this is the only truthful
 * per-session change signal, so the UI must use it rather than claim "no changes".
 */
export function sessionPatchFiles(
  slot: SessionChatState | undefined,
): string[] {
  if (!slot) return [];
  const out = new Set<string>();
  for (const id of Object.keys(slot.parts)) {
    const part = slot.parts[id] as MessagePart & { files?: unknown };
    if (part.type === "patch" && Array.isArray(part.files)) {
      for (const f of part.files) if (typeof f === "string") out.add(f);
    }
  }
  return [...out];
}

export function describeMessageError(error: unknown): string {
  if (!error) return "";
  const e = error as {
    name?: string;
    data?: { message?: string; statusCode?: number };
    message?: string;
  };
  if (e.name === "MessageOutputLengthError")
    return "Output budget exhausted for this step (output length limit).";
  if (e.name === "MessageAbortedError") return "The response was aborted.";
  if (e.name === "ContextOverflowError")
    return "Context window overflowed — consider compaction or a new session.";
  if (e.data?.message) return String(e.data.message);
  return e.message ?? String(error);
}

/** Replace one session's history from authoritative server data (initial load + resync). */
export function applyHistory(
  root: ChatRootState,
  sessionID: string,
  messages: Array<{ info: Message; parts: MessagePart[] }>,
): void {
  const slot = emptySessionChat();
  slot.status = root.sessions[sessionID]?.status ?? { type: "idle" };
  slot.lastError = root.sessions[sessionID]?.lastError ?? null;
  for (const { info, parts } of messages) {
    if (!slot.messages[info.id]) slot.messageOrder.push(info.id);
    slot.messages[info.id] = info;
    for (const part of parts) upsertPart(slot, part);
  }
  root.sessions[sessionID] = slot;
}

/** Merge an older history page (pagination cursor) without reordering or dropping newer live messages. */
export function prependHistory(
  root: ChatRootState,
  sessionID: string,
  messages: Array<{ info: Message; parts: MessagePart[] }>,
): void {
  const slot = sessionSlot(root, sessionID);
  const fresh: string[] = [];
  for (const { info, parts } of messages) {
    if (!slot.messages[info.id]) {
      fresh.push(info.id);
      slot.messages[info.id] = info;
    } else {
      slot.messages[info.id] = info;
    }
    for (const part of parts) upsertPart(slot, part);
  }
  if (fresh.length > 0) slot.messageOrder = [...fresh, ...slot.messageOrder];
}

export function pendingForSession(
  root: ChatRootState,
  sessionID: string,
): {
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
} {
  return {
    permissions: Object.values(root.permissions).filter(
      (p) => p.sessionID === sessionID,
    ),
    questions: Object.values(root.questions).filter(
      (q) => q.sessionID === sessionID,
    ),
  };
}

/** Reconcile a history snapshot with live parts without applying a delta twice.
 * The HTTP snapshot may already contain those tokens. Prefer the more advanced
 * prefix, and keep changes to other sessions out of this reconciliation.
 */
export function reconcileHistoryEvents(
  root: ChatRootState,
  sessionID: string,
  live: SessionChatState | undefined,
  events: ServerEvent[],
): void {
  const partIDs = new Set<string>();
  for (const event of events) {
    const props = event.properties as
      | {
          sessionID?: string;
          part?: MessagePart;
          info?: Message;
          partID?: string;
        }
      | undefined;
    if (
      !props ||
      (props.sessionID ?? props.part?.sessionID ?? props.info?.sessionID) !==
        sessionID
    )
      continue;
    if (event.type.startsWith("message.part.")) {
      const id = props.part?.id ?? props.partID;
      if (typeof id === "string") partIDs.add(id);
      continue;
    }
    reduceEvent(root, { ...event, id: undefined });
  }
  const target = root.sessions[sessionID];
  if (!target || !live) return;
  for (const id of partIDs) {
    const current = live.parts[id];
    if (!current) {
      delete target.parts[id];
      for (const messageID of Object.keys(target.partsByMessage))
        target.partsByMessage[messageID] = target.partsByMessage[
          messageID
        ].filter((p) => p !== id);
      continue;
    }
    const snapshot = target.parts[id];
    if (
      typeof snapshot?.text === "string" &&
      typeof current.text === "string" &&
      snapshot.text.startsWith(current.text)
    )
      continue;
    upsertPart(target, current);
  }
}
