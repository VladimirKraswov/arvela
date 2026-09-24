// Live acceptance against a real `pi --mode rpc` child process.
//
// Opt-in: it spawns the installed Pi CLI and makes a real (paid) model call, so
// it is skipped unless OCDESKTOP_PI_LIVE=1. It needs a provider key in the
// environment — the key is read by Pi itself from the child environment and is
// never read, logged or asserted on here.
//
//   OCDESKTOP_PI_LIVE=1 OCDESKTOP_PI_BIN=/abs/path/to/pi \
//   DEEPSEEK_API_KEY="$(cat ~/.config/.../deepseek.key)" npx vitest run test/pi-live.test.ts
//
// What it proves that unit tests cannot: the JSONL framing, the event
// vocabulary, session durability and the translation into app state all match
// the *installed* Pi, not a fixture of it.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";
import { afterAll, expect, it } from "vitest";
import { PiBackend } from "../src/agent/pi/backend";
import { setPiBridge, type PiBridge } from "../src/agent/pi/native";
import type { PiEnvelope } from "../src/agent/pi/protocol";
import { emptyChatRoot, reduceEvent } from "../src/state/chatReducer";
import type { ServerEvent } from "../src/api/types";

const LIVE = process.env.OCDESKTOP_PI_LIVE === "1";
const PI = process.env.OCDESKTOP_PI_BIN ?? "";
// The account actually authorizes deepseek-flash; Pi accepts it as a custom
// model id even though its bundled catalog does not list it.
const MODEL = process.env.OCDESKTOP_PI_MODEL ?? "deepseek/deepseek-flash";
const PROVIDER = process.env.OCDESKTOP_PI_PROVIDER ?? "deepseek";

const sessionDirs = new Map<string, string>();
function sessionDirFor(directory: string): string {
  let dir = sessionDirs.get(directory);
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), "pi-live-sessions-"));
    sessionDirs.set(directory, dir);
  }
  return dir;
}

const children = new Map<string, ChildProcess>();
const handlers: ((e: PiEnvelope) => void)[] = [];

/** Wait for a named Pi event instead of guessing how slow the provider is. */
function waitFor(
  type: string,
  sessionId: string,
  timeoutMs = 90_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      handlers.splice(handlers.indexOf(handler), 1);
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const handler = (envelope: PiEnvelope) => {
      const payload = envelope.payload as { type?: string };
      if (envelope.sessionId !== sessionId) return;
      if (payload.type === type) {
        clearTimeout(timer);
        handlers.splice(handlers.indexOf(handler), 1);
        resolve();
      }
    };
    handlers.push(handler);
  });
}
const pending = new Map<string, (value: unknown) => void>();
let counter = 0;

/**
 * The same bridge contract the Tauri commands implement, backed by Node here so
 * the test can drive the real CLI without a native host. The framing rules are
 * the ones the Rust reader also follows: split on \n only, strip a trailing \r.
 */
const nodeBridge: PiBridge = {
  prepareChatWorkspace: async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-live-projectless-"));
    return { directory, root: tmpdir() };
  },
  detect: async () => ({
    installed: Boolean(PI),
    path: PI,
    version: "live",
    source: "configured",
    error: PI ? "" : "OCDESKTOP_PI_BIN not set",
  }),
  open: async (request) => {
    const key = `${request.directory}\u0000${request.sessionId}`;
    if (children.has(key))
      return { key, sessionId: request.sessionId, sessionDir: "", program: PI, reused: true };
    // Mirror the native rule: the session directory is stable *per project
    // directory*, which is what makes a session id durable across restarts.
    const sessionDir = sessionDirFor(request.directory);
    const child = spawn(
      PI,
      [
        "--mode", "rpc",
        "--session-dir", sessionDir,
        "--session-id", request.sessionId,
        "--provider", request.provider ?? PROVIDER,
        "--model", request.model ?? MODEL,
        ...(request.extensions ?? []).flatMap((path) => ["--extension", path]),
      ],
      {
        cwd: request.directory,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          OCDESKTOP_PI_TOOL_POLICY: request.toolPolicy ?? "ask",
        },
      },
    );
    children.set(key, child);
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      for (;;) {
        const i = buffer.indexOf("\n");
        if (i === -1) break;
        let line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.trim()) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(line);
        } catch {
          continue;
        }
        if (payload.type === "response" && typeof payload.id === "string") {
          const resolve = pending.get(payload.id);
          if (resolve) {
            pending.delete(payload.id);
            resolve(payload);
            continue;
          }
        }
        for (const handler of handlers)
          handler({
            key,
            directory: request.directory,
            sessionId: request.sessionId,
            payload,
          } as PiEnvelope);
      }
    });
    child.stderr!.resume();
    return { key, sessionId: request.sessionId, sessionDir, program: PI, reused: false };
  },
  request: async (key, command, timeoutMs) => {
    const child = children.get(key);
    if (!child) throw new Error("no child");
    const id = `r${++counter}`;
    const payload = { ...(command as object), id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("timeout"));
      }, timeoutMs ?? 60_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin!.write(`${JSON.stringify(payload)}\n`);
    });
  },
  post: async (key, message) => {
    children.get(key)?.stdin!.write(`${JSON.stringify(message)}\n`);
  },
  close: async (key) => {
    children.get(key)?.kill();
    children.delete(key);
  },
  sessions: async () => [],
  probeDirectory: async () => "/tmp/probe",
  liveSessions: async () => [...children.keys()],
  setupLsp: async () => ({
    extensionPath: "",
    configPath: "",
    servers: [],
    missing: [],
  }),
  subscribe: (handler) => {
    handlers.push(handler);
    return () => handlers.splice(handlers.indexOf(handler), 1);
  },
};

afterAll(() => {
  for (const child of children.values()) child.kill();
  children.clear();
  setPiBridge(null);
});

it.skipIf(!LIVE)(
  "streams a real Pi answer into the application's own chat state",
  async () => {
    setPiBridge(nodeBridge);
    const directory = mkdtempSync(join(tmpdir(), "pi-live-work-"));
    writeFileSync(join(directory, "README.md"), "fixture\n");

    const meta: Record<string, any> = {};
    const stale: string[] = [];
    const pi = new PiBackend({
      choice: () => ({ provider: PROVIDER, model: MODEL }),
      meta: {
        all: () => meta,
        save: (m) => {
          meta[m.id] = m;
        },
        remove: (id) => delete meta[id],
      },
      onHistoryStale: (_d, id) => stale.push(id),
    });

    const root = emptyChatRoot();
    const ctrl = new AbortController();
    pi.subscribeDirectory(directory, {
      signal: ctrl.signal,
      onEvent: (event: ServerEvent) => reduceEvent(root, event),
      onState: () => {},
    });

    const session = await pi.createSession({ directory, title: "live" });
    await pi.prompt(session.id, directory, {
      parts: [{ type: "text", text: "Reply with exactly: PI_LIVE_OK" }],
    } as never);

    // Wait for the run to settle, which is also what asks for a history re-read.
    const deadline = Date.now() + 90_000;
    while (!stale.includes(session.id) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 250));
    expect(stale, "agent_settled never arrived").toContain(session.id);

    const slot = root.sessions[session.id];
    expect(slot, "no chat state was produced").toBeTruthy();
    expect(slot.status).toEqual({ type: "idle" });
    const text = slot.messageOrder
      .flatMap((id) => slot.partsByMessage[id] ?? [])
      .map((id) => slot.parts[id])
      .filter((p) => p?.type === "text")
      .map((p) => p.text)
      .join("\n");
    expect(text).toContain("PI_LIVE_OK");

    // The durable transcript must round-trip through Pi's own entry ids.
    const history = await pi.messages(session.id, { directory });
    expect(history.messages.length).toBeGreaterThanOrEqual(2);
    expect(history.messages[0].info.role).toBe("user");
    expect(history.messages.at(-1)?.info.role).toBe("assistant");
    expect(history.messages.every((m) => !m.info.id.startsWith("pi-live-"))).toBe(
      true,
    );

    // One process per session, still.
    expect(await pi.liveSessions()).toHaveLength(1);
    ctrl.abort();
    await pi.closeSession(session.id);
  },
  150_000,
);

it.skipIf(!LIVE)(
  "resumes the same durable session id after the process is restarted",
  async () => {
    setPiBridge(nodeBridge);
    const directory = mkdtempSync(join(tmpdir(), "pi-live-resume-"));
    const meta: Record<string, any> = {};
    const pi = new PiBackend({
      choice: () => ({ provider: PROVIDER, model: MODEL }),
      meta: {
        all: () => meta,
        save: (m) => {
          meta[m.id] = m;
        },
        remove: (id) => delete meta[id],
      },
    });
    const session = await pi.createSession({ directory, title: "resume" });
    const settled = waitFor("agent_settled", session.id);
    await pi.prompt(session.id, directory, {
      parts: [{ type: "text", text: "Remember the word: KANGAROO. Reply OK." }],
    } as never);
    // Wait for the run to actually finish; a fixed sleep would make this test
    // pass or fail on provider latency rather than on behaviour.
    await settled;
    const before = await pi.messages(session.id, { directory });
    expect(before.messages.length).toBeGreaterThanOrEqual(2);
    await pi.closeSession(session.id);

    // A fresh child for the same session id must find the same transcript.
    const after = await pi.messages(session.id, { directory });
    expect(after.messages.map((m) => m.info.id)).toEqual(
      before.messages.map((m) => m.info.id),
    );
    await pi.closeSession(session.id);
  },
  150_000,
);

it.skipIf(!LIVE)(
  "blocks a real file write when nothing can approve it",
  async () => {
    // The whole point of the gate: with no UI able to answer, Pi's built-in
    // write must not touch the disk.
    setPiBridge(nodeBridge);
    const directory = mkdtempSync(join(tmpdir(), "pi-live-gate-"));
    const gatePath = fileURLToPath(
      new URL("../src-tauri/resources/pi/tool-gate.ts", import.meta.url),
    );
    const meta: Record<string, any> = {};
    const pi = new PiBackend({
      choice: () => ({
        provider: PROVIDER,
        model: MODEL,
        extensions: [gatePath],
        toolPolicy: "ask",
      }),
      meta: {
        all: () => meta,
        save: (m) => {
          meta[m.id] = m;
        },
        remove: (id) => delete meta[id],
      },
    });
    const session = await pi.createSession({ directory, title: "gate" });

    // No dialog handler is installed, so the request goes unanswered. The
    // harness answers `cancelled` exactly like the native watchdog does.
    let asked = 0;
    let attempted = 0;
    const stop = nodeBridge.subscribe((envelope) => {
      const payload = envelope.payload as {
        type?: string;
        id?: string;
        method?: string;
        toolName?: string;
      };
      if (payload.type === "tool_execution_start" && payload.toolName === "write")
        attempted += 1;
      if (payload.type === "extension_ui_request" && payload.method === "confirm") {
        asked += 1;
        void nodeBridge.post(envelope.key, {
          type: "extension_ui_response",
          id: payload.id,
          cancelled: true,
        });
      }
    });

    const settled = waitFor("agent_settled", session.id, 120_000);
    await pi.prompt(session.id, directory, {
      parts: [
        {
          type: "text",
          text: "Use the write tool to create a file named GATE.txt containing the word BLOCKED. Do not ask me anything first.",
        },
      ],
    } as never);
    await settled;
    stop();

    // Without this the test could pass vacuously, by the model simply never
    // trying to write.
    expect(attempted, "the model never attempted the write tool").toBeGreaterThan(0);
    expect(asked, "the gate never asked for approval").toBeGreaterThan(0);
    expect(
      existsSync(join(directory, "GATE.txt")),
      "the gate let an unapproved write reach the disk",
    ).toBe(false);
    await pi.closeSession(session.id);
    rmSync(directory, { recursive: true, force: true });
  },
  180_000,
);
