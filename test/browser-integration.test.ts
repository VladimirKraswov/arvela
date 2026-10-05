import { beforeEach, expect, it, vi } from "vitest";
import type { BrowserStatus, SetupOptions } from "../src/browser/integration";
import { parseConfig } from "../src/state/configEditor";

let integration: typeof import("../src/browser/integration");
const installed: BrowserStatus = {
  supported: true, installed: true, running: true, browserOpen: false,
  command: "/Applications/OpenCode Desktop.app/Contents/MacOS/opencode-desktop",
  nodeProgram: "/opt/homebrew/bin/node", skillPath: "/tmp/browser-fixture/current/skills",
  runtimePath: "/tmp/browser-fixture/current", profilePath: "/tmp/browser-fixture/profile", version: "0.0.83",
};
beforeEach(async () => { vi.resetModules(); integration = await import("../src/browser/integration"); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture(options: { openCode?: boolean; pi?: boolean; source?: string; status?: BrowserStatus; override?: (command: string, args?: Record<string, unknown>) => unknown } = {}) {
  const source = options.source ?? "{}";
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const changed = options.override?.(command, args);
    if (changed !== undefined) return changed;
    switch (command) {
      case "detect_local_opencode": return options.openCode !== false;
      case "pi_detect": return { installed: options.pi !== false };
      case "browser_status": return options.status ?? installed;
      case "browser_install": case "browser_start": return installed;
      case "read_opencode_config": return { path: "/tmp/opencode-fixture.jsonc", content: source };
      case "write_opencode_config": case "browser_pi_support": case "browser_stop": return undefined;
      default: throw new Error(`Unexpected native command: ${command}`);
    }
  });
  const request = vi.fn<SetupOptions["request"]>(async () => ({ desktop_browser: { status: "connected" } }));
  const setup: SetupOptions = {
    endpoint: "http://127.0.0.1:4096", directory: "/tmp/project-fixture", remote: false,
    preferences: { enabled: true }, current: () => true, request,
  };
  const run = (patch: Partial<SetupOptions> = {}) => integration.configureLocalBrowser({ ...setup, ...patch }, invoke as any);
  const calls = (name: string) => invoke.mock.calls.filter(([command]) => command === name);
  return { invoke, request, setup, run, calls, source };
}

it("changes only the reserved JSONC entry and preserves comments, models, permissions and other tools", () => {
  const source = '// owner comment\n{"model":"local/qwen","provider":{"local":{"options":{"apiKey":"fixture-only"}}},"permission":{"bash":"ask","desktop_browser_*":"deny"},"mcp":{"existing":{"type":"remote","url":"https://example.test"}},"skills":{"paths":["/old/skills"],"urls":["https://example.test/skills"]}}';
  const next = integration.browserConfig(source, installed, true);
  const before = parseConfig(source), after = parseConfig(next.content);
  expect(next.content).toContain("// owner comment");
  for (const key of ["model", "provider", "permission"]) expect(after[key]).toEqual(before[key]);
  expect((after.mcp as any).existing).toEqual((before.mcp as any).existing);
  expect(after.skills).toEqual({ paths: ["/old/skills", installed.skillPath], urls: ["https://example.test/skills"] });
  expect(next.config).toEqual({ type: "local", command: [installed.command, "--browser-mcp"], enabled: true, timeout: 45000 });
  const twice = integration.browserConfig(next.content, installed, true);
  expect(twice.content).toBe(next.content);
  expect((parseConfig(integration.browserConfig(twice.content, installed, false).content).mcp as any).desktop_browser.enabled).toBe(false);
});

it.each([false, null, [], "external", { type: "remote", url: "https://example.test/mcp" }, { type: "local", command: ["/foreign/binary", "serve"] }])(
  "preserves a reserved-name collision instead of silently replacing it: %j", entry => {
    expect(() => integration.browserConfig(JSON.stringify({ mcp: { desktop_browser: entry } }), installed, true)).toThrow("занято");
  },
);

it("rejects a foreign executable even if it copied the Desktop browser flag", () => {
  const source = JSON.stringify({ mcp: { desktop_browser: { type: "local", command: ["/foreign/binary", "--browser-mcp"] } } });
  expect(() => integration.browserConfig(source, installed, true)).toThrow("занято");
});

it.each([null, false, [], { paths: "bad" }, { paths: ["/safe", false] }])("rejects malformed skills without a destructive rewrite: %j", skills => {
  expect(() => integration.browserConfig(JSON.stringify({ skills }), installed, true)).toThrow("skills");
});

it("skips installing/configuring a browser when both engines are absent", async () => {
  const f = fixture({ openCode: false, pi: false, status: { ...installed, installed: false, running: false } });
  await f.run();
  for (const name of ["browser_install", "browser_start", "read_opencode_config", "write_opencode_config", "browser_pi_support"]) expect(f.calls(name)).toHaveLength(0);
  expect(f.request).not.toHaveBeenCalled();
  expect(integration.browserSetupSnapshot().phase).toBe("idle");
  expect(integration.browserSetupSnapshot().openCode).toContain("пропущен");
  expect(integration.browserSetupSnapshot().pi).toContain("пропущен");
});

it("supports Pi-only setup without reading or writing OpenCode configuration", async () => {
  const f = fixture({ openCode: false, pi: true, status: { ...installed, installed: false, running: false } });
  await f.run();
  expect(f.calls("browser_install")).toHaveLength(1);
  expect(f.calls("browser_pi_support")).toHaveLength(1);
  expect(f.calls("read_opencode_config")).toHaveLength(0);
  expect(f.calls("write_opencode_config")).toHaveLength(0);
  expect(f.request).not.toHaveBeenCalled();
  expect(integration.browserSetupSnapshot().phase).toBe("ready");
});

it.each([
  { remote: true }, { endpoint: "http://192.168.31.10:4096" }, { endpoint: "bad endpoint" },
])("never installs or writes local integration for a remote/invalid workspace: %j", async patch => {
  const f = fixture();
  await f.run(patch);
  expect(f.invoke).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});

it("disabled setup never installs or starts tools, and preserves other permissions while stopping its own service", async () => {
  const source = integration.browserConfig('{"permission":{"bash":"ask"},"skills":{"paths":["/old"]}}', installed, true).content;
  const f = fixture({ source, status: { ...installed, installed: false, running: false } });
  await f.run({ preferences: { enabled: false } });
  expect(f.calls("browser_install")).toHaveLength(0); expect(f.calls("browser_start")).toHaveLength(0);
  expect(f.calls("browser_pi_support")).toHaveLength(0);
  expect(f.request).toHaveBeenCalledWith("POST", "/mcp/desktop_browser/disconnect", {
    query: { directory: f.setup.directory }, body: {}, timeoutMs: 10000,
  });
  expect(f.request.mock.calls.every(([, path]) => path !== "/mcp")).toBe(true);
  expect(f.calls("browser_stop")).toHaveLength(1);
  const written = parseConfig(f.calls("write_opencode_config")[0][1]!.content as string);
  expect((written.mcp as any).desktop_browser.enabled).toBe(false);
  expect(written.permission).toEqual({ bash: "ask" });
  expect(written.skills).toEqual(parseConfig(source).skills);
  expect(integration.browserSetupSnapshot().phase).toBe("disabled");
});

it("coalesces parallel setup and attachments, then attaches independently to another directory", async () => {
  const f = fixture({ status: { ...installed, installed: false, running: false } });
  await Promise.all([f.run(), f.run(), f.run()]);
  expect(f.calls("detect_local_opencode")).toHaveLength(1); expect(f.calls("pi_detect")).toHaveLength(1);
  expect(f.calls("browser_install")).toHaveLength(1); expect(f.calls("write_opencode_config")).toHaveLength(1);
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request).toHaveBeenCalledWith("POST", "/mcp", { query: { directory: f.setup.directory }, body: { name: "desktop_browser", config: { type: "local", command: [installed.command, "--browser-mcp"], enabled: true, timeout: 45000 } }, timeoutMs: 45000 });
  await f.run(); expect(f.request).toHaveBeenCalledTimes(1);
  await f.run({ directory: "/tmp/another-project-fixture" }); expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.calls("browser_install")).toHaveLength(1);
});

it("invalidated setup cannot save config or attach a stale directory after an awaited read", async () => {
  const read = deferred<{ path: string; content: string }>();
  const f = fixture({ override: command => command === "read_opencode_config" ? read.promise : undefined });
  const pending = f.run();
  await vi.waitFor(() => expect(f.calls("read_opencode_config")).toHaveLength(1));
  integration.invalidateBrowserSetup();
  read.resolve({ path: "/tmp/fixture.jsonc", content: "{}" });
  await pending;
  expect(f.calls("write_opencode_config")).toHaveLength(0);
  expect(f.request).not.toHaveBeenCalled();
});

it("skips attaching when the active directory changed while background setup ran", async () => {
  const f = fixture();
  await f.run({ activeDirectory: () => "/tmp/different-active-directory" });
  expect(f.request).not.toHaveBeenCalled();
  expect(integration.browserSetupSnapshot().openCode).not.toContain("Подключён");
});

it("does not mark a disconnected MCP inventory as ready or cache a failed attachment", async () => {
  const f = fixture();
  f.request.mockResolvedValueOnce({ desktop_browser: { status: "failed", error: "fixture transport refused" } } as any);
  await f.run();
  expect(integration.browserSetupSnapshot().phase).toBe("error");
  expect(integration.browserSetupSnapshot().error).toContain("fixture transport refused");
  expect(integration.browserSetupSnapshot().openCode).not.toContain("Подключён");
  await f.run();
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(integration.browserSetupSnapshot().openCode).toContain("Подключён");
  expect(integration.browserSetupSnapshot().phase).toBe("ready");
  expect(integration.browserSetupSnapshot().error).toBeUndefined();
});

it("adopts its own entry after the app bundle moved, rewriting only the executable path", () => {
  const moved = "/Users/example/Downloads/OpenCode Desktop.app/Contents/MacOS/opencode-desktop";
  const source = '// keep this comment\n' + JSON.stringify({ model: "local/qwen", mcp: { desktop_browser: { type: "local", command: [moved, "--browser-mcp"], enabled: true, timeout: 45000 } } });
  const next = integration.browserConfig(source, installed, true);
  const after = parseConfig(next.content);
  expect((after.mcp as any).desktop_browser.command).toEqual([installed.command, "--browser-mcp"]);
  expect(after.model).toBe("local/qwen");
  expect(next.content).toContain("// keep this comment");
});

it("compares drive-letter executable names without case and still refuses relative or renamed programs", () => {
  const status: BrowserStatus = { ...installed,
    command: "C:\\Users\\Example\\AppData\\Local\\OpenCode Desktop\\opencode-desktop.exe",
    skillPath: "C:\\Users\\Example\\AppData\\Local\\opencode-desktop\\browser-runtime\\current\\skills" };
  const entry = (command: string) => JSON.stringify({ mcp: { desktop_browser: { type: "local", command: [command, "--browser-mcp"] } } });
  expect(() => integration.browserConfig(entry("D:\\Portable\\OPENCODE-DESKTOP.EXE"), status, true)).not.toThrow();
  expect(() => integration.browserConfig(entry("opencode-desktop.exe"), status, true)).toThrow("занято");
  expect(() => integration.browserConfig(entry("D:\\Portable\\other-tool.exe"), status, true)).toThrow("занято");
  // POSIX names stay case-sensitive.
  expect(() => integration.browserConfig(entry("/opt/OpenCode-Desktop"), installed, true)).toThrow("занято");
});

it("disabling leaves a foreign desktop_browser entry untouched and still stops its own service", async () => {
  const source = JSON.stringify({ mcp: { desktop_browser: { type: "local", command: ["/foreign/binary", "--browser-mcp"] } } });
  const f = fixture({ source });
  await f.run({ preferences: { enabled: false } });
  expect(f.calls("browser_stop")).toHaveLength(1);
  expect(f.calls("write_opencode_config")).toHaveLength(0);
  expect(integration.browserSetupSnapshot().phase).toBe("disabled");
});

it("a config failure after disabling cannot leave a stopped browser labelled as running", async () => {
  const f = fixture({ status: { ...installed, running: true, browserOpen: true }, override: command => {
    if (command === "read_opencode_config") throw new Error("fixture config is unreadable");
  } });
  await f.run({ preferences: { enabled: false } });
  expect(f.calls("browser_stop")).toHaveLength(1);
  expect(integration.browserSetupSnapshot().phase).toBe("error");
  expect(integration.browserSetupSnapshot().status?.running).toBe(false);
  expect(integration.browserSetupSnapshot().status?.browserOpen).toBe(false);
  expect(integration.browserSetupSnapshot().error).toContain("fixture config is unreadable");
});

it("a setup superseded without a successor (e.g. a host switch) settles instead of staying in progress", async () => {
  const install = deferred<BrowserStatus>();
  let active = true;
  const f = fixture({ status: { ...installed, installed: false, running: false }, override: command => command === "browser_install" ? install.promise : undefined });
  const pending = f.run({ current: () => active });
  await vi.waitFor(() => expect(integration.browserSetupSnapshot().phase).toBe("installing"));
  active = false;
  install.resolve(installed);
  await pending;
  expect(integration.browserSetupSnapshot().phase).toBe("idle");
  expect(f.calls("browser_start")).toHaveLength(0);
  expect(f.calls("write_opencode_config")).toHaveLength(0);
});

it("engine-path changes rerun setup without restarting a confirmed OpenCode attachment", async () => {
  const f = fixture();
  await f.run();
  expect(f.request).toHaveBeenCalledTimes(1);
  integration.invalidateBrowserSetup({ keepAttachments: true });
  await f.run();
  expect(f.calls("detect_local_opencode")).toHaveLength(2);
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(integration.browserSetupSnapshot().openCode).toBe("Подключён к выбранному проекту");
  integration.invalidateBrowserSetup();
  await f.run();
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("a failed attachment started by an invalidated setup is never reported as connected by the newer one", async () => {
  const inventory = deferred<Record<string, { status?: string; error?: string }>>();
  const f = fixture();
  f.request.mockReturnValueOnce(inventory.promise);
  const first = f.run();
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
  integration.invalidateBrowserSetup();
  const second = f.run();
  await vi.waitFor(() => expect(f.calls("browser_pi_support")).toHaveLength(2));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.request).toHaveBeenCalledTimes(1);
  inventory.resolve({ desktop_browser: { status: "failed", error: "fixture transport refused" } });
  await Promise.all([first, second]);
  expect(integration.browserSetupSnapshot().openCode).not.toContain("Подключён");
  expect(integration.browserSetupSnapshot().phase).toBe("error");
  expect(integration.browserSetupSnapshot().error).toContain("fixture transport refused");
});

it("never sends stale Pi readiness into a newer setup after native support returns", async () => {
  const support = deferred<void>();
  const old = fixture({ pi: true, override: command => command === "browser_pi_support" ? support.promise : undefined });
  const pending = old.run();
  await vi.waitFor(() => expect(old.calls("browser_pi_support")).toHaveLength(1));
  integration.invalidateBrowserSetup();
  const newer = fixture({ pi: false });
  await newer.run();
  const expected = integration.browserSetupSnapshot().pi;
  expect(expected).toContain("пропущен");
  support.resolve(); await pending;
  expect(integration.browserSetupSnapshot().pi).toBe(expected);
});
