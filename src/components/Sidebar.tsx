import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../api/types";
import { store, useAppState } from "../state/store";

async function pickFolder(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title: "Open project folder" });
    return typeof picked === "string" ? picked : null;
  } catch {
    // Not running under Tauri (plain browser dev): fall back to manual entry.
    const dir = window.prompt("Absolute project path");
    return dir && dir.trim() ? dir.trim() : null;
  }
}

function bucketFor(session: Session, now: number): string {
  const day = 86400000;
  const age = now - session.time.updated;
  if (age < day) return "Today";
  if (age < 2 * day) return "Yesterday";
  if (age < 7 * day) return "Previous 7 days";
  return "Older";
}

export function Sidebar() {
  const s = useAppState();
  const [search, setSearch] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const dirs = useMemo(() => {
    const seen = new Set<string>();
    const out: { worktree: string; id: string }[] = [];
    for (const p of s.projects) {
      if (!p.worktree || p.worktree === "/" || seen.has(p.worktree)) continue;
      seen.add(p.worktree);
      out.push({ worktree: p.worktree, id: p.id });
    }
    return out.sort((a, b) => a.worktree.localeCompare(b.worktree));
  }, [s.projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? s.sessions.filter((x) => x.title.toLowerCase().includes(q)) : s.sessions;
    return [...list].sort((a, b) => b.time.updated - a.time.updated);
  }, [s.sessions, search]);

  const groups = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, Session[]>();
    for (const sess of filtered) {
      const b = bucketFor(sess, now);
      (map.get(b) ?? map.set(b, []).get(b)!).push(sess);
    }
    return ["Today", "Yesterday", "Previous 7 days", "Older"].filter((k) => map.has(k)).map((k) => [k, map.get(k)!] as const);
  }, [filtered]);

  const connected = s.connection.phase === "connected";

  return (
    <aside className="sidebar" style={{ width: s.prefs.layout.sidebarWidth }} aria-label="Projects and sessions">
      <div className="sidebar-header">
        <button
          className="btn primary"
          disabled={!connected || !s.directory}
          onClick={() => void store.newSession()}
          title="New conversation"
        >
          + New conversation
        </button>
        <div className="project-picker">
          <select
            aria-label="Project"
            value={s.directory ?? ""}
            onChange={(e) => void store.setDirectory(e.target.value || null)}
          >
            <option value="">Select project…</option>
            {dirs.map((d) => (
              <option key={d.id} value={d.worktree}>
                {d.worktree.split("/").filter(Boolean).pop() ?? d.worktree}
              </option>
            ))}
          </select>
        </div>
        <div className="btn-row">
          <button className="btn small" disabled={!connected} onClick={async () => {
            const dir = await pickFolder();
            if (dir) await store.addProjectDirectory(dir);
          }}>
            Add folder
          </button>
          <button className="btn small ghost" disabled={!connected} onClick={() => void store.refreshProjects()} title="Refresh projects">
            ↻
          </button>
        </div>
        <input
          className="search-box"
          placeholder="Search sessions"
          aria-label="Search sessions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="session-groups">
        {!s.directory && <div className="empty-hint">Choose a project or add a folder to see its sessions.</div>}
        {s.directory && s.ui.sessionListLoading && <div className="empty-hint">Loading sessions…</div>}
        {s.directory && s.ui.sessionListError && (
          <div className="empty-hint" role="alert">
            {s.ui.sessionListError}{" "}
            <button className="btn small ghost" onClick={() => void store.refreshSessions()}>Retry</button>
          </div>
        )}
        {s.directory && !s.ui.sessionListLoading && !s.ui.sessionListError && filtered.length === 0 && (
          <div className="empty-hint">No conversations yet. Start a new one.</div>
        )}
        {groups.map(([label, items]) => (
          <section key={label}>
            <div className="session-group-title">{label}</div>
            {items.map((sess) => {
              const st = s.statuses[sess.id] ?? s.chat.sessions[sess.id]?.status;
              // Pending requests are keyed by request id; match on the request's session (R8).
              const pending = store.pendingInteraction(sess.id);
              const hasPending = pending.permissions.length + pending.questions.length > 0;
              return (
                <div key={sess.id} style={{ position: "relative" }} ref={menuFor === sess.id ? menuRef : undefined}>
                  <div
                    className={`session-item${s.activeSessionId === sess.id ? " active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => void store.selectSession(sess.id)}
                    onKeyDown={(e) => e.key === "Enter" && void store.selectSession(sess.id)}
                  >
                    <span className="title" title={sess.title}>{sess.title}</span>
                    {(st?.type === "busy" || st?.type === "retry") && <span className="busy-dot" title="Running" aria-label="Session running" />}
                    {hasPending && <span title="Waiting for your input" aria-label="Waiting for input" style={{ color: "var(--warn)" }}>•</span>}
                    <button
                      className="menu-btn"
                      aria-label={`Actions for ${sess.title}`}
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === sess.id ? null : sess.id); }}
                    >⋯</button>
                  </div>
                  {menuFor === sess.id && (
                    <div className="modal" style={{ position: "absolute", right: 6, top: 30, width: 170, padding: 8, zIndex: 30 }} role="menu">
                      <button className="btn small" style={{ width: "100%", marginBottom: 4 }} onClick={() => {
                        setMenuFor(null);
                        const title = window.prompt("Session title", sess.title);
                        if (title?.trim()) void store.renameSession(sess, title.trim());
                      }}>Rename</button>
                      <button className="btn small" style={{ width: "100%", marginBottom: 4 }} onClick={() => { setMenuFor(null); void store.archiveSession(sess); }}>Archive</button>
                      <button className="btn small danger" style={{ width: "100%" }} onClick={() => { setMenuFor(null); store.setUi({ confirmDelete: sess }); }}>Delete…</button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {s.directory && s.archivedSessions.length > 0 && (
          <section>
            <button
              className="session-group-title"
              style={{ cursor: "pointer", width: "100%", textAlign: "left", background: "none", border: "none" }}
              onClick={() => setShowArchived(!showArchived)}
              aria-expanded={showArchived}
            >
              {showArchived ? "▾" : "▸"} Archived ({s.archivedSessions.length})
            </button>
            {showArchived &&
              s.archivedSessions.map((sess) => (
                <div key={sess.id} className="session-item" style={{ opacity: 0.75 }}>
                  <span className="title" title={sess.title}>{sess.title}</span>
                  <button className="btn small" onClick={() => void store.unarchiveSession(sess)} aria-label={`Restore ${sess.title}`}>
                    Restore
                  </button>
                  <button className="menu-btn" aria-label={`Delete archived ${sess.title}`} title="Delete permanently" onClick={() => store.setUi({ confirmDelete: sess })}>
                    ✕
                  </button>
                </div>
              ))}
          </section>
        )}
      </div>
      <div className="sidebar-footer">
        <span className="grow" title={s.connection.endpoint}>{s.connection.version ? `engine ${s.connection.version}` : "engine —"}</span>
        <button className="btn small ghost" onClick={() => store.setUi({ settingsOpen: true })} aria-label="Settings">Settings</button>
      </div>
    </aside>
  );
}
