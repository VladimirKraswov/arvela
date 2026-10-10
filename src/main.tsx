import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserMonitor } from "./components/BrowserMonitor";
import { store, applyTheme } from "./state/store";
import { startAgentControl } from "./control/bridge";
import "./styles.css";

const observingBrowser = new URLSearchParams(window.location.search).get("view") === "browser-monitor";

// Debug handle for development only (not included in production bundles).
if (import.meta.env.DEV && !observingBrowser) {
  (window as unknown as Record<string, unknown>).__ocStore = store;
}

// Native agents use the private control plane, never simulated pointer input.
if (!observingBrowser) void startAgentControl();
else { document.documentElement.classList.add("browser-monitor-document"); applyTheme(store.state.prefs.theme); }

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {observingBrowser ? <BrowserMonitor /> : <App />}
  </React.StrictMode>,
);
