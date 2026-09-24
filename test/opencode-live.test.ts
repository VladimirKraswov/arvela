// Live acceptance against a real OpenCode server.
//
// Opt-in, like the Pi live test: it needs a running server and makes a real
// (paid) model call. Point it at a *test-owned* server with an isolated config
// and data home — never at the machine's normal OpenCode.
//
//   OCDESKTOP_OC_LIVE=1 OCDESKTOP_OC_URL=http://127.0.0.1:PORT \
//   OCDESKTOP_OC_DIR=/abs/project npx vitest run test/opencode-live.test.ts
//
// What it proves that unit tests cannot: the HTTP contract, the SSE envelope
// and the reducer all still match a real 1.18.x server after this branch's
// refactor of the transport into `AgentBackend`.

import { afterAll, expect, it } from "vitest";
import { OpenCodeBackend } from "../src/agent/opencode";
import { emptyChatRoot, reduceEvent } from "../src/state/chatReducer";
import type { ServerEvent, Session } from "../src/api/types";

const LIVE = process.env.OCDESKTOP_OC_LIVE === "1";
const URL_ = process.env.OCDESKTOP_OC_URL ?? "http://127.0.0.1:4096";
const DIR = process.env.OCDESKTOP_OC_DIR ?? "";
const MODEL = process.env.OCDESKTOP_OC_MODEL ?? "deepseek/deepseek-flash";

const cleanup: (() => void)[] = [];
afterAll(() => cleanup.forEach((fn) => fn()));

function collect(backend: OpenCodeBackend, directory: string) {
  const root = emptyChatRoot();
  const ctrl = new AbortController();
  cleanup.push(() => ctrl.abort());
  const seen: string[] = [];
  backend.subscribeDirectory(directory, {
    signal: ctrl.signal,
    onEvent: (event: ServerEvent) => {
      seen.push(event.type);
      reduceEvent(root, event);
    },
    onState: () => {},
  });
  return { root, seen, stop: () => ctrl.abort() };
}

async function waitUntil(
  check: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

it.skipIf(!LIVE)("reports health and a usable provider", async () => {
  const backend = new OpenCodeBackend(URL_);
  const health = await backend.health();
  expect(health.healthy).toBe(true);
  expect(health.version.startsWith("1.")).toBe(true);
  const providers = await backend.providers(undefined, DIR || null);
  const [providerID] = MODEL.split("/");
  expect(providers.connected).toContain(providerID);
});

it.skipIf(!LIVE)(
  "runs a real conversation through the backend and the stream reducer",
  async () => {
    const backend = new OpenCodeBackend(URL_);
    const directory = DIR;
    expect(directory, "OCDESKTOP_OC_DIR must be set").toBeTruthy();

    const { root, seen, stop } = collect(backend, directory);
    const [providerID, ...rest] = MODEL.split("/");
    const modelID = rest.join("/");

    let session: Session | null = null;
    try {
      session = await backend.createSession({
        directory,
        title: "desktop acceptance",
      });
      expect(session.directory).toBe(directory);

      await backend.prompt(session.id, directory, {
        model: { providerID, modelID },
        parts: [{ type: "text", text: "Reply with exactly: OPENCODE_LIVE_OK" }],
      });

      // Accepted is not finished: wait for the stream to say the run settled.
      await waitUntil(
        () => root.sessions[session!.id]?.status.type === "idle" && seen.includes("session.idle"),
        120_000,
        "session.idle",
      );

      const slot = root.sessions[session.id];
      const text = slot.messageOrder
        .flatMap((id) => slot.partsByMessage[id] ?? [])
        .map((id) => slot.parts[id])
        .filter((p) => p?.type === "text")
        .map((p) => p.text)
        .join("\n");
      expect(text).toContain("OPENCODE_LIVE_OK");

      // The authoritative history must agree with what the stream produced.
      const history = await backend.messages(session.id, { directory });
      expect(history.messages.length).toBeGreaterThanOrEqual(2);
      expect(history.messages[0].info.role).toBe("user");
      expect(history.messages.at(-1)?.info.role).toBe("assistant");

      const statuses = await backend.sessionStatuses(directory);
      expect(statuses[session.id]?.type ?? "idle").toBe("idle");
    } finally {
      stop();
      // Leave the test server exactly as clean as we found it.
      if (session) await backend.deleteSession(session.id, directory).catch(() => {});
    }
  },
  180_000,
);

it.skipIf(!LIVE)("cancels a running session on request", async () => {
  const backend = new OpenCodeBackend(URL_);
  const directory = DIR;
  const { root, stop } = collect(backend, directory);
  const [providerID, ...rest] = MODEL.split("/");
  const session = await backend.createSession({ directory, title: "abort" });
  try {
    await backend.prompt(session.id, directory, {
      model: { providerID, modelID: rest.join("/") },
      parts: [
        {
          type: "text",
          text: "Count slowly from 1 to 200, one number per line, with a short comment on each.",
        },
      ],
    });
    await waitUntil(
      () => root.sessions[session.id]?.status.type === "busy",
      60_000,
      "the run to start",
    );
    await backend.abort(session.id, directory);
    await waitUntil(
      () => root.sessions[session.id]?.status.type === "idle",
      60_000,
      "the run to stop",
    );
  } finally {
    stop();
    await backend.deleteSession(session.id, directory).catch(() => {});
  }
}, 180_000);
