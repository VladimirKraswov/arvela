import { useEffect, useRef } from "react";
import type { SwitchStatus } from "../models/services";
import { ModelSwitchStatus } from "./ModelSwitchStatus";

/** The dialog describes the requested target, never the previously selected model. */
export function ModelSelectionDialog({ label, pending, error, status, onClose, onRetry }: {
  label: string; pending: boolean; error: string; status?: SwitchStatus;
  onClose: () => void; onRetry: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="model-selection-dialog" aria-labelledby="model-selection-title"
    onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <h2 id="model-selection-title">{pending ? "Подготовка модели" : "Модель сейчас недоступна"}</h2>
    <p className="model-selection-name">{label}</p>
    {pending ? <>
      <p>Проверяем подключение и готовность. Переключение может занять некоторое время.</p>
      {status && <ModelSwitchStatus state={status} modelName={label}/>}
    </> : <>
      <p>Модель остаётся в списке. Проверьте, что сервер запущен, затем повторите выбор.</p>
      <p className="model-selection-error" role="alert">{error}</p>
    </>}
    <div className="btn-row">
      <button type="button" className="btn" disabled={pending} onClick={onClose}>Закрыть</button>
      {!pending && <button type="button" className="btn primary" onClick={onRetry}>Проверить снова</button>}
    </div>
  </dialog>;
}
