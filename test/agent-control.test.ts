import { describe, expect, it } from "vitest";
import { agentControlConfig } from "../src/state/agentControl";
import { agentControlForTest } from "../src/control/bridge";

const nativeStatus = {
  ready: true,
  command: "/Applications/OpenCode Desktop.app/Contents/MacOS/opencode-desktop",
  descriptorPath: "/Users/test/.local/share/opencode-desktop/agent-control/control.json",
  protocol: 1,
};

describe("agent control MCP", () => {
  it("adds a local MCP without discarding JSONC comments or other servers", () => {
    const source = `{
  // keep this server
  "mcp": { "existing": { "type": "remote", "url": "https://example.test/mcp" } }
}\n`;
    const next = agentControlConfig(source, nativeStatus, true);
    expect(next.content).toContain("// keep this server");
    expect(next.content).toContain('"existing"');
    expect(next.content).toContain('"opencode_desktop"');
    expect(next.config.command).toEqual([nativeStatus.command, "--agent-mcp"]);
    expect(next.config.enabled).toBe(true);
  });

  it("does not overwrite an unrelated MCP using the reserved name", () => {
    expect(() =>
      agentControlConfig(
        '{"mcp":{"opencode_desktop":{"type":"local","command":["other"]}}}',
        nativeStatus,
        true,
      ),
    ).toThrow(/занято/);
  });

  it("exposes a bounded status snapshot without transport details", async () => {
    const result = (await agentControlForTest.execute("status", {})) as Record<
      string,
      unknown
    >;
    expect(result).toHaveProperty("connection");
    expect(result).toHaveProperty("directory");
    expect(result).toHaveProperty("pending");
    expect(result).not.toHaveProperty("prefs");
  });

  it("rejects malformed model selection before mutating the chat", async () => {
    await expect(
      agentControlForTest.execute("configure", { provider_id: "local-only" }),
    ).rejects.toThrow(/supplied together/);
  });

  it("reports an already idle session immediately instead of timing out", async () => {
    const result = (await agentControlForTest.execute("wait", {
      session_id: "ses_already_idle",
      timeout_seconds: 1,
    })) as { outcome: string };
    expect(result.outcome).toBe("idle");
  });
});
