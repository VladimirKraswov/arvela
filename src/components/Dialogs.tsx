import { version as appVersion } from "../../package.json";
import { defaultAsr, getAsrKey, setAsrKey, validateAsr } from "../voice/asr";
import { useEffect, useState } from "react";
import { store, useAppState } from "../state/store";
import { DEFAULT_BASE_URL } from "../api/client";

export function SettingsDialog() {
  const s = useAppState();
  const [endpoint, setEndpoint] = useState(
    s.prefs.localEndpoint ?? s.prefs.endpoint,
  );
  const [asr, setAsr] = useState(s.prefs.asr ?? defaultAsr);
  const [asrKey, setKey] = useState(getAsrKey(asr.endpoint));
  const [asrError, setAsrError] = useState("");
  useEffect(() => {
    if (s.ui.settingsOpen) {
      setEndpoint(s.prefs.localEndpoint ?? s.prefs.endpoint);
      setAsr(s.prefs.asr ?? defaultAsr);
      setKey(getAsrKey(s.prefs.asr?.endpoint ?? ""));
      setAsrError("");
    }
  }, [s.ui.settingsOpen, s.prefs.endpoint]);
  if (!s.ui.settingsOpen) return null;
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) =>
        e.target === e.currentTarget && store.setUi({ settingsOpen: false })
      }
    >
      <div
        className="modal"
        role="dialog"
        aria-label="Настройки"
        aria-modal="true"
      >
        <h3>Настройки</h3>
        <label>
          Адрес локального сервера OpenCode
          <input
            autoFocus
            value={endpoint}
            spellCheck={false}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
          />
        </label>
        <button
          className="btn"
          onClick={() => {
            store.setUi({ settingsOpen: false, hostDialogOpen: true });
          }}
        >
          Удалённые компьютеры…
        </button>
        <div className="row">
          <span>Оформление</span>
          <select
            value={s.prefs.theme}
            onChange={(e) =>
              store.setTheme(e.target.value as "light" | "dark" | "system")
            }
            aria-label="Theme"
          >
            <option value="system">Системное</option>
            <option value="light">Светлое</option>
            <option value="dark">Тёмное</option>
          </select>
        </div>
        <fieldset className="asr-settings">
          <legend>Диктовка · ASR API</legend>
          <p>
            API формата OpenAI: POST multipart, ответ JSON с полем text.
            Диктовка добавляет текст в черновик.
          </p>
          <label>
            Полный URL
            <input
              placeholder="http://192.168.31.71:8000/v1/audio/transcriptions"
              value={asr.endpoint}
              onChange={(e) => {
                setAsr({ ...asr, endpoint: e.target.value });
                setKey("");
              }}
              spellCheck={false}
            />
          </label>
          <div className="row">
            <label>
              Модель
              <input
                value={asr.model}
                onChange={(e) => setAsr({ ...asr, model: e.target.value })}
              />
            </label>
            <label>
              Язык
              <input
                value={asr.language}
                placeholder="ru или пусто для авто"
                onChange={(e) => setAsr({ ...asr, language: e.target.value })}
              />
            </label>
          </div>
          <label>
            API key
            <input
              type="password"
              autoComplete="off"
              value={asrKey}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Если требуется"
            />
          </label>
          <small>
            Ключ хранится только до закрытия приложения. Аудио не сохраняется на
            диск. Запись — до 2 минут. HTTP в локальной сети передаёт звук без
            шифрования.
          </small>
          {asrError && (
            <div role="alert" className="composer-error">
              {asrError}
            </div>
          )}
        </fieldset>
        <div className="kv">
          <span>Версия OpenCode</span>
          <b>{s.connection.version ?? "—"}</b>
        </div>
        <div className="kv">
          <span>Версия приложения</span>
          <b>{appVersion}</b>
        </div>
        <div className="kv">
          <span>Подключение</span>
          <b>{s.connection.phase}</b>
        </div>
        <div className="kv">
          <span>Поток событий</span>
          <b>{s.connection.streamState}</b>
        </div>
        <div className="kv">
          <span>Провайдеры</span>
          <b>{s.connectedProviderIds.length || "—"}</b>
        </div>
        <div className="kv">
          <span>Агенты</span>
          <b>{s.agents.map((a) => a.name).join(", ") || "—"}</b>
        </div>
        <div
          className="btn-row"
          style={{ justifyContent: "flex-end", marginTop: 4 }}
        >
          <button
            className="btn"
            onClick={() => store.setUi({ settingsOpen: false })}
          >
            Закрыть
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const problem = asr.endpoint.trim() ? validateAsr(asr) : null;
              if (problem) {
                setAsrError(problem);
                return;
              }
              store.setAsr({
                ...asr,
                endpoint: asr.endpoint.trim(),
                model: asr.model.trim(),
              });
              setAsrKey(asr.endpoint, asrKey);
              store.setUi({ settingsOpen: false });
              if (endpoint !== (s.prefs.localEndpoint ?? s.prefs.endpoint))
                void store.connect(endpoint);
            }}
          >
            Сохранить и подключиться
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirm() {
  const s = useAppState();
  const sess = s.ui.confirmDelete;
  if (!sess) return null;
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
          “{sess.title}” and its full history will be removed from OpenCode.
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
            будут запускаться на этом Mac вместо удалённой машины.
          </>
        ) : (
          <>
            Запустите локальный{" "}
            <code>opencode serve --hostname 127.0.0.1 --port 4096</code> и
            повторите подключение. Движок устанавливается и обновляется отдельно
            от приложения.
          </>
        )}
      </p>
      {s.connection.error && (
        <p className="composer-error">{s.connection.error}</p>
      )}
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
