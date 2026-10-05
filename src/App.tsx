import { ContextPanel } from "./components/ContextPanel";
import { ScheduleRuntime } from "./schedules/Runtime";
import { HandoffDialog } from "./components/HandoffDialog";
import { BrowserPanel, BrowserPresence } from "./components/BrowserPanel";
import { PiDialog } from "./components/PiDialog";
import { EngineSwitchDialog } from "./components/EngineSwitchDialog";
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
  Toast,
} from "./components/Dialogs";
import { TerminalPanel } from "./components/TerminalPanel";
import { Palette } from "./components/Palette";
import { SettingsScreen } from "./components/SettingsScreen";
import { useEffect } from "react";
import { hasOverlayWindowControls, isNative, platform } from "./native/platform";

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
    // Detect Pi and hydrate its no-session model catalog for a restored chat.
    void store.refreshPiInstall();
  }, []);

  useEffect(() => {
    const markRead = () => store.markReadIfViewing();
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === ",") {
        e.preventDefault();
        store.setUi({ settingsOpen: true, paletteOpen: false });
        return;
      }
      if (store.state.ui.settingsOpen) return;
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
        if (store.state.ui.contextOpen) store.setUi({ contextOpen: false });
        if (store.state.ui.paletteOpen) store.setUi({ paletteOpen: false });
        if (store.state.ui.hostDialogOpen || store.state.ui.remoteFolderOpen) return;
        if (store.state.ui.confirmDelete) store.setUi({ confirmDelete: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const layout = s.prefs.layout;
  // The review panel and the terminal are OpenCode-specific surfaces: they reach
  // the transport directly through `store.client`. Mount them only when the
  // active agent backend actually provides them, so the escape hatch can never
  // be hit during render.
  const capabilities = store.backend.capabilities;

  return (
    <div
      className={`app-shell platform-${platform()}${isNative() ? " native" : ""}${hasOverlayWindowControls() ? " mac-chrome" : ""}${s.activeSessionId ? "" : " new-task"}${layout.sidebarOpen ? "" : " sidebar-hidden"}`}
    >
      <div className="app-body" inert={s.ui.settingsOpen} aria-hidden={s.ui.settingsOpen || undefined} style={s.ui.settingsOpen ? { visibility: "hidden" } : undefined}>
        {layout.sidebarOpen && <Sidebar />}
        <BrowserPresence />
        <ScheduleRuntime />
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
            {s.ui.contextOpen && <ContextPanel />}
            <div className="chat-col">
              {s.connection.phase === "connected" ||
              s.connection.phase === "connecting" ||
              // A Pi chat runs locally: an unreachable OpenCode server must not
              // replace it with a connection error it has nothing to do with.
              store.engineReady() ? (
                <>
                  <ChatView />
                  <Composer />
                </>
              ) : (
                <ConnectionGate />
              )}
            </div>
            {s.ui.browserOpen && <BrowserPanel />}
            {!s.ui.browserOpen && layout.rightOpen && capabilities.vcsDiff && (
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
          {layout.bottomOpen && capabilities.pty && (
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
      {s.ui.settingsOpen && <SettingsScreen />}
      <HostDialogs />
      {capabilities.fork && <HandoffDialog />}
      <PiDialog />
      <EngineSwitchDialog />
      <DeleteConfirm />
      <Toast />
    </div>
  );
}
