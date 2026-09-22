import { HostDialogs } from "./components/HostDialogs";
import { store, useAppState, applyTheme } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { RightPanel } from "./components/RightPanel";
import {
  ConnectionGate,
  DeleteConfirm,
  SettingsDialog,
  Toast,
} from "./components/Dialogs";
import { TerminalPanel } from "./components/TerminalPanel";
import { Palette } from "./components/Palette";
import { useEffect } from "react";

/** Pointer-drag horizontal splitter: initial width follows movementX, clamped. */
function startResize(opts: {
  initial: number;
  min: number;
  max: number;
  direction?: number;
  apply: (px: number) => void;
}) {
  let current = opts.initial;
  const move = (e: PointerEvent) => {
    current = Math.min(
      opts.max,
      Math.max(opts.min, current + e.movementX * (opts.direction ?? 1)),
    );
    opts.apply(current);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export default function App() {
  const s = useAppState();

  useEffect(() => {
    // Sequential startup: connect() only touches projects after health succeeded.
    // connect() is idempotent, so a StrictMode double-invoke shares one attempt.
    applyTheme(store.state.prefs.theme);
    void store.connect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        store.setUi({ paletteOpen: !store.state.ui.paletteOpen });
      } else if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        void store.newSession();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        store.setLayout({ rightOpen: !store.state.prefs.layout.rightOpen });
      } else if (e.key === "`" && (e.ctrlKey || (mod && e.shiftKey))) {
        e.preventDefault();
        void store.toggleTerminal();
      } else if (e.key === "Escape") {
        if (store.state.ui.paletteOpen) store.setUi({ paletteOpen: false });
        if (store.state.ui.hostDialogOpen || store.state.ui.remoteFolderOpen) return;
        if (store.state.ui.settingsOpen) store.setUi({ settingsOpen: false });
        if (store.state.ui.confirmDelete) store.setUi({ confirmDelete: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const layout = s.prefs.layout;

  return (
    <div
      className={`app-shell${"__TAURI_INTERNALS__" in window ? " native" : ""}${s.activeSessionId ? "" : " new-task"}${layout.sidebarOpen ? "" : " sidebar-hidden"}`}
    >
      <div className="app-body">
        {layout.sidebarOpen && <Sidebar />}
        <div
          className="resizer-v"
          style={{ display: layout.sidebarOpen ? undefined : "none" }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            startResize({
              initial: layout.sidebarWidth,
              min: 180,
              max: 420,
              apply: (px) => store.setLayout({ sidebarWidth: px }),
            });
          }}
        />
        <div className="center-col">
          <TopBar />
          <div className="center-main">
            <div className="chat-col">
              {s.connection.phase === "connected" ||
              s.connection.phase === "connecting" ? (
                <>
                  <ChatView />
                  <Composer />
                </>
              ) : (
                <ConnectionGate />
              )}
            </div>
            {layout.rightOpen && (
              <>
                <div
                  className="resizer-v"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize review panel"
                  onPointerDown={(e) => {
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    startResize({
                      initial: layout.rightWidth,
                      min: 240,
                      max: 720,
                      direction: -1,
                      apply: (px) =>
                        store.setLayout({
                          rightWidth: px,
                        }),
                    });
                  }}
                />
                <RightPanel />
              </>
            )}
          </div>
          {layout.bottomOpen && (
            <>
              <div
                className="resizer-h"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize terminal panel"
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  const initial = layout.bottomHeight;
                  let current = initial;
                  const move = (ev: PointerEvent) => {
                    current = Math.min(
                      600,
                      Math.max(90, current - ev.movementY),
                    );
                    store.setLayout({ bottomHeight: current });
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              />
              <div
                className="bottom-panel"
                style={{ height: layout.bottomHeight }}
              >
                <TerminalPanel />
              </div>
            </>
          )}
        </div>
      </div>
      {s.ui.paletteOpen && <Palette />}
      <SettingsDialog />
      <HostDialogs />
      <DeleteConfirm />
      <Toast />
    </div>
  );
}
