import { store, useAppState } from "../state/store";

export function TopBar() {
  const s = useAppState();
  const session = s.sessions.find((x) => x.id === s.activeSessionId) ?? null;
  const dirName = s.directory ? (s.directory.split("/").filter(Boolean).pop() ?? s.directory) : null;
  const layout = s.prefs.layout;
  return (
    <header className="topbar">
      <span className="session-title">{session?.title ?? (s.directory ? "New conversation" : "OpenCode Desktop")}</span>
      <div className="meta">
        {dirName && <span title={s.directory ?? ""} className="chip">{dirName}</span>}
        {s.ui.vcs?.branch && <span className="chip" title="Git branch">{s.ui.vcs.branch}</span>}
        {session?.model?.id && <span className="chip">{session.model.id}</span>}
      </div>
      <span style={{ flex: 1 }} />
      <button
        className={`icon-btn${layout.bottomOpen ? " on" : ""}`}
        aria-pressed={layout.bottomOpen}
        title="Toggle terminal (Ctrl+`)"
        onClick={() => store.setLayout({ bottomOpen: !layout.bottomOpen })}
      >
        Terminal
      </button>
      <button
        className={`icon-btn${layout.rightOpen ? " on" : ""}`}
        aria-pressed={layout.rightOpen}
        title="Toggle review/files panel (Ctrl+Shift+R)"
        onClick={() => store.setLayout({ rightOpen: !layout.rightOpen })}
      >
        Review
      </button>
    </header>
  );
}
