import { switchPhaseLabels } from "../models/services";
import { Icon } from "./Icon";

export function ModelSwitchStatus({ state, modelName }: {
  state: { phase: string; ready: boolean; elapsed_seconds: number; error?: string | null;
    loader?: { unit?: string | null; total: number; current: number } | null };
  modelName: string;
}) {
  const loading = !state.ready && state.phase !== "failed" && state.phase !== "unloaded";
  return <div className={`model-switch-status ${state.ready ? "is-ready" : ""}`} role="status" aria-live="polite">
    <div className="model-switch-summary">
      {state.ready && <Icon name="check" size={14}/>}
      <span>{state.ready ? "Готова" : switchPhaseLabels[state.phase] ?? "Подготовка модели"}</span>
      <span className="model-switch-name" title={modelName}>{modelName}</span>
      {loading && <span className="model-switch-time">{Math.max(0, Math.floor(state.elapsed_seconds))} с</span>}
    </div>
    {loading && state.loader?.unit === "bytes" && state.loader.total > 0 &&
      <progress aria-label="Загрузка весов" value={state.loader.current} max={state.loader.total}/>}
    {state.error && <span className="model-switch-error" role="alert">{state.error}</span>}
  </div>;
}
