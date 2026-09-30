import { useEffect, useState } from "react";
import { store, useAppState } from "../state/store";
import { detectLocalOpenCode } from "../native/localServer";

const OPEN_CODE_INSTALL_URL = "https://opencode.ai/docs/";

export function DeleteConfirm() {
  const s = useAppState();
  const sess = s.ui.confirmDelete;
  if (!sess) return null;
  const engine = store.isPiSession(sess.id) ? "Pi" : "OpenCode";
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) =>
        e.target === e.currentTarget && store.setUi({ confirmDelete: null })
      }
    >
      <div className="modal" role="alertdialog" aria-label="Delete session">
        <h3>Delete session permanently?</h3>
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--text-dim)",
            lineHeight: 1.6,
          }}
        >
          “{sess.title}” and its full history will be removed from {engine}.
          This cannot be undone. If you only want to hide it, use <b>Archive</b>{" "}
          instead.
        </p>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button
            className="btn"
            onClick={() => store.setUi({ confirmDelete: null })}
          >
            Cancel
          </button>
          <button
            className="btn danger"
            onClick={() => void store.deleteSession(sess)}
          >
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const s = useAppState();
  if (!s.ui.toast) return null;
  return (
    <div
      className="toast"
      role="status"
      onMouseDown={() => store.setUi({ toast: null })}
    >
      {s.ui.toast}
    </div>
  );
}

export function ConnectionGate() {
  const s = useAppState();
  const remote = store.currentHost();
  const [endpoint, setEndpoint] = useState(
    s.prefs.localEndpoint ?? s.prefs.endpoint,
  );
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    if (remote) return;
    let active = true;
    void detectLocalOpenCode().then(found => { if (active) setCliInstalled(found); }).catch(() => {});
    return () => { active = false; };
  }, [remote]);
  if (s.connection.phase === "connected") return null;
  return (
    <div className="gate" role="alert" aria-live="polite">
      <h2>
        {s.connection.phase === "connecting"
          ? "Подключение к OpenCode…"
          : `Нет подключения · ${store.hostLabel()}`}
      </h2>
      <p>
        {remote ? (
          <>
            Проверьте SSH-доступ и сервер OpenCode на {remote.target}. Задачи не
            будут запускаться на этом компьютере вместо удалённой машины.
          </>
        ) : (
          <>
            Приложение запускает установленный OpenCode автоматически, если
            локальный сервер не работает. Проверьте адрес и установку OpenCode,
            затем повторите подключение. Движок обновляется отдельно от
            приложения.
          </>
        )}
      </p>
      {s.connection.error && (
        <p className="composer-error">{s.connection.error}</p>
      )}
      {!remote && cliInstalled === false && <button className="btn" onClick={() => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(OPEN_CODE_INSTALL_URL))}>Установить OpenCode…</button>}
      {remote ? (
        <button
          className="btn"
          onClick={() => store.setUi({ hostDialogOpen: true })}
        >
          Настроить подключение / ввести пароль
        </button>
      ) : (
        <label>
          Адрес локального сервера
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
        <button
          className="btn"
          disabled={s.connection.phase === "connecting"}
          onClick={() =>
            void (remote ? store.retryConnection() : store.connect(endpoint))
          }
        >
          Повторить подключение
        </button>
      </div>
    </div>
  );
}
