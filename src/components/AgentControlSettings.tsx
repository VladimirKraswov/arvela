import { useEffect, useState } from "react";
import { store, useAppState } from "../state/store";
import {
  AGENT_CONTROL_MCP,
  type AgentControlStatus,
} from "../state/agentControl";
import { installAgentControlMcp } from "../control/install";

const err = (value: unknown) => (value instanceof Error ? value.message : String(value));
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return (await import("@tauri-apps/api/core")).invoke<T>(command, args);
}

export function AgentControlSettings() {
  const state = useAppState();
  const [status, setStatus] = useState<AgentControlStatus | null>(null);
  const [connection, setConnection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const native = "__TAURI_INTERNALS__" in window;
  const local = !store.currentHost();
  const running = [...Object.values(state.activityStatuses), ...Object.values(state.statuses)]
    .some((item) => item.type === "busy" || item.type === "retry");

  const refresh = async () => {
    if (!native) return;
    const next = await invoke<AgentControlStatus>("agent_control_status");
    setStatus(next);
    if (local) {
      try {
        const inventory = await store.client.request<Record<string, { status?: string }>>(
          "GET",
          "/mcp",
          { query: { directory: state.directory } },
        );
        setConnection(inventory[AGENT_CONTROL_MCP]?.status ?? "not_configured");
      } catch {
        setConnection("unavailable");
      }
    }
  };

  useEffect(() => {
    void refresh().catch((problem) => setError(err(problem)));
  }, [state.prefs.endpoint, state.directory]);

  const apply = async (enabled: boolean) => {
    if (!status || !local || running || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setNotice(await installAgentControlMcp(enabled));
      await refresh();
    } catch (problem) {
      setError(err(problem));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="computer-settings" aria-label="API управления агентами">
      <h4>AgentMesh Desktop Control MCP</h4>
      <p>
        Агенты выбирают проект, чат, модель и движок, отправляют задачу, ждут
        завершения и читают результат через API. Физическая мышь и распознавание
        экрана не используются.
      </p>
      {!native ? (
        <p role="status">Откройте установленное приложение AgentMesh Desktop.</p>
      ) : (
        <>
          <div className="kv"><span>Локальный шлюз</span><b>{status?.supported === false ? "Недоступен на этой платформе" : status?.ready ? "Готов" : "Запускается"}</b></div>
          <div className="kv"><span>OpenCode · текущий проект</span><b>{connection === "connected" ? "Подключён" : connection === "not_configured" ? "Не подключён" : connection || "—"}</b></div>
          <div className="kv"><span>Протокол</span><b>{status?.protocol ?? "—"}</b></div>
          {status?.supported === false ? <p className="handoff-note">
            Agent Control/Factory пока не портированы на эту платформу. Это не мешает локальным чатам OpenCode.
          </p> : <p className="handoff-note">
            Сокет и токен доступны только текущему пользователю. Команды выполняются
            через тот же store, что и интерфейс. Запросы разрешений не подтверждаются
            автоматически и остаются видимыми пользователю.
          </p>}
          {!local && <p role="status">Для регистрации локальной команды выберите «Этот компьютер».</p>}
          {running && <p role="status">Дождитесь завершения работающего агента перед изменением конфигурации.</p>}
          <div className="btn-row computer-actions">
            <button className="btn" disabled={busy} onClick={() => void refresh().catch((problem) => setError(err(problem)))}>Проверить</button>
            <button className="btn primary" disabled={busy || running || !local || !status?.supported || !status?.ready} onClick={() => void apply(true)}>Подключить MCP</button>
            <button className="btn" disabled={busy || running || !local || connection === "not_configured"} onClick={() => void apply(false)}>Отключить</button>
          </div>
        </>
      )}
      {error && <p className="composer-error" role="alert">{error}</p>}
      {notice && <p className="settings-notice" role="status">{notice}</p>}
    </section>
  );
}
