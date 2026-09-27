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

  it("recognizes a completed textual tool call that OpenCode cannot execute", () => {
    expect(
      agentControlForTest.malformedToolCallMessage(
        { id: "msg_bad", role: "assistant", finish: "stop" },
        [
          {
            type: "text",
            text: "<tool_call>\n<function=bash>\ndate\n</parameter>\n</function>\n</tool_call>",
          },
        ],
      ),
    ).toBe(true);
    expect(
      agentControlForTest.malformedToolCallMessage(
        { id: "msg_truncated", role: "assistant", finish: "stop" },
        [
          {
            type: "text",
            text: "<tool_call>\n<function=bash>\n<parameter=command>date",
          },
        ],
      ),
    ).toBe(true);
  });

  it("does not retry normal text, user text, unfinished turns or real tool calls", () => {
    const marker =
      "<tool_call>\n<function=bash>\ndate\n</parameter>\n</function>\n</tool_call>";
    expect(
      agentControlForTest.malformedToolCallMessage(
        { id: "msg_ok", role: "assistant", finish: "stop" },
        [{ type: "text", text: "Работа закончена." }],
      ),
    ).toBe(false);
    expect(
      agentControlForTest.malformedToolCallMessage(
        { id: "msg_user", role: "user", finish: "stop" },
        [{ type: "text", text: marker }],
      ),
    ).toBe(false);
    expect(
      agentControlForTest.malformedToolCallMessage(
        { id: "msg_busy", role: "assistant", finish: null },
        [{ type: "text", text: marker }],
      ),
    ).toBe(false);
    expect(
      agentControlForTest.malformedToolCallMessage(
        { id: "msg_tool", role: "assistant", finish: "stop" },
        [
          { type: "text", text: marker },
          { type: "tool", text: "" },
        ],
      ),
    ).toBe(false);
  });
});
