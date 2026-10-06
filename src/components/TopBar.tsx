import { BrowserButton } from "./BrowserSettings";
import { PI_BACKEND_ID } from "../agent/pi/backend";
import { piAvailability } from "../state/engines";
import { store, useAppState } from "../state/store";
import { Icon } from "./Icon";
import { CONTEXT_PANEL_ID } from "./ContextPanel";
export function TopBar() {
  const s = useAppState(),
    l = s.prefs.layout,
    session = store.activeSession();
  const engineId = store.engineIdFor();
  const engineLabel = engineId === PI_BACKEND_ID ? "Pi" : "OpenCode";
  const otherEngine = engineId === PI_BACKEND_ID ? "opencode" : PI_BACKEND_ID;
  const otherLabel = engineId === PI_BACKEND_ID ? "OpenCode" : "Pi";
  const canContinueOnOtherEngine = engineId === PI_BACKEND_ID
    ? s.connection.phase === "connected"
    : store.piInstalled && piAvailability(s.prefs).available;
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
        <span className="execution-badge" title="Агент этого чата">
          {engineLabel}
        </span>
      )}
      {session && canContinueOnOtherEngine && (
        <button
          className="icon-btn handoff-button"
          title={`Создать чат ${otherLabel} и перенести контекст`}
          aria-label={`Продолжить в ${otherLabel}`}
          disabled={s.connection.phase !== "connected"}
          onClick={() => void store.continueOnEngine(session, otherEngine)}
        >
          <Icon name="handoff" size={17} />
          <span>В {otherLabel}</span>
        </button>
      )}
      {session && engineId !== PI_BACKEND_ID && <button className="icon-btn handoff-button" title="Передать задачу в другую сессию" aria-label="Передать задание" disabled={s.connection.phase !== "connected" || !store.backend.capabilities.fork} onClick={() => store.setUi({ handoffSource: session })}>
        <Icon name="handoff" size={17} /><span>Передать</span>
      </button>}
      <button className={`icon-btn${s.ui.contextOpen ? " on" : ""}`} aria-label="Контекст задачи" aria-expanded={s.ui.contextOpen} aria-controls={s.ui.contextOpen ? CONTEXT_PANEL_ID : undefined} title="Расписание, результаты, субагенты и источники" onClick={() => store.setUi({ contextOpen: !s.ui.contextOpen })}><Icon name="context" /></button>
      <BrowserButton/>
      {s.ui.vcs?.branch && (
        <span className="branch-label">
          <Icon name="branch" size={14} />
          {s.ui.vcs.branch}
        </span>
      )}
      {<button
        className={`icon-btn${l.bottomOpen ? " on" : ""}`}
        aria-label="Терминал"
        aria-pressed={l.bottomOpen}
        title="Терминал · Ctrl+`"
        disabled={s.connection.phase !== "connected" || s.ui.workspacePreparing}
        onClick={() => void store.toggleTerminal()}
      >
        <Icon name="terminal" />
      </button>}
      {<button
        className={`icon-btn review-button${l.rightOpen ? " on" : ""}`}
        disabled={!store.workspaceToolsAvailable()}
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
