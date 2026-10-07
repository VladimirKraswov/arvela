import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { store, useAppState, errText } from "../state/store";
import type { OpenCodeClient } from "../api/client";
import type { PtyInfo } from "../api/types";

type Status = "idle" | "connecting" | "open" | "closed" | "error";

// Development-only observability for the WS/PTY wire protocol (stripped from prod builds).
interface TermDebug {
  framesIn: number;
  bytesIn: number;
  textFrames: number;
  headerFrames: number;
  cursor: number;
  bytesSent: number;
  wsState: string;
  ptyId: string;
  errors: string[];
  term?: Terminal;
}
const termDebug: TermDebug | null = import.meta.env.DEV
  ? {
      framesIn: 0,
      bytesIn: 0,
      textFrames: 0,
      headerFrames: 0,
      cursor: -1,
      bytesSent: 0,
      wsState: "",
      ptyId: "",
      errors: [],
    }
  : null;
if (import.meta.env.DEV)
  (window as unknown as Record<string, unknown>).__ocTermDebug = termDebug;

/** macOS resolves /tmp and similar symlinks; compare real paths. */
function samePath(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const norm = (p: string) =>
    p.replace(/^\/private(?=\/)/, "").replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** Reads current theme colors so the terminal matches light/dark UI. */
function terminalTheme() {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--panel").trim() || "#1e1e1e";
  const fg = cs.getPropertyValue("--text").trim() || "#d4d4d4";
  return { background: bg, foreground: fg, cursorCellBackground: fg };
}

export function TerminalPanel() {
  const s = useAppState();
  const client: OpenCodeClient = store.client;
  const dir = s.directory;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ptyRef = useRef<PtyInfo | null>(null);
  const genRef = useRef(0);
  const resizeTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("Terminal");

  const pushSize = () => {
    const term = termRef.current;
    const pty = ptyRef.current;
    if (!term || !pty || !dir) return;
    if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
    resizeTimer.current = window.setTimeout(() => {
      void client
        .ptyUpdate(pty.id, dir, { size: { rows: term.rows, cols: term.cols } })
        .catch(() => undefined);
    }, 150);
  };

  const detachSocket = () => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (resizeTimer.current) {
      window.clearTimeout(resizeTimer.current);
      resizeTimer.current = null;
    }
    if (ws) {
      ws.onclose = null;
      ws.onopen = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState < 2) ws.close();
    }
  };

  const attach = async (pty: PtyInfo, gen: number) => {
    ptyRef.current = pty;
    setTitle(pty.title || "Terminal");
    const term = termRef.current;
    if (!term || !dir) return;
    setStatus("connecting");
    setError(null);
    const { token } = await client.ptyConnectToken(pty.id, dir);
    if (gen !== genRef.current) return;
    let opened = false;
    const ws = new WebSocket(
      client.ptySocketUrl(pty.id, dir, token || undefined),
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    if (termDebug) {
      termDebug.framesIn = 0;
      termDebug.bytesIn = 0;
      termDebug.headerFrames = 0;
      termDebug.textFrames = 0;
      termDebug.cursor = -1;
      termDebug.bytesSent = 0;
      termDebug.errors = [];
      termDebug.ptyId = pty.id;
      termDebug.term = term;
    }
    ws.onopen = () => {
      if (termDebug) termDebug.wsState = "open";
      if (gen !== genRef.current) return void ws.close();
      opened = true;
      setStatus("open");
      term.focus();
      // PTY only starts rendering once its size is set (verified against 1.18.18):
      void client
        .ptyUpdate(pty.id, dir, { size: { rows: term.rows, cols: term.cols } })
        .catch((e) => termDebug?.errors.push(`ptyUpdate: ${errText(e)}`));
    };
    ws.onmessage = (ev) => {
      if (gen !== genRef.current) return;
      // Wire protocol verified against OpenCode 1.18.18 (isolated WS probe, 2026-09-22):
      // PTY stdout arrives as WebSocket TEXT frames; binary frames starting with 0x00 carry
      // JSON control messages ({"cursor":N}). Writing every other byte sequence verbatim
      // keeps future frame types visible instead of silently dropping output.
      if (typeof ev.data === "string") {
        if (termDebug) {
          termDebug.framesIn += 1;
          termDebug.bytesIn += ev.data.length;
          termDebug.textFrames += 1;
        }
        term.write(ev.data);
        return;
      }
      const b = new Uint8Array(ev.data as ArrayBuffer);
      if (termDebug) {
        termDebug.framesIn += 1;
        termDebug.bytesIn += b.byteLength;
      }
      if (b.length === 0) return;
      if (b[0] === 0) {
        try {
          const parsed = JSON.parse(
            new TextDecoder().decode(b.subarray(1)),
          ) as { cursor?: unknown };
          if (parsed && typeof parsed.cursor === "number") {
            if (termDebug) {
              termDebug.headerFrames += 1;
              termDebug.cursor = parsed.cursor;
            }
            return;
          }
        } catch {
          /* not a control frame — render raw */
        }
      }
      term.write(b);
    };
    ws.onerror = () => {
      if (termDebug) termDebug.errors.push("ws error");
      if (gen === genRef.current) setStatus("error");
    };
    ws.onclose = () => {
      if (gen !== genRef.current) return;
      wsRef.current = null;
      if (!opened) {
        // HTTP ticket validation succeeded, but the stream itself failed.
        setStatus("error");
        setError(
          "The OpenCode server refused the terminal connection: the WebSocket stream did not open.",
        );
        return;
      }
      setStatus((prev) => (prev === "error" ? "error" : "closed"));
    };
  };

  const start = async (createNew: boolean) => {
    const gen = ++genRef.current;
    detachSocket();
    setError(null);
    if (!dir) {
      setStatus("error");
      setError("Начните чат или откройте терминал снова для подготовки рабочей папки.");
      return;
    }
    const term = termRef.current;
    if (!term) return;
    setStatus("connecting");
    try {
      fitRef.current?.fit();
      term.reset();
      let pty: PtyInfo | null = null;
      // Ownership rule: only reuse a shell this app created for this project — never hijack
      // a foreign PTY that happens to exist on the server (R6).
      const ownedId = store.state.prefs.ptyIds[dir];
      if (!createNew && ownedId) {
        try {
          const info = await client.ptyGet(ownedId, dir);
          if (info.status === "running" && samePath(info.cwd, dir)) pty = info;
          else store.setPtyId(dir, null);
        } catch {
          store.setPtyId(dir, null); // recorded shell no longer exists
        }
        if (gen !== genRef.current) return;
      }
      if (!pty) {
        pty = await client.ptyCreate(
          { cwd: dir, title: "Arvela" },
          dir,
        );
        if (gen !== genRef.current) {
          await client.ptyKill(pty.id, dir);
          return;
        }
        store.setPtyId(dir, pty.id);
      }
      await attach(pty, gen);
    } catch (e) {
      if (gen !== genRef.current) return;
      setStatus("error");
      setError(errText(e));
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new Terminal({
      convertEol: false,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      fontSize: 12.5,
      theme: terminalTheme(),
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const bytes = new TextEncoder().encode(data);
        ws.send(bytes);
        if (termDebug) termDebug.bytesSent += bytes.byteLength;
      } else {
        term.write(
          "\r\n\x1b[31m[terminal detached — press Reconnect]\x1b[0m\r\n",
        );
      }
    });
    term.onResize(pushSize);
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* container hidden */
      }
    });
    ro.observe(el);
    void start(false);
    return () => {
      genRef.current++;
      ro.disconnect();
      detachSocket();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      ptyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, client]);

  // keep terminal colors in sync with theme switches
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // applyTheme runs in the store; wait one frame so CSS variables are updated
    const t = setTimeout(() => {
      term.options.theme = terminalTheme();
    }, 0);
    return () => clearTimeout(t);
  }, [s.prefs.theme]);

  const kill = async () => {
    const pty = ptyRef.current;
    if (!pty || !dir) return;
    genRef.current++;
    detachSocket();
    const gen = genRef.current;
    try {
      await client.ptyKill(pty.id, dir);
      if (gen !== genRef.current || client !== store.client) return;
      store.setPtyId(dir, null);
      ptyRef.current = null;
      setStatus("closed");
      termRef.current?.write("\r\n[terminal closed]\r\n");
    } catch (e) {
      store.setUi({ toast: `Could not close terminal: ${errText(e)}` });
    }
  };

  return (
    <div className="term-wrap">
      <div className="term-toolbar">
        <span className="term-title" title={dir ?? ""}>
          {title}
        </span>
        <span
          className={`status-dot ${status === "open" ? "ok" : status === "connecting" ? "warn" : status === "idle" ? "" : "bad"}`}
          aria-label={`Terminal ${status}`}
        />
        <span className="term-status">
          {status === "open"
            ? "connected"
            : status === "connecting"
              ? "connecting…"
              : status === "closed"
                ? "disconnected"
                : status === "error"
                  ? "error"
                  : "idle"}
        </span>
        <span style={{ flex: 1 }} />
        {status !== "open" && (
          <button
            className="btn small"
            onClick={() => void start(false)}
            aria-label="Reconnect terminal"
          >
            Reconnect
          </button>
        )}

        <button
          className="btn small ghost"
          onClick={() => void kill()}
          aria-label="Close terminal shell"
          title="Kill this shell (terminates the process)"
        >
          Kill
        </button>
        <button
          className="btn small ghost"
          onClick={() => store.setLayout({ bottomOpen: false })}
          aria-label="Hide terminal panel"
        >
          ✕
        </button>
      </div>
      {status === "error" && error && (
        <div className="panel-note" role="alert">
          {error}
        </div>
      )}
      <div ref={containerRef} className="term-host" />
    </div>
  );
}
