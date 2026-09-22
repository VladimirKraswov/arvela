import { store, useAppState } from "../state/store";
import { Icon } from "./Icon";
export function TopBar() {
  const s = useAppState(),
    l = s.prefs.layout,
    session = s.sessions.find((x) => x.id === s.activeSessionId);
  return (
    <header className="topbar" data-tauri-drag-region>
      {!l.sidebarOpen && (
        <button
          className="icon-btn"
          aria-label="Показать боковую панель"
          onClick={() => store.setLayout({ sidebarOpen: true })}
        >
          <Icon name="sidebar" />
        </button>
      )}
      <span className="session-title">{session?.title ?? "Новая задача"}</span>
      <span className="spacer" />
      {s.ui.vcs?.branch && (
        <span className="branch-label">
          <Icon name="branch" size={14} />
          {s.ui.vcs.branch}
        </span>
      )}
      <button
        className={`icon-btn${l.bottomOpen ? " on" : ""}`}
        aria-label="Терминал"
        aria-pressed={l.bottomOpen}
        title="Терминал · Ctrl+`"
        onClick={() => store.setLayout({ bottomOpen: !l.bottomOpen })}
      >
        <Icon name="terminal" />
      </button>
      <button
        className={`icon-btn review-button${l.rightOpen ? " on" : ""}`}
        aria-label="Изменения и файлы"
        aria-pressed={l.rightOpen}
        onClick={() => store.setLayout({ rightOpen: !l.rightOpen })}
      >
        <Icon name="panel" size={17} />
        <span>Изменения</span>
      </button>
    </header>
  );
}
