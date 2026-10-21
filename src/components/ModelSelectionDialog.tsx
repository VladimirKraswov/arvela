import { useEffect, useRef } from "react";
import type { SwitchStatus } from "../models/services";
import { ModelSwitchStatus } from "./ModelSwitchStatus";

/** The dialog describes the requested target, never the previously selected model. */
export function ModelSelectionDialog({ label, pending, error, status, progress, onClose, onRetry }: {
  label: string; pending: boolean; error: string; status?: SwitchStatus; progress?: string;
  onClose: () => void; onRetry: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="model-selection-dialog" aria-labelledby="model-selection-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="model-selection-title">{pending ? "Подготовка модели" : "Не удалось переключить модель"}</h2>
    <p className="model-selection-name">{label}</p>
    {pending ? <>
      <p role="status">{progress || "Проверяем подключение и готовность. Переключение может занять некоторое время."}</p>
      {status && <ModelSwitchStatus state={status} modelName={label}/>}
    </> : <>
      <p>Модель остаётся в списке. Текущий выбор сохранён. Устраните указанную причину и повторите переход.</p>
      <p className="model-selection-error" role="alert">{error}</p>
    </>}
    <div className="btn-row">
      <button type="button" className="btn" onClick={onClose}>{pending ? "Отменить" : "Закрыть"}</button>
      {!pending && <button type="button" className="btn primary" onClick={onRetry}>Проверить снова</button>}
    </div>
  </dialog>;
}
