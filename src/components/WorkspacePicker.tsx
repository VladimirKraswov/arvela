import { useRef, useState } from "react";
import { store, useAppState, errText } from "../state/store";
import { FloatingPopover } from "./FloatingPopover";
import { Icon } from "./Icon";

export async function pickProjectFolder(): Promise<void> {
  if (store.currentHost()) {
    store.setUi({ remoteFolderOpen: true });
    return;
  }
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      directory: true,
      multiple: false,
      title: "Выберите проект",
    });
    if (typeof path === "string") await store.addProjectDirectory(path);
  } catch (e) {
    store.setUi({ toast: `Не удалось открыть папку: ${errText(e)}` });
  }
}

export function WorkspacePicker() {
  const s = useAppState();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const dirs = store
    .projectDirectories()
    .filter((p) => p.toLowerCase().includes(query.toLowerCase()));
  const projectless = store.isProjectless();
  const close = () => {
    setOpen(false);
    anchor.current?.focus();
  };
  const choose = (dir: string | null) => {
    close();
    void store.setDirectory(dir);
  };
  return (
    <div
      className="workspace-choice"
      onKeyDown={(e) => {
        if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        const rows = [
          ...(popup.current?.querySelectorAll<HTMLButtonElement>(
            "[role=option]",
          ) ?? []),
        ];
        const i = rows.indexOf(document.activeElement as HTMLButtonElement);
        rows[
          (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length
        ]?.focus();
      }}
    >
      <button
        ref={anchor}
        className="workspace-trigger"
        aria-label="Выбрать проект"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={
          s.ui.workspacePreparing ||
          s.ui.sending ||
          s.connection.phase !== "connected"
        }
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        <Icon name={projectless ? "chat" : "folder"} size={18} />
        <span>
          {projectless
            ? "Выбрать проект"
            : s.directory?.split("/").filter(Boolean).pop()}
        </span>
        <Icon name="down" size={14} />
      </button>
      {projectless && <small>необязательно</small>}
      {open && (
        <FloatingPopover
          anchor={anchor.current}
          contentRef={popup}
          placement="bottom"
          width={370}
          className="workspace-popover"
          role="listbox"
          label="Проект для нового чата"
          onClose={close}
        >
          <div className="workspace-search">
            <Icon name="search" size={16} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти проект…"
              aria-label="Найти проект"
            />
          </div>
          <button
            className="workspace-option"
            role="option"
            aria-selected={projectless}
            onClick={() => choose(null)}
          >
            <Icon name="chat" />
            <span>
              Работать без проекта
              <small>Вопросы, поиск, настройка компьютеров</small>
            </span>
            {projectless && <Icon name="check" size={16} />}
          </button>
          <div className="picker-section">Проекты · {store.hostLabel()}</div>
          <div className="workspace-options">
            {dirs.map((dir) => (
              <button
                className="workspace-option"
                role="option"
                aria-selected={dir === s.directory}
                key={dir}
                onClick={() => choose(dir)}
              >
                <Icon name="folder" />
                <span>
                  {dir.split("/").filter(Boolean).pop()}
                  <small>{dir}</small>
                </span>
                {dir === s.directory && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          {!dirs.length && (
            <p className="picker-empty">
              {query ? "Проект не найден" : "Пока нет сохранённых проектов"}
            </p>
          )}
          <button
            className="workspace-option picker-add"
            role="option"
            aria-selected={false}
            onClick={() => {
              close();
              void pickProjectFolder();
            }}
          >
            <Icon name="plus" />
            <span>
              {store.currentHost()
                ? "Открыть папку на сервере…"
                : "Открыть папку…"}
            </span>
          </button>
        </FloatingPopover>
      )}
    </div>
  );
}

export function HostPicker({ compact = false }: { compact?: boolean }) {
  const s = useAppState(),
    [open, setOpen] = useState(false),
    anchor = useRef<HTMLButtonElement>(null);
  const active = s.prefs.activeHost ?? "local";
  return (
    <div className={`host-picker${compact ? " compact" : ""}`}>
      <button
        ref={anchor}
        className="host-trigger"
        aria-label="Место выполнения"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={s.ui.workspacePreparing || s.ui.sending}
      >
        <Icon name={store.currentHost() ? "server" : "monitor"} size={15} />
        <span>{store.hostLabel()}</span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        <FloatingPopover
          anchor={anchor.current}
          placement="bottom"
          width={310}
          className="host-popover"
          role="menu"
          label="Где работать"
          onClose={() => setOpen(false)}
        >
          <div className="picker-section">Где выполнять задачи</div>
          <button
            className="workspace-option"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void store.connectHost("local").then((ok) => {
                if (ok && !compact) return store.newSession();
              });
            }}
          >
            <Icon name="monitor" />
            <span>
              На этом компьютере<small>Файлы и инструменты этого Mac</small>
            </span>
            {active === "local" && <Icon name="check" size={16} />}
          </button>
          {(s.prefs.remoteHosts ?? []).map((host) => (
            <button
              key={host.id}
              className="workspace-option"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void store.connectHost(host.id).then((ok) => {
                  if (ok && !compact) return store.newSession();
                });
              }}
            >
              <Icon name="server" />
              <span>
                {host.name}
                <small>SSH · {host.target}</small>
              </span>
              {active === host.id && <Icon name="check" size={16} />}
            </button>
          ))}
          <button
            className="workspace-option picker-add"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              store.setUi({ hostDialogOpen: true });
            }}
          >
            <Icon name="plus" />
            <span>
              Работать удалённо…<small>Подключить компьютер по SSH</small>
            </span>
          </button>
        </FloatingPopover>
      )}
    </div>
  );
}
