import { HostPicker, pickProjectFolder } from "./WorkspacePicker";
import { useState } from "react";
import type { Session } from "../api/types";
import { store, useAppState } from "../state/store";
import { FloatingPopover } from "./FloatingPopover";
import { Icon } from "./Icon";
export const pickFolder = pickProjectFolder;
export function Sidebar() {
  const s = useAppState();
  const [archived, setArchived] = useState(false),
    [menu, setMenu] = useState<string | null>(null),
    [rename, setRename] = useState<Session | null>(null),
    [title, setTitle] = useState(""),
    [all, setAll] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const dirs = store
    .projectDirectories()
    .sort(
      (a, b) =>
        Number(b === s.directory) - Number(a === s.directory) ||
        Number(b.startsWith("/Volumes/")) - Number(a.startsWith("/Volumes/")) ||
        a.localeCompare(b),
    );
  const projectless = store.isProjectless();
  const sessions = [
    ...(projectless
      ? store.chatSessions(archived)
      : archived
        ? s.archivedSessions
        : s.sessions),
  ].sort((a, b) => b.time.updated - a.time.updated);
  const currentName = !projectless
    ? s.directory?.split("/").filter(Boolean).pop()
    : null;
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
          Новый чат<kbd>⌘ N</kbd>
        </button>
        <button onClick={() => store.setUi({ paletteOpen: true })}>
          <Icon name="search" />
          Поиск<kbd>⌘ K</kbd>
        </button>
      </nav>
      <div className="sidebar-host">
        <HostPicker compact />
      </div>
      <div className="sidebar-scroll">
        {!projectless && store.chatSessions().length > 0 && (
          <>
            <div className="section-label">
              <span>Чаты без проекта</span>
            </div>
            {store
              .chatSessions()
              .slice(0, 8)
              .map((chat) => (
                <button
                  key={chat.id}
                  className="session-item chat-index-item"
                  onClick={() => {
                    setArchived(false);
                    void store.openChat(chat);
                  }}
                  title={chat.title}
                >
                  <Icon name="chat" size={15} />
                  <span className="title">{chat.title}</span>
                </button>
              ))}
            {store.chatSessions().length > 8 && (
              <button
                className="show-more"
                onClick={() => void store.newSession()}
              >
                Все чаты ({store.chatSessions().length})
              </button>
            )}
          </>
        )}

        <div className="section-label">
          <span>Проекты</span>
          <button
            className="icon-btn"
            aria-label="Добавить проект"
            title="Открыть папку"
            onClick={() => void pickFolder()}
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            className="icon-btn"
            aria-label="Обновить проекты"
            onClick={() => void store.refreshProjects()}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
        {(all ? dirs : dirs.slice(0, 7)).map((dir) => (
          <button
            key={dir}
            className={`project-row${dir === s.directory ? " selected" : ""}`}
            title={dir}
            onClick={() => {
              setArchived(false);
              setMenu(null);
              void store.setDirectory(dir, { restoreSession: true });
            }}
          >
            <Icon name="folder" size={17} />
            <span>{dir.split("/").filter(Boolean).pop()}</span>
            {dir === s.directory && <Icon name="down" size={13} />}
          </button>
        ))}
        {dirs.length > 7 && (
          <button className="show-more" onClick={() => setAll(!all)}>
            {all ? "Свернуть" : `Все проекты (${dirs.length})`}
          </button>
        )}
        {dirs.length === 0 && (
          <button className="project-empty" onClick={() => void pickFolder()}>
            Открыть папку проекта
            <Icon name="plus" size={16} />
          </button>
        )}
        <div className="section-label task-heading">
          <span title={s.directory ?? ""}>
            {archived
              ? "Архив"
              : currentName
                ? `Задачи · ${currentName}`
                : "Чаты без проекта"}
          </span>
          <button
            className={`icon-btn${archived ? " on" : ""}`}
            title="Архив"
            aria-label="Показать архив"
            onClick={() => setArchived(!archived)}
          >
            <Icon name="archive" size={15} />
          </button>
        </div>
        {s.ui.sessionListLoading && <div className="empty-hint">Загрузка…</div>}
        {s.ui.sessionListError && (
          <div className="empty-hint" role="alert">
            {s.ui.sessionListError}
            <button onClick={() => void store.refreshSessions()}>
              Повторить
            </button>
          </div>
        )}
        {!s.ui.sessionListLoading && sessions.length === 0 && (
          <div className="empty-hint">
            {archived
              ? "Архив пуст"
              : s.directory
                ? "Здесь появятся ваши задачи"
                : "Начните новый чат — проект необязателен"}
          </div>
        )}
        {sessions.map((sess) => {
          const st = s.chat.sessions[sess.id]?.status ?? s.statuses[sess.id];
          const pending = store.pendingInteraction(sess.id);
          return (
            <div className="session-row-wrap" key={sess.id}>
              <button
                className={`session-item${s.activeSessionId === sess.id ? " active" : ""}`}
                onClick={() => {
                  setMenu(null);
                  if (!archived)
                    void (projectless
                      ? store.openChat(sess)
                      : store.selectSession(sess.id));
                }}
                title={sess.title}
              >
                <Icon name="chat" size={15} />
                <span className="title">{sess.title}</span>
                {(st?.type === "busy" || st?.type === "retry") && (
                  <span className="busy-dot" aria-label="Задача выполняется" />
                )}
                {pending.permissions.length + pending.questions.length > 0 && (
                  <span className="pending-dot" title="Требуется ответ">
                    •
                  </span>
                )}
              </button>
              {archived ? (
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
                    setMenu(menu === sess.id ? null : sess.id);
                  }}
                >
                  <Icon name="dots" size={16} />
                </button>
              )}
              {menu === sess.id && (
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
        })}
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
