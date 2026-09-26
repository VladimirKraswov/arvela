import { store } from "../state/store";
import {
  AGENT_CONTROL_MCP,
  agentControlConfig,
  type AgentControlStatus,
} from "../state/agentControl";

type Document = { path: string; content: string };
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}

/** Install/disable only this app's reserved MCP entry, with config CAS + backup. */
export async function installAgentControlMcp(enabled: boolean): Promise<string> {
  if (store.currentHost())
    throw new Error("Для регистрации локальной команды выберите «Этот компьютер».");
  if (
    [...Object.values(store.state.activityStatuses), ...Object.values(store.state.statuses)]
      .some((item) => item.type === "busy" || item.type === "retry")
  )
    throw new Error("Дождитесь завершения работающего агента перед изменением конфигурации.");
  const status = await invoke<AgentControlStatus>("agent_control_status");
  if (!status.ready) throw new Error("Локальный шлюз ещё запускается.");
  const doc = await invoke<Document>("read_opencode_config", {
    scope: "global",
    directory: null,
  });
  const next = agentControlConfig(doc.content, status, enabled);
  await invoke<Document>("write_opencode_config", {
    scope: "global",
    directory: null,
    expected: doc.content,
    content: next.content,
  });
  if (enabled) {
    try {
      const inventory = await store.client.request<
        Record<string, { status?: string; error?: string }>
      >("POST", "/mcp", {
        query: { directory: store.state.directory },
        body: { name: AGENT_CONTROL_MCP, config: next.config },
        timeoutMs: 45_000,
      });
      const connected = inventory[AGENT_CONTROL_MCP];
      if (connected?.status !== "connected")
        throw new Error(connected?.error ?? "MCP не подтвердил подключение");
    } catch (problem) {
      let rollback = "";
      try {
        await invoke<Document>("write_opencode_config", {
          scope: "global",
          directory: null,
          expected: next.content,
          content: doc.content,
        });
      } catch (rollbackProblem) {
        rollback = ` Откат конфигурации не выполнен: ${
          rollbackProblem instanceof Error ? rollbackProblem.message : String(rollbackProblem)
        }`;
      }
      throw new Error(
        `MCP не подключён: ${problem instanceof Error ? problem.message : String(problem)}.${rollback}`,
      );
    }
    return "API управления подключён к текущему проекту и сохранён для следующих запусков OpenCode.";
  }
  try {
    await store.client.request("POST", `/mcp/${AGENT_CONTROL_MCP}/disconnect`, {
      query: { directory: store.state.directory },
    });
  } catch {
    // The durable disabled flag is authoritative for the next connection.
  }
  return "MCP управления отключён; обычная работа Desktop не изменена.";
}
