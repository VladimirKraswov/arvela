import { useEffect, useRef, useState } from "react";
import { browserNative } from "../browser/integration";
import { parseFrame, type BrowserFrame } from "../browser/view";
import { Icon } from "./Icon";

/** A passive projection: never installs a resize observer or input handlers.
 * Only the two presentation controls invoke native commands. Chromium, agent
 * loops and page state all remain owned by the existing main-window runtime. */
export function BrowserMonitor() {
  const [frame, setFrame] = useState<BrowserFrame>();
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const scopeRevision = useRef(0);
  useEffect(() => {
    let cancelled = false, failures = 0, revision = 0;
    let stop: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({listen}) => listen("browser-monitor://scope", () => {
      revision++; scopeRevision.current++; setFrame(undefined); setStale(false); setError(""); setChanging(false);
    })).then(unlisten => { if(cancelled) unlisten(); else stop = unlisten; }).catch(() => {});
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 800;
      try {
        const epoch = revision;
        const value = await browserNative<unknown>("browser_monitor_frame");
        if (cancelled) return;
        if (epoch !== revision) { timer = setTimeout(() => void poll(), 100); return; }
        if (value !== null) {
          const next = parseFrame(value);
          setFrame(next); setStale(false); failures = 0;
          delay = next.busy ? 250 : 500;
        } else {
          setStale(true); // Hidden window: never label retained pixels as current.
        }
      } catch {
        if (cancelled) return;
        setStale(true); failures++;
        delay = Math.min(4000, 500 * 2 ** failures);
      }
      if (!cancelled) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); stop?.(); };
  }, []);

  async function present(action: "restore" | "hide") {
    if (changing) return;
    const epoch = scopeRevision.current;
    setChanging(true);
    try { await browserNative("browser_monitor", { action }); if (epoch === scopeRevision.current) setError(""); }
    catch { if (epoch === scopeRevision.current) setError("Не удалось вернуть или скрыть окно. Повторите действие."); }
    finally { if (epoch === scopeRevision.current) setChanging(false); }
  }
  const hasImage = !!frame?.browserOpen && !!frame.image;
  const ratio = (frame?.width || 1280) / (frame?.height || 800);
  const cursor = frame?.cursor;
  return <section className="browser-monitor" aria-label="Наблюдение за браузером">
    <header data-tauri-drag-region="deep">
      <Icon name="browser" size={16}/>
      <span className="browser-monitor-title" title={frame?.title || "Браузер"}>{frame?.title || "Браузер"}</span>
      <button className="icon-btn" aria-label="Вернуть браузер в приложение" title="Вернуть в приложение для ручной работы" disabled={changing} onClick={() => void present("restore")}><Icon name="expand" size={16}/></button>
      <button className="icon-btn" aria-label="Скрыть окно наблюдения" title="Скрыть окно — браузер продолжит работать" disabled={changing} onClick={() => void present("hide")}><Icon name="close" size={16}/></button>
    </header>
    <div className="browser-monitor-viewport" aria-label="Страница только для наблюдения">
      {hasImage ? <div className={`browser-monitor-frame${stale ? " stale" : ""}`} style={{width:`min(100%, ${208 * ratio}px)`,aspectRatio:String(ratio)}}>
        <img src={`data:image/jpeg;base64,${frame.image}`} alt={frame.title || "Живая страница браузера"} draggable={false}/>
        {cursor && <div className={`browser-agent-cursor ${cursor.owner}`} aria-label={cursor.owner === "agent" ? "Курсор агента" : "Курсор пользователя"} style={{left:`${cursor.x / frame.width! * 100}%`,top:`${cursor.y / frame.height! * 100}%`}}><span>➤</span></div>}
      </div> : <p>{frame?.browserOpen === false ? "Браузер закрыт" : "Жду страницу браузера…"}</p>}
    </div>
    <footer>
      <span className={`browser-status-dot${frame?.busy ? " busy" : ""}`}/>
      <span role={stale || error ? "alert" : "status"}>{error || (stale ? "Нет свежего кадра" : frame?.busy ? "Агент работает…" : "Только наблюдение")}</span>
      <span title="Для кликов и прокрутки верните браузер в приложение"><Icon name="lock" size={12}/></span>
    </footer>
  </section>;
}
