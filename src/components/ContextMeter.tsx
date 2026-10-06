import { useRef, useState } from "react";
import { FloatingPopover } from "./FloatingPopover";
import { store, useAppState } from "../state/store";
export function ContextMeter() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const s = useAppState(),
    c = store.contextInfo();
  const isPi = store.engineIdFor() === "pi";
  const n = (x: number | null) =>
    x === null ? "—" : x.toLocaleString("ru-RU");
  const title = `Контекст: ${n(c.used)} / ${n(c.limit)} токенов. ${isPi ? "Данные Pi обновляются после ответа." : c.auto ? `До автосжатия: ${n(c.remaining)}. Порог: ${n(c.threshold)}.` : "Автосжатие отключено в OpenCode."}`;
  return (
    <div className="context-meter">
      <button ref={ref} className="context-trigger" aria-label={title} title={title}
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="var(--border)"
            strokeWidth="2.5"
          />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke={
              c.used !== null && c.used >= c.threshold
                ? "var(--warn)"
                : "currentColor"
            }
            strokeWidth="2.5"
            strokeDasharray={`${c.percent * 0.5655} 56.55`}
            transform="rotate(-90 12 12)"
          />
        </svg>
        <span>
          {c.compacting
            ? "Сжатие…"
            : c.used === null
              ? "Контекст"
              : `${c.percent}%`}
        </span>
      </button>
      {open && <FloatingPopover anchor={ref.current} className="context-popover" role="dialog"
        label="Контекст диалога" onClose={() => setOpen(false)}>
        <strong>Контекст диалога</strong>
        <div className="kv">
          <span>Занято / окно</span>
          <b>
            {n(c.used)} / {n(c.limit)}
          </b>
        </div>
        {!isPi && <>
          <div className="kv">
            <span>До автосжатия</span>
            <b>{c.auto ? n(c.remaining) : "Отключено"}</b>
          </div>
          <div className="kv">
            <span>Порог сжатия</span>
            <b>{n(c.threshold)}</b>
          </div>
        </>}
        <p>{isPi
          ? "Последние данные Pi. Во время генерации счётчик обновляется после отчёта движка."
          : "Последние данные OpenCode. Во время генерации счётчик обновляется после отчёта движка. История сохраняется, рабочий контекст сжимается автоматически."}
        </p>
        {store.conversation().capabilities.compaction && <button
          className="btn small"
          disabled={!s.activeSessionId || store.isRunning() || c.compacting}
          onClick={() =>
            s.activeSessionId && void store.compactSession(s.activeSessionId)
          }
        >
          Сжать сейчас
        </button>}
      </FloatingPopover>}
    </div>
  );
}
