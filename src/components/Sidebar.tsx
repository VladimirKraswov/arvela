import { modKeyLabel } from "../native/platform";
import { ProjectActions, RemovedProjects } from "./ProjectActions";
import { HostPicker, pickProjectFolder } from "./WorkspacePicker";
import { useEffect, useState } from "react";
import type { Session } from "../api/types";
import { store, useAppState } from "../state/store";
import { FloatingPopover } from "./FloatingPopover";
import { Icon } from "./Icon";
export const pickFolder = pickProjectFolder;

function ActivityMark({ id, pending = false }: { id: string; pending?: boolean }) {
  const status = store.activityStatus(id);
  if (status?.type === "busy" || status?.type === "retry")
    return <span className="session-spinner" role="status" aria-label="Задача выполняется" />;
  if (pending || status?.type === "waiting")
    return <span className="pending-dot" aria-label="Требуется ответ">!</span>;
  if (store.isUnread(id))
    return <span className="unread-dot" role="status" aria-label="Задача завершена, результат не прочитан" />;
  return null;
}

export function Sidebar() {
  const s = useAppState();
  const [archived, setArchived] = useState(false),
    [menu, setMenu] = useState<string | null>(null),
    [rename, setRename] = useState<Session | null>(null),
    [title, setTitle] = useState(""),
    [all, setAll] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const projectName = (dir: string) => dir.split("/").filter(Boolean).pop() ?? dir;
  const pinned = s.prefs.pinnedProjects ?? [];
  const dirs = store.projectDirectories().sort((a, b) => {
    const ai = pinned.indexOf(a), bi = pinned.indexOf(b);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) ||
      Number(b.startsWith("/Volumes/")) - Number(a.startsWith("/Volumes/")) ||
      projectName(a).localeCompare(projectName(b)) || a.localeCompare(b);
  });
  const [shownByProject, setShownByProject] = useState<Record<string, number>>({});
  const [recentCount, setRecentCount] = useState(8);
  const expandedKey = JSON.stringify(dirs.filter((dir) => store.isProjectExpanded(dir)));
  const hostKey = s.prefs.workspaceKey ?? s.prefs.endpoint;
  useEffect(() => {
    if (s.connection.phase === "connected") void store.loadRecentSessions(archived);
  }, [s.connection.phase, hostKey, archived]);
  useEffect(() => {
    if (s.connection.phase === "connected") {
      for (const dir of JSON.parse(expandedKey) as string[]) void store.loadProjectSessions(dir);
    }
  }, [s.connection.phase, hostKey, expandedKey]);
  useEffect(() => { setMenu(null); setRename(null); setShownByProject({}); setRecentCount(8); }, [hostKey]);
  const row = (sess: Session, prefix: string, recent = false) => {
    const rowKey = `${prefix}:${sess.id}`;
    const isArchived = Boolean(sess.time.archived);
    const pending = store.pendingInteraction(sess.id);
    return (
      <div className="session-row-wrap" key={rowKey}>
        <button
          className={`session-item${s.activeSessionId === sess.id ? " active" : ""}`}
          onClick={() => {
            setMenu(null);
            if (!isArchived) void store.openChat(sess);
          }}
          title={sess.title}
        >
          <Icon name="chat" size={15} />
          <span className="title">{sess.title}{recent && <small className="session-project">{store.isProjectlessDirectory(sess.directory) ? "Без проекта" : projectName(sess.directory)}</small>}</span>
          <ActivityMark id={sess.id} pending={pending.permissions.length + pending.questions.length > 0} />
        </button>
        {isArchived ? (
          <button
            className="task-menu"
            aria-label={`Восстановить ${sess.title}`}
            onClick={() => void store.unarchiveSession(sess)}
          >
            <Icon name="refresh" size={15} />
          </button>
        ) : (
          <button
            className="task-menu"
            aria-label={`Действия: ${sess.title}`}
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
              setMenu(menu === rowKey ? null : rowKey);
            }}
          >
            <Icon name="dots" size={16} />
          </button>
        )}
        {menu === rowKey && (
          <FloatingPopover
            anchor={menuAnchor}
            className="task-popover"
            role="menu"
            label="Действия задачи"
            width={180}
            placement="bottom"
            align="end"
            onClose={() => setMenu(null)}
          >
            <button
              onClick={() => {
                setRename(sess);
                setTitle(sess.title);
                setMenu(null);
              }}
            >
              Переименовать
            </button>
            <button onClick={() => { setMenu(null); store.setUi({ handoffSource: sess }); }}>Передать задание…</button>
            <button
              onClick={() => {
                void store.archiveSession(sess);
                setMenu(null);
              }}
            >
              В архив
            </button>
            <button
              className="danger-text"
              onClick={() => {
                store.setUi({ confirmDelete: sess });
                setMenu(null);
              }}
            >
              Удалить…
            </button>
          </FloatingPopover>
        )}
      </div>
    );
  };
  const recent = s.recentSessionList;
  const visibleRecent = recent.sessions.filter((session) => !store.isProjectHidden(session.directory));
  return (
    <aside
      className="sidebar"
      style={{ width: s.prefs.layout.sidebarWidth }}
      aria-label="Проекты и задачи"
    >
      <div className="sidebar-brand" data-tauri-drag-region="deep">
        <Icon name="code" size={21} />
        <strong>OpenCode</strong>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label="Скрыть боковую панель"
          onClick={() => store.setLayout({ sidebarOpen: false })}
        >
          <Icon name="sidebar" size={17} />
        </button>
      </div>
      <nav className="sidebar-nav">
        <button
          onClick={() => {
            void store.newSession();
          }}
        >
          <Icon name="new" />
          Новый чат<kbd>{modKeyLabel()} N</kbd>
        </button>
        <button onClick={() => store.setUi({ paletteOpen: true })}>
          <Icon name="search" />
          Поиск<kbd>{modKeyLabel()} K</kbd>
        </button>
      </nav>
      <div className="sidebar-host">
        <HostPicker compact />
      </div>
      <div className="sidebar-scroll">
        <div className="section-label">
          <span>Проекты</span>
          <button className="icon-btn" aria-label="Добавить проект" title="Открыть папку" onClick={() => void pickFolder()}><Icon name="plus" size={16} /></button>
          <button className="icon-btn" aria-label="Обновить проекты" onClick={() => {
            void store.refreshProjects();
            for (const dir of dirs) if (store.isProjectExpanded(dir)) void store.loadProjectSessions(dir, { force: true });
            void store.loadRecentSessions(archived);
          }}><Icon name="refresh" size={14} /></button>
        </div>
        {(all ? dirs : dirs.slice(0, 7)).map((dir) => {
          const expanded = store.isProjectExpanded(dir);
          const list = s.projectSessionLists[dir];
          const sessions = list?.sessions.filter((session) => !session.time.archived) ?? [];
          const shown = shownByProject[dir] ?? 8;
          const name = projectName(dir);
          return <section className="project-group" key={dir} aria-label={`Проект ${name}`}>
            <div className="project-heading">
              <button className={`project-row${dir === s.directory ? " selected" : ""}`} title={dir} aria-label={name} aria-expanded={expanded}
                onClick={() => { setMenu(null); store.toggleProject(dir); }}>
                <Icon name={expanded ? "down" : "chevron"} size={12} />
                <Icon name="folder" size={17} />
                <span className="project-name">{name}</span>
                {!expanded && store.hasRunningInDirectory(dir) && <span className="session-spinner" role="status" aria-label="В проекте выполняется задача" />}
                {!expanded && store.hasUnreadInDirectory(dir) && <span className="unread-dot" role="status" aria-label="Есть непрочитанные результаты" />}
              </button>
              <button className="project-new icon-btn" aria-label={`Новый чат в ${name}`} title="Новый чат в проекте" onClick={() => void store.setDirectory(dir)}><Icon name="plus" size={15} /></button>
              <ProjectActions directory={dir} />
            </div>
            {expanded && <div className="project-sessions" aria-label={`Сессии ${name}`}>
              {sessions.filter((sess, index) => index < shown || store.isUnread(sess.id) || store.isRunning(sess.id)).map((sess) => row(sess, dir))}
              {list?.loading && <div className="empty-hint" role="status">Загрузка…</div>}
              {list?.error && <div className="empty-hint" role="alert">Не удалось загрузить сессии. <button title={list.error} onClick={() => void store.loadProjectSessions(dir, { force: true })}>Повторить</button></div>}
              {list?.loaded && !list.loading && !list.error && sessions.length === 0 && <button className="project-empty" onClick={() => void store.setDirectory(dir)}>Начать первый чат</button>}
              {(sessions.length > shown || list?.hasMore) && <button className="show-more" disabled={list?.loading} onClick={() => {
                setShownByProject((prev) => ({ ...prev, [dir]: shown + 20 }));
                if (shown + 20 >= sessions.length && list?.hasMore) void store.loadProjectSessions(dir, { more: true });
              }}>Ещё сессии</button>}
            </div>}
          </section>;
        })}
        {dirs.length > 7 && <button className="show-more" onClick={() => setAll(!all)}>{all ? "Меньше проектов" : `Все проекты (${dirs.length})`}</button>}
        {dirs.length === 0 && <button className="project-empty" onClick={() => void pickFolder()}>Открыть папку проекта<Icon name="plus" size={16} /></button>}
        <RemovedProjects />
        <section className="recent-sessions" aria-label={archived ? "Архив" : "Недавние"}>
          <div className="section-label task-heading">
            <span>{archived ? "Архив" : "Недавние"}</span>
            <button className={`icon-btn${archived ? " on" : ""}`} title={archived ? "Показать недавние" : "Архив всех проектов"} aria-label={archived ? "Показать недавние" : "Показать архив"} onClick={() => { setArchived(!archived); setRecentCount(8); }}><Icon name="archive" size={15} /></button>
          </div>
          {recent.archived === archived && visibleRecent.slice(0, recentCount).map((sess) => row(sess, "recent", true))}
          {recent.loading && <div className="empty-hint" role="status">Загрузка…</div>}
          {recent.error && <div className="empty-hint" role="alert">Не удалось загрузить сессии. <button title={recent.error} onClick={() => void store.loadRecentSessions(archived)}>Повторить</button></div>}
          {recent.loaded && !recent.loading && !recent.error && visibleRecent.length === 0 && <div className="empty-hint">{archived ? "Архив пуст" : "Здесь появятся ваши недавние чаты"}</div>}
          {(visibleRecent.length > recentCount || recent.hasMore) && <button className="show-more" disabled={recent.loading} onClick={() => {
            setRecentCount(recentCount + 20);
            if (recentCount + 20 >= visibleRecent.length && recent.hasMore) void store.loadRecentSessions(archived, true);
          }}>Показать ещё</button>}
        </section>
      </div>
      <div className="sidebar-footer">
        <button
          className="profile-button"
          onClick={() => store.setUi({ settingsOpen: true })}
        >
          <span className="profile-avatar">
            <Icon name="code" size={17} />
          </span>
          <span>
            <b>OpenCode Desktop</b>
            <small>
              <i
                className={`conn-dot ${s.connection.phase === "connected" ? "ok" : "bad"}`}
              />
              {s.connection.phase === "connected"
                ? `${store.currentHost() ? "SSH" : "Локально"} · ${s.connection.version}`
                : "Нет подключения"}
            </small>
          </span>
          <Icon name="settings" size={17} />
        </button>
      </div>
      {rename && (
        <div
          className="modal-overlay"
          onKeyDown={(e) => {
            if (e.key === "Escape") setRename(null);
          }}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Переименовать задачу"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) void store.renameSession(rename, title.trim());
              setRename(null);
            }}
          >
            <h3>Название задачи</h3>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                onClick={() => setRename(null)}
              >
                Отмена
              </button>
              <button className="btn primary">Сохранить</button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
