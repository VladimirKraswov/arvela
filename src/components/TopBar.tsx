import { PI_BACKEND_ID } from "../agent/pi/backend";
import { piAvailability } from "../state/engines";
import { store, useAppState } from "../state/store";
import { Icon } from "./Icon";
export function TopBar() {
  const s = useAppState(),
    l = s.prefs.layout,
    session = s.sessions.find((x) => x.id === s.activeSessionId);
  const engineId = store.engineIdFor();
  // Only name the engine when it is not the default, so OpenCode chats look
  // exactly as they did before.
  const engineLabel = engineId === PI_BACKEND_ID ? "Pi" : "";
  const canContinueInPi =
    engineId !== PI_BACKEND_ID &&
    store.piInstalled &&
    piAvailability(s.prefs).available;
  return (
    <header className="topbar" data-tauri-drag-region="deep">
      {!l.sidebarOpen && (
        <button
          className="icon-btn"
          aria-label="Показать боковую панель"
          onClick={() => store.setLayout({ sidebarOpen: true })}
        >
          <Icon name="sidebar" />
        </button>
      )}
      <span className="session-title">{session?.title ?? "Новый чат"}</span>
      <span className="spacer" />
      {store.currentHost() && (
        <span
          className="execution-badge"
          title="Инструменты выполняются на удалённой машине"
        >
          <Icon name="server" size={14} />
          {store.hostLabel()}
        </span>
      )}
      {engineLabel && (
        <span className="execution-badge" title="Движок этого чата">
          {engineLabel}
        </span>
      )}
      {session && canContinueInPi && (
        <button
          className="icon-btn handoff-button"
          title="Создать чат Pi и перенести в него контекст этого разговора"
          aria-label="Продолжить в Pi"
          disabled={s.connection.phase !== "connected"}
          onClick={() => void store.continueOnEngine(session, PI_BACKEND_ID)}
        >
          <Icon name="handoff" size={17} />
          <span>В Pi</span>
        </button>
      )}
      {session && engineId !== PI_BACKEND_ID && <button className="icon-btn handoff-button" title="Передать задачу в другую сессию" aria-label="Передать задание" disabled={s.connection.phase !== "connected" || !store.backend.capabilities.fork} onClick={() => store.setUi({ handoffSource: session })}>
        <Icon name="handoff" size={17} /><span>Передать</span>
      </button>}
      {s.ui.vcs?.branch && (
        <span className="branch-label">
          <Icon name="branch" size={14} />
          {s.ui.vcs.branch}
        </span>
      )}
      {engineId !== PI_BACKEND_ID && <button
        className={`icon-btn${l.bottomOpen ? " on" : ""}`}
        aria-label="Терминал"
        aria-pressed={l.bottomOpen}
        title="Терминал · Ctrl+`"
        disabled={s.connection.phase !== "connected" || s.ui.workspacePreparing}
        onClick={() => void store.toggleTerminal()}
      >
        <Icon name="terminal" />
      </button>}
      {engineId !== PI_BACKEND_ID && <button
        className={`icon-btn review-button${l.rightOpen ? " on" : ""}`}
        aria-label="Изменения и файлы"
        aria-pressed={l.rightOpen}
        onClick={() => store.setLayout({ rightOpen: !l.rightOpen })}
      >
        <Icon name="panel" size={17} />
        <span>Изменения</span>
      </button>}
    </header>
  );
}
