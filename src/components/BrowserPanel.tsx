import { useEffect, useRef, useState } from "react";
import { browserNative } from "../browser/integration";
import { browserEnabled } from "../browser/preferences";
import { browserPoint, parseFrame, type BrowserFrame } from "../browser/view";
import { isNative } from "../native/platform";
import { isLocalComputer } from "../state/computer";
import { store, useAppState } from "../state/store";

/** Auto-reveal once when an agent opens Chromium. Closing the panel only hides
 * the projection: it does not interrupt the browser or the agent's task. */
export function BrowserPresence() {
  const app = useAppState();
  const local = isNative() && isLocalComputer(app.prefs.endpoint, !!store.currentHost()) && browserEnabled(app.prefs);
  useEffect(() => {
    if (!local) return;
    let cancelled = false, wasOpen = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await browserNative<{ browserOpen: boolean }>("browser_presence");
        if (!cancelled) {
          if (s.browserOpen && !wasOpen) store.setUi({ browserOpen: true });
          wasOpen = !!s.browserOpen;
        }
      } catch { /* The panel's explicit connection action reports failures. */ }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [local, app.prefs.endpoint, app.prefs.browser?.nodeProgram]);
  return null;
}

export function BrowserPanel() {
  const app = useAppState();
  const [frame, setFrame] = useState<BrowserFrame>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [frameError, setFrameError] = useState("");
  const [working, setWorking] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const flight = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  const generation = useRef(0);
  const local = isNative() && isLocalComputer(app.prefs.endpoint, !!store.currentHost()) && browserEnabled(app.prefs);
  useEffect(() => {
    const epoch = ++generation.current;
    alive.current = local;
    setFrame(undefined);
    if (!local) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = parseFrame(await browserNative<unknown>("browser_view"));
        if (!cancelled) { setFrame(next); setFrameError(""); }
      } catch { if (!cancelled) setFrameError("Нет свежего кадра. Проверьте подключение браузера."); }
      if (!cancelled) timer = setTimeout(() => void poll(), 250);
    };
    void poll();
    return () => { cancelled = true; alive.current = false; if (generation.current === epoch) generation.current++; clearTimeout(timer); };
  }, [local, app.prefs.endpoint]);
  useEffect(() => { setAddress(frame?.url || ""); }, [frame?.url]);
  function input(action: string, args: Record<string, unknown> = {}) {
    if (!local || frame?.busy) return;
    if (["click", "wheel", "text", "key"].includes(action) && (!frame?.image || frameError)) return;
    const epoch = generation.current;
    const expected = frame?.pageId ? { pageId: frame.pageId, revision: frame.revision, url: frame.url } : undefined;
    // User actions share the daemon's tool queue. Never replay a failed action.
    flight.current = flight.current.catch(() => {}).then(async () => {
      if (!alive.current || epoch !== generation.current || !browserEnabled(store.state.prefs) || !isLocalComputer(store.state.prefs.endpoint, !!store.currentHost())) return;
      setWorking(true);
      try { await browserNative("browser_input", { action, args: { ...args, ...(expected ? { expected } : {}) } }); if (alive.current) setError(""); }
      catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (alive.current) setWorking(false); }
    });
  }
  const latestInput = useRef(input);
  latestInput.current = input;
  useEffect(() => {
    const node = screen.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      latestInput.current("wheel", { dy: Math.max(-2000, Math.min(2000, event.deltaY)) });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [local]);
  const cursor = frame?.cursor;
  return <section className="browser-panel" aria-label="Встроенный браузер">
    <header className="browser-panel-heading"><strong>Браузер</strong><span role="status">{frame?.busy ? "Агент действует…" : working ? "Выполняю…" : "Живая страница · Chromium"}</span><button className="icon-btn" aria-label="Закрыть панель браузера" onClick={() => store.setUi({ browserOpen: false })}>×</button></header>
    {!local ? <p role="status">Браузер доступен только на этом компьютере, когда управление включено.</p> : <>
      <div className="browser-tabs" role="tablist" aria-label="Вкладки браузера">{frame?.tabs.map(tab => <div className="browser-tab" key={tab.index}>
        <button role="tab" aria-selected={tab.active} disabled={frame.busy} onClick={() => input("select", { index: tab.index })}>{tab.title || "Новая вкладка"}</button>
        <button aria-label={`Закрыть вкладку ${tab.title || tab.index + 1}`} disabled={frame.busy} onClick={() => input("close", { index: tab.index })}>×</button>
      </div>)}<button className="icon-btn" aria-label="Новая вкладка браузера" disabled={frame?.busy} onClick={() => input("new")}>+</button></div>
      <form className="browser-address" onSubmit={e => { e.preventDefault(); input("navigate", { url: address }); }}>
        <button type="button" aria-label="Назад в браузере" disabled={frame?.busy} onClick={() => input("back")}>←</button>
        <button type="button" aria-label="Вперёд в браузере" disabled={frame?.busy} onClick={() => input("forward")}>→</button>
        <button type="button" aria-label="Обновить страницу" disabled={frame?.busy} onClick={() => input("reload")}>↻</button>
        <input aria-label="Адрес браузера" value={address} placeholder="https://…" onChange={e => setAddress(e.target.value)} spellCheck={false}/>
        <button disabled={frame?.busy}>Перейти</button>
      </form>
      {(error || frameError) && <p className="browser-error" role="alert">{error || frameError}</p>}
      <div className="browser-scroll"><div ref={screen} className={`browser-screen${frameError ? " stale" : ""}`} tabIndex={0} role="application" aria-label="Страница браузера: клик, ввод и прокрутка" style={{ aspectRatio: `${frame?.width || 1280}/${frame?.height || 800}` }}
        onClick={e => { e.currentTarget.focus(); if (image.current && frame) { const p = browserPoint(e.clientX, e.clientY, image.current.getBoundingClientRect(), frame); if (p) input("click", p); } }}
        onPaste={e => { e.preventDefault(); input("text", { text: e.clipboardData.getData("text/plain") }); }}
        onKeyDown={e => {
          if (e.ctrlKey || e.metaKey) { if (e.key.toLowerCase() === "a") { e.preventDefault(); input("key", { key: "ControlOrMeta+a" }); } return; }
          if (e.key.length === 1 && !e.altKey) { e.preventDefault(); input("text", { text: e.key }); }
          else if (["Enter","Tab","Backspace","Delete","Escape","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key)) { e.preventDefault(); input("key", { key: e.key }); }
        }}>
        {frame?.image ? <img ref={image} src={`data:image/jpeg;base64,${frame.image}`} alt={frame.title || "Страница Chromium"} draggable={false}/> : <p>Откройте браузер кнопкой в верхней панели или задайте адрес страницы.</p>}
        {cursor && frame?.width && frame?.height && <div className={`browser-agent-cursor ${cursor.owner}`} style={{ left: `${cursor.x / frame.width * 100}%`, top: `${cursor.y / frame.height * 100}%` }} aria-label={cursor.owner === "agent" ? "Курсор агента" : "Курсор пользователя"}><span>➤</span><small>{cursor.owner === "agent" ? "Агент" : "Вы"}</small></div>}
      </div></div>
      <footer>Это тот же Chromium, которым управляет агент. Закрытие панели не останавливает задачу.</footer>
    </>}
  </section>;
}
