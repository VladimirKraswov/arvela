import { describe, expect, it } from "vitest";
import {
  applyHistory,
  describeMessageError,
  emptyChatRoot,
  pendingForSession,
  reduceEvent,
  sessionPatchFiles,
  type ChatRootState,
} from "../src/state/chatReducer";
import type { ServerEvent } from "../src/api/types";

function evt(
  type: string,
  id: string | undefined,
  properties: Record<string, unknown>,
): ServerEvent {
  return { id, type, properties } as unknown as ServerEvent;
}

const SID = "ses_1";
const MID = "msg_1";
const PID = "prt_1";

describe("chatReducer stream normalization", () => {
  it("deduplicates replayed events with the same id", () => {
    const root = emptyChatRoot();
    const info = { id: MID, sessionID: SID, role: "assistant" };
    const first = reduceEvent(
      root,
      evt("message.updated", "evt_a", { info, sessionID: SID }),
    );
    const replay = reduceEvent(
      root,
      evt("message.updated", "evt_a", { info, sessionID: SID }),
    );
    expect(first).toBe(true);
    expect(replay).toBe(false);
    expect(root.sessions[SID].messageOrder).toEqual([MID]);
  });

  it("accumulates text deltas in arrival order", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.part.updated", "e1", {
        sessionID: SID,
        part: {
          id: PID,
          messageID: MID,
          sessionID: SID,
          type: "text",
          text: "",
        },
      }),
    );
    for (const [i, chunk] of ["Hel", "lo", "!"].entries()) {
      reduceEvent(
        root,
        evt("message.part.delta", `d${i}`, {
          sessionID: SID,
          messageID: MID,
          partID: PID,
          field: "text",
          delta: chunk,
        }),
      );
    }
    expect(root.sessions[SID].parts[PID].text).toBe("Hello!");
  });

  it("survives deltas that arrive before the part snapshot and keeps streamed text on merge", () => {
    const root = emptyChatRoot();
    // delta first — provisional part
    reduceEvent(
      root,
      evt("message.part.delta", "d1", {
        sessionID: SID,
        messageID: MID,
        partID: PID,
        field: "text",
        delta: "streamed",
      }),
    );
    // stale/empty authoritative snapshot arrives afterwards
    reduceEvent(
      root,
      evt("message.part.updated", "e1", {
        sessionID: SID,
        part: {
          id: PID,
          messageID: MID,
          sessionID: SID,
          type: "text",
          text: "",
        },
      }),
    );
    expect(root.sessions[SID].parts[PID].text).toBe("streamed");
    // a real newer snapshot replaces the provisional text
    reduceEvent(
      root,
      evt("message.part.updated", "e2", {
        sessionID: SID,
        part: {
          id: PID,
          messageID: MID,
          sessionID: SID,
          type: "text",
          text: "final",
        },
      }),
    );
    expect(root.sessions[SID].parts[PID].text).toBe("final");
  });

  it("ignores duplicate deltas after reconnect replay", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.part.delta", "d1", {
        sessionID: SID,
        messageID: MID,
        partID: PID,
        field: "text",
        delta: "ab",
      }),
    );
    reduceEvent(
      root,
      evt("message.part.delta", "d1", {
        sessionID: SID,
        messageID: MID,
        partID: PID,
        field: "text",
        delta: "ab",
      }),
    );
    expect(root.sessions[SID].parts[PID].text).toBe("ab");
  });

  it("removes parts and messages without dangling references", () => {
    const root: ChatRootState = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.updated", "e1", {
        info: { id: MID, sessionID: SID, role: "assistant" },
        sessionID: SID,
      }),
    );
    reduceEvent(
      root,
      evt("message.part.updated", "e2", {
        sessionID: SID,
        part: {
          id: PID,
          messageID: MID,
          sessionID: SID,
          type: "text",
          text: "x",
        },
      }),
    );
    reduceEvent(
      root,
      evt("message.part.removed", "e3", { sessionID: SID, partID: PID }),
    );
    expect(root.sessions[SID].parts[PID]).toBeUndefined();
    expect(root.sessions[SID].partsByMessage[MID]).toEqual([]);
    reduceEvent(
      root,
      evt("message.removed", "e4", { sessionID: SID, messageID: MID }),
    );
    expect(root.sessions[SID].messages[MID]).toBeUndefined();
    expect(root.sessions[SID].messageOrder).toEqual([]);
  });

  it("tracks permission lifecycle and pending lookups per session", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("permission.asked", "p1", {
        id: "per_1",
        sessionID: SID,
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
      }),
    );
    expect(pendingForSession(root, SID).permissions.map((p) => p.id)).toEqual([
      "per_1",
    ]);
    expect(pendingForSession(root, "ses_other").permissions).toEqual([]);
    reduceEvent(
      root,
      evt("permission.replied", "p2", {
        requestID: "per_1",
        sessionID: SID,
        reply: "once",
      }),
    );
    expect(pendingForSession(root, SID).permissions).toEqual([]);
  });

  it("records session errors and clears them when the session becomes busy again", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("session.error", undefined, {
        sessionID: SID,
        error: {
          name: "ProviderAuthError",
          data: { message: "not logged in" },
        },
      }),
    );
    expect(root.sessions[SID].lastError).toBe("not logged in");
    expect(root.sessions[SID].status.type).toBe("idle");
    reduceEvent(
      root,
      evt("session.status", undefined, {
        sessionID: SID,
        status: { type: "busy" },
      }),
    );
    expect(root.sessions[SID].lastError).toBeNull();
  });

  it("recognizes known message error shapes", () => {
    expect(describeMessageError({ name: "MessageAbortedError" })).toMatch(
      /aborted/i,
    );
    expect(describeMessageError({ name: "ContextOverflowError" })).toMatch(
      /context/i,
    );
    expect(describeMessageError({ data: { message: "boom" } })).toBe("boom");
  });

  it("applyHistory replaces state authoritatively but keeps live status/error", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.part.delta", "d1", {
        sessionID: SID,
        messageID: MID,
        partID: "prt_tmp",
        field: "text",
        delta: "ghost",
      }),
    );
    reduceEvent(
      root,
      evt("session.status", undefined, {
        sessionID: SID,
        status: { type: "busy" },
      }),
    );
    applyHistory(root, SID, [
      {
        info: { id: MID, sessionID: SID, role: "assistant" } as never,
        parts: [
          {
            id: PID,
            messageID: MID,
            sessionID: SID,
            type: "text",
            text: "real",
          } as never,
        ],
      },
    ]);
    const slot = root.sessions[SID];
    expect(slot.parts["prt_tmp"]).toBeUndefined();
    expect(slot.parts[PID].text).toBe("real");
    expect(slot.status.type).toBe("busy"); // status came from the server, not from history
  });

  it("bumps review refresh counter on session diff/updated", () => {
    const root = emptyChatRoot();
    reduceEvent(root, evt("session.diff", "s1", { sessionID: SID, diff: [] }));
    reduceEvent(
      root,
      evt("session.updated", "s2", { sessionID: SID, info: {} }),
    );
    expect(root.sessionPatched[SID]).toBe(2);
  });
});

describe("sessionPatchFiles (1.18.18: /session/diff may be empty, patch parts are truth)", () => {
  it("collects file paths from patch parts, deduped, ignoring other part types", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.part.updated", "p1", {
        part: {
          id: "a",
          sessionID: SID,
          messageID: MID,
          type: "patch",
          files: ["/tmp/x/a.ts", "/tmp/x/b.ts"],
        },
      }),
    );
    reduceEvent(
      root,
      evt("message.part.updated", "p2", {
        part: {
          id: "b",
          sessionID: SID,
          messageID: MID,
          type: "patch",
          files: ["/tmp/x/b.ts"],
        },
      }),
    );
    reduceEvent(
      root,
      evt("message.part.updated", "p3", {
        part: {
          id: "c",
          sessionID: SID,
          messageID: MID,
          type: "text",
          text: "noise",
        },
      }),
    );
    expect(sessionPatchFiles(root.sessions[SID])).toEqual([
      "/tmp/x/a.ts",
      "/tmp/x/b.ts",
    ]);
  });

  it("returns empty list for missing slot or malformed parts", () => {
    expect(sessionPatchFiles(undefined)).toEqual([]);
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.part.updated", "p1", {
        part: {
          id: "a",
          sessionID: SID,
          messageID: MID,
          type: "patch",
          files: "not-an-array",
        },
      }),
    );
    expect(sessionPatchFiles(root.sessions[SID])).toEqual([]);
  });
});

describe("malformed events never create phantom sessions", () => {
  it("ignores a part without its own session id", () => {
    const root = emptyChatRoot();
    reduceEvent(
      root,
      evt("message.part.updated", "bad-part", {
        part: { id: "a", messageID: MID, type: "text", text: "x" },
      }),
    );
    expect(Object.keys(root.sessions)).toEqual([]);
  });

  it("ignores an unattributed session error instead of keying it under an empty id", () => {
    const root = emptyChatRoot();
    reduceEvent(root, evt("session.error", "bad-error", { error: { message: "boom" } }));
    expect(Object.keys(root.sessions)).toEqual([]);
    // A properly attributed error still lands in its own conversation.
    reduceEvent(root, evt("session.error", "good-error", { sessionID: SID, error: { message: "boom" } }));
    expect(root.sessions[SID].lastError).toContain("boom");
  });
});
