import { describe, expect, it } from "vitest";
import { npmPluginName, parseConfig, permissionValue, remoteMcpUrl, updateConfig } from "../src/state/configEditor";

describe("OpenCode settings editor", () => {
  it("preserves JSONC comments and unrelated settings", () => {
    const source = '{\n  // Keep this comment\n  "model": "local/qwen",\n  "permission": {"bash": "ask"},\n}\n';
    const edited = updateConfig(source, ["permission", "webfetch"], "deny");
    expect(edited).toContain("// Keep this comment");
    expect(parseConfig(edited)).toMatchObject({model: "local/qwen", permission: {bash: "ask", webfetch: "deny"}});
    expect(permissionValue(parseConfig(edited), "bash")).toBe("ask");
  });
  it("refuses malformed config rather than replacing it", () => {
    expect(() => updateConfig('{bad', ["plugin"], [])).toThrow();
  });
  it("only accepts npm package names and credential-free MCP URLs", () => {
    expect(npmPluginName("@acme/opencode-plugin@1.2.0")).toBe(true);
    expect(npmPluginName("file:///tmp/plugin.ts")).toBe(false);
    expect(npmPluginName("abc;rm -rf ~")).toBe(false);
    expect(remoteMcpUrl("https://mcp.example.com/sse")).toBe(true);
    expect(remoteMcpUrl("http://127.0.0.1:8080/mcp")).toBe(true);
    expect(remoteMcpUrl("http://mcp.example.com/mcp")).toBe(false);
    expect(remoteMcpUrl("https://user:pass@mcp.example.com/mcp")).toBe(false);
  });
});
