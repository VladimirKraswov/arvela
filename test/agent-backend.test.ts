import { expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, OpenCodeClient } from "../src/api/client";
import type { AgentBackend, AgentBackendDescriptor } from "../src/agent/backend";
import {
  asOpenCodeClient,
  OpenCodeBackend,
  openCodeDescriptor,
} from "../src/agent/opencode";
import {
  backendDescriptor,
  createBackend,
  DEFAULT_BACKEND_ID,
  findBackendDescriptor,
  listBackendDescriptors,
  registerBackendDescriptor,
} from "../src/agent/registry";
import { store } from "../src/state/store";

it("keeps OpenCode as the registered default backend", () => {
  expect(DEFAULT_BACKEND_ID).toBe("opencode");
  expect(listBackendDescriptors().map((d) => d.id)).toContain("opencode");
  // Pi is a real second engine and must be in the registry, not bolted on
  // beside it: the registry is the honest list of what this build can drive.
  expect(listBackendDescriptors().map((d) => d.id)).toContain("pi");
  expect(backendDescriptor("opencode")).toBe(openCodeDescriptor);
  expect(store.backend.id).toBe("opencode");
});

it("falls back to the default instead of leaving the app without a backend", () => {
  expect(backendDescriptor("not-installed").id).toBe(DEFAULT_BACKEND_ID);
  expect(backendDescriptor(null).id).toBe(DEFAULT_BACKEND_ID);
});

it("refuses endpoints the OpenCode security model does not allow", () => {
  expect(openCodeDescriptor.isAllowedEndpoint("http://127.0.0.1:4096")).toBe(
    true,
  );
  for (const bad of [
    "http://192.168.1.10:4096",
    "https://example.com",
    "http://user:pass@127.0.0.1:4096",
    "http://127.0.0.1:4096/path",
  ])
    expect(openCodeDescriptor.isAllowedEndpoint(bad)).toBe(false);
  expect(openCodeDescriptor.normalizeEndpoint("http://evil.example/")).toBe(
    DEFAULT_BASE_URL,
  );
});

it("forwards calls to the transport with the caller's exact arguments", async () => {
  // The adapter must not inject defaults or trailing `undefined`s: OpenCode turns
  // an explicit `undefined` query value into a different request than an absent one.
  const backend = new OpenCodeBackend("http://127.0.0.1:4096");
  const prompt = vi.spyOn(backend.client, "prompt").mockResolvedValue(undefined);
  const recent = vi
    .spyOn(backend.client, "recentSessions")
    .mockResolvedValue({ sessions: [], cursor: null });
  await backend.prompt("ses", "/dir", { parts: [] });
  await backend.recentSessions(false, 2);
  expect(prompt.mock.calls[0]).toEqual(["ses", "/dir", { parts: [] }]);
  expect(recent.mock.calls[0]).toEqual([false, 2]);
});

it("exposes the OpenCode transport only for an OpenCode backend", () => {
  const backend = new OpenCodeBackend("http://127.0.0.1:4096");
  expect(asOpenCodeClient(backend)).toBeInstanceOf(OpenCodeClient);
  expect(asOpenCodeClient(null)).toBeNull();
  expect(asOpenCodeClient({ id: "other" } as unknown as AgentBackend)).toBeNull();
});

it("lets another backend register without touching the store or UI", () => {
  // Documents the extension point only. No second backend is implemented.
  const created: string[] = [];
  const fake: AgentBackendDescriptor = {
    id: "test-only",
    label: "Test",
    description: "fixture",
    defaultEndpoint: "http://127.0.0.1:1",
    capabilities: { ...openCodeDescriptor.capabilities, pty: false },
    isAllowedEndpoint: (e) => e.startsWith("http://127.0.0.1"),
    normalizeEndpoint: (e) => e,
    create: (endpoint) => {
      created.push(endpoint);
      return { id: "test-only", endpoint } as unknown as AgentBackend;
    },
  };
  registerBackendDescriptor(fake);
  expect(backendDescriptor("test-only")).toBe(fake);
  expect(createBackend("test-only", "http://127.0.0.1:1").id).toBe("test-only");
  expect(created).toEqual(["http://127.0.0.1:1"]);
  expect(store.backend.id).toBe("opencode");
});

it("separates the lenient start-up lookup from the strict one", () => {
  // Re-creating an *active* backend from a fallback descriptor would silently move
  // a live workspace onto a different agent runtime, so that path looks up exactly.
  expect(findBackendDescriptor("not-installed")).toBeUndefined();
  expect(findBackendDescriptor(null)).toBeUndefined();
  expect(backendDescriptor("not-installed").id).toBe(DEFAULT_BACKEND_ID);
});

it("fails loudly, not silently, if a non-OpenCode backend reaches the escape hatch", () => {
  const real = store.backend;
  try {
    store.backend = { id: "other", capabilities: {} } as unknown as AgentBackend;
    expect(() => store.client).toThrow(/OpenCode/);
  } finally {
    store.backend = real;
  }
  expect(store.client).toBeInstanceOf(OpenCodeClient);
});

it("declares every optional surface OpenCode actually provides", () => {
  // The UI mounts the review panel, terminal and handoff behind these flags; a
  // false value here would hide a working feature from the shipped variants.
  expect(openCodeDescriptor.capabilities).toEqual({
    pty: true,
    permissions: true,
    questions: true,
    attachments: true,
    fork: true,
    compaction: true,
    vcsDiff: true,
    projectlessChat: true,
  });
});

it("describes Pi's real surface, not OpenCode's", () => {
  const pi = findBackendDescriptor("pi")!;
  expect(pi.capabilities).toMatchObject({
    pty: false,
    permissions: false,
    vcsDiff: false,
    fork: true,
    compaction: true,
    attachments: true,
  });
  // Pi is local: it has no network endpoint to validate or broaden.
  expect(pi.isAllowedEndpoint("pi://local")).toBe(true);
  expect(pi.isAllowedEndpoint("http://127.0.0.1:4096")).toBe(false);
  expect(pi.normalizeEndpoint("anything")).toBe("pi://local");
});
