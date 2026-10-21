import { isSwitching, switchPhaseLabels } from "../models/services";
import { Icon } from "./Icon";

export function ModelSwitchStatus({ state, modelName }: {
  state: { phase: string; ready: boolean; elapsed_seconds: number; error?: string | null;
    detail?: string; loader?: { unit?: string | null; total: number; current: number } | null };
  modelName: string;
}) {
  const loading = isSwitching(state);
  return <div className={`model-switch-status ${state.ready ? "is-ready" : ""}`} role="status" aria-live="polite">
    <div className="model-switch-summary">
      {state.ready && <Icon name="check" size={14}/>}
      {loading && <span className="tool-spinner" aria-hidden="true"/>}
      <span>{state.ready ? "Готова" : switchPhaseLabels[state.phase] ?? "Подготовка модели"}</span>
      <span className="model-switch-name" title={modelName}>{modelName}</span>
      {loading && <span className="model-switch-time">{Math.max(0, Math.floor(state.elapsed_seconds))} с</span>}
    </div>
    {loading && state.loader?.unit === "bytes" && state.loader.total > 0 &&
      <progress aria-label="Загрузка весов" value={state.loader.current} max={state.loader.total}/>}
    {loading && state.detail && <span className="model-switch-detail">{state.detail}</span>}
    {state.error && <span className="model-switch-error" role="alert">{state.error}</span>}
  </div>;
}
