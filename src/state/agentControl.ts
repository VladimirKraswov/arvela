import { parseConfig, updateConfig } from "./configEditor";
import { isAbsoluteLocalPath } from "../util/paths";

export const AGENT_CONTROL_MCP = "opencode_desktop";

export interface AgentControlStatus {
  supported: boolean;
  ready: boolean;
  command: string;
  descriptorPath: string;
  protocol: number;
}

/** Preserve the user's JSONC and refuse to overwrite an unrelated MCP entry. */
export function agentControlConfig(
  source: string,
  status: AgentControlStatus,
  enabled: boolean,
) {
  if (!isAbsoluteLocalPath(status.command) || !isAbsoluteLocalPath(status.descriptorPath))
    throw new Error("Arvela returned non-absolute control paths.");
  const value = parseConfig(source);
  const existing = (value.mcp as Record<string, unknown> | undefined)?.[
    AGENT_CONTROL_MCP
  ] as { command?: unknown } | undefined;
  if (
    existing &&
    (!Array.isArray(existing.command) || existing.command[1] !== "--agent-mcp")
  )
    throw new Error(
      "Имя opencode_desktop уже занято другой MCP-интеграцией. Существующая запись сохранена.",
    );
  const config = {
    type: "local" as const,
    command: [status.command, "--agent-mcp"],
    enabled,
    timeout: 360_000,
  };
  return {
    content: updateConfig(source, ["mcp", AGENT_CONTROL_MCP], config),
    config,
  };
}
