// A blocking dialog requested by a Pi extension (`extension_ui_request`).
//
// The agent is stopped until this is answered, so the dialog is deliberately
// modal and offers no "remember this" shortcut: there is no hidden blanket
// approval anywhere in this path. Dismissing it answers `cancelled`, which the
// extension receives as "no". If the window never answers, the native side
// auto-cancels after its deadline — silence is a denial, never an approval.

import { useEffect, useRef, useState } from "react";
import { store, useAppState } from "../state/store";

export function PiDialog() {
  const s = useAppState();
  const dialog = s.ui.piDialog;
  const [value, setValue] = useState("");
  const first = useRef<HTMLButtonElement | HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(dialog?.request.prefill ?? "");
    first.current?.focus();
  }, [dialog?.request.id]);

  if (!dialog) return null;
  const request = dialog.request;
  const cancel = () => void store.answerPiDialog({ cancelled: true });

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <div
        className="dialog pi-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title ?? "Запрос расширения Pi"}
      >
        <h2>{request.title ?? "Запрос расширения Pi"}</h2>
        <p className="dialog-description">
          Запрос от расширения Pi в чате. Пока вы не ответите, агент ждёт.
        </p>
        {request.message && <p>{request.message}</p>}

        {request.method === "select" && (
          <div className="btn-row pi-dialog-options">
            {(request.options ?? []).map((option, index) => (
              <button
                key={option}
                ref={index === 0 ? (first as never) : undefined}
                className="btn"
                onClick={() => void store.answerPiDialog({ value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {(request.method === "input" || request.method === "editor") && (
          <label>
            {request.method === "editor" ? (
              <textarea
                aria-label={request.title ?? "Текст"}
                rows={8}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : (
              <input
                aria-label={request.title ?? "Значение"}
                placeholder={request.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </label>
        )}

        <div className="btn-row">
          <button className="btn" onClick={cancel}>
            Отклонить
          </button>
          {request.method === "confirm" && (
            <button
              className="btn primary"
              onClick={() => void store.answerPiDialog({ confirmed: true })}
            >
              Разрешить
            </button>
          )}
          {(request.method === "input" || request.method === "editor") && (
            <button
              className="btn primary"
              onClick={() => void store.answerPiDialog({ value })}
            >
              Отправить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
