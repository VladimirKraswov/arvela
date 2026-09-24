// The approval gate for Pi's *built-in* tools.
//
// This is the control that stops `write`, `edit` and `bash` from running
// unasked in a Pi chat. It is loaded into every real Pi session by the native
// layer, so its default behaviour is a security property, not a preference.

import { afterEach, expect, it, vi } from "vitest";
import gate, { isMutating, needsApproval } from "../src-tauri/resources/pi/tool-gate";

afterEach(() => {
  delete process.env.OCDESKTOP_PI_TOOL_POLICY;
});

type Handler = (
  event: { toolName: string; input?: unknown },
  ctx: { ui: { confirm: (title: string, message: string) => Promise<boolean> } },
) => Promise<{ block?: boolean; reason?: string } | undefined>;

function install(): { call: Handler } {
  let handler: Handler | undefined;
  gate({
    on: (event: string, fn: Handler) => {
      if (event === "tool_call") handler = fn;
    },
  } as never);
  if (!handler) throw new Error("gate did not subscribe to tool_call");
  return { call: handler };
}

const ui = (confirm: (title: string, message: string) => Promise<boolean>) => ({
  ui: { confirm },
});

it("asks before anything that is not a known read-only tool", () => {
  for (const tool of ["write", "edit", "bash", "apply_patch", "fetch"])
    expect(needsApproval(tool)).toBe(true);
  // Unknown tools fail closed: an allowlist written today cannot know what a
  // future built-in or an extension will add.
  expect(needsApproval("some_future_tool")).toBe(true);
  for (const tool of ["read", "glob", "grep", "lsp_diagnostics"])
    expect(needsApproval(tool)).toBe(false);
  expect(isMutating("bash")).toBe(true);
  expect(isMutating("some_future_tool")).toBe(false);
});

it("blocks a mutating tool the user declines", async () => {
  const { call } = install();
  const confirm = vi.fn().mockResolvedValue(false);
  const result = await call(
    { toolName: "write", input: { path: "src/main.rs" } },
    ui(confirm),
  );
  expect(confirm).toHaveBeenCalled();
  expect(result?.block).toBe(true);
  expect(result?.reason).toContain("не разрешил");
});

it("lets an approved tool through untouched", async () => {
  const { call } = install();
  const result = await call(
    { toolName: "bash", input: { command: "ls" } },
    ui(vi.fn().mockResolvedValue(true)),
  );
  expect(result).toBeUndefined();
});

it("never asks about read-only tools", async () => {
  const { call } = install();
  const confirm = vi.fn();
  expect(await call({ toolName: "read", input: { path: "a.ts" } }, ui(confirm))).toBeUndefined();
  expect(confirm).not.toHaveBeenCalled();
});

it("denies when the dialog cannot be answered at all", async () => {
  // No window, a closed WebView or a native watchdog timeout all surface here
  // as a rejection or a false. Silence must never read as approval.
  const { call } = install();
  const rejected = await call(
    { toolName: "edit", input: { path: "x" } },
    ui(vi.fn().mockRejectedValue(new Error("no ui"))),
  );
  expect(rejected?.block).toBe(true);

  const cancelled = await call(
    { toolName: "edit", input: { path: "x" } },
    ui(vi.fn().mockResolvedValue(undefined as unknown as boolean)),
  );
  expect(cancelled?.block).toBe(true);
});

it("treats a missing policy as ask, and only an explicit value as full access", async () => {
  const { call } = install();
  const confirm = vi.fn().mockResolvedValue(false);

  delete process.env.OCDESKTOP_PI_TOOL_POLICY;
  expect((await call({ toolName: "write", input: {} }, ui(confirm)))?.block).toBe(true);

  process.env.OCDESKTOP_PI_TOOL_POLICY = "";
  expect((await call({ toolName: "write", input: {} }, ui(confirm)))?.block).toBe(true);

  process.env.OCDESKTOP_PI_TOOL_POLICY = "nonsense";
  expect((await call({ toolName: "write", input: {} }, ui(confirm)))?.block).toBe(true);

  process.env.OCDESKTOP_PI_TOOL_POLICY = "full";
  expect(await call({ toolName: "write", input: {} }, ui(confirm))).toBeUndefined();
});

it("shows the user what is actually about to happen", async () => {
  const { call } = install();
  const confirm = vi.fn().mockResolvedValue(false);
  await call({ toolName: "bash", input: { command: "rm -rf build" } }, ui(confirm));
  const [title, message] = confirm.mock.calls[0];
  expect(title).toContain("изменить файлы или выполнить команду");
  expect(message).toContain("rm -rf build");
});
