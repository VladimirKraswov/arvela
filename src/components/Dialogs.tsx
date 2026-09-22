import { useState } from "react";
import { store, useAppState } from "../state/store";
import { DEFAULT_BASE_URL } from "../api/client";

export function SettingsDialog() {
  const s = useAppState();
  const [endpoint, setEndpoint] = useState(s.prefs.endpoint);
  if (!s.ui.settingsOpen) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && store.setUi({ settingsOpen: false })}>
      <div className="modal" role="dialog" aria-label="Settings">
        <h3>Settings</h3>
        <label>
          OpenCode server endpoint (loopback only)
          <input
            value={endpoint}
            spellCheck={false}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
          />
        </label>
        <div className="row">
          <span>Theme</span>
          <select value={s.prefs.theme} onChange={(e) => store.setTheme(e.target.value as "light" | "dark" | "system")} aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="kv"><span>Engine version</span><b>{s.connection.version ?? "—"}</b></div>
        <div className="kv"><span>Shell version</span><b>0.1.0</b></div>
        <div className="kv"><span>Connection</span><b>{s.connection.phase}</b></div>
        <div className="kv"><span>Event stream</span><b>{s.connection.streamState}</b></div>
        <div className="kv"><span>Connected providers</span><b>{s.connectedProviderIds.length || "—"}</b></div>
        <div className="kv"><span>Agents</span><b>{s.agents.map((a) => a.name).join(", ") || "—"}</b></div>
        <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
          <button className="btn" onClick={() => store.setUi({ settingsOpen: false })}>Close</button>
          <button
            className="btn primary"
            onClick={() => {
              store.setUi({ settingsOpen: false });
              void store.connect(endpoint);
            }}
          >
            Apply &amp; reconnect
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirm() {
  const s = useAppState();
  const sess = s.ui.confirmDelete;
  if (!sess) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && store.setUi({ confirmDelete: null })}>
      <div className="modal" role="alertdialog" aria-label="Delete session">
        <h3>Delete session permanently?</h3>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
          “{sess.title}” and its full history will be removed from OpenCode. This cannot be undone.
          If you only want to hide it, use <b>Archive</b> instead.
        </p>
        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => store.setUi({ confirmDelete: null })}>Cancel</button>
          <button className="btn danger" onClick={() => void store.deleteSession(sess)}>Delete permanently</button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const s = useAppState();
  if (!s.ui.toast) return null;
  return (
    <div className="toast" role="status" onMouseDown={() => store.setUi({ toast: null })}>
      {s.ui.toast}
    </div>
  );
}

export function ConnectionGate() {
  const s = useAppState();
  const [endpoint, setEndpoint] = useState(s.prefs.endpoint);
  if (s.connection.phase === "connected") return null;
  return (
    <div className="gate" role="alert" aria-live="polite">
      <h2>
        {s.connection.phase === "connecting" ? "Connecting to OpenCode…" : s.connection.phase === "incompatible" ? "Version compatibility warning" : "Cannot reach OpenCode server"}
      </h2>
      <p>
        {s.connection.phase === "connecting"
          ? "Looking for the local OpenCode service."
          : s.connection.phase === "incompatible"
            ? s.connection.error ?? "The installed OpenCode version is outside the tested range."
            : (
              <>OpenCode Desktop talks to an already running <code>opencode serve</code> on loopback. Start it separately
              (for example <code>opencode serve --port 4096</code>), then retry. This app never kills or replaces an externally managed server.</>
            )}
      </p>
      {s.connection.error && s.connection.phase === "disconnected" && <p style={{ color: "var(--err)" }}>{s.connection.error}</p>}
      <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: 5 }}>
        Endpoint
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} spellCheck={false} />
      </label>
      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => void store.connect(endpoint)} disabled={s.connection.phase === "connecting"}>
          {s.connection.phase === "connecting" ? "Retrying…" : "Retry connection"}
        </button>
      </div>
    </div>
  );
}
