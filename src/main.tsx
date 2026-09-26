import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { store } from "./state/store";
import { startAgentControl } from "./control/bridge";
import "./styles.css";

// Debug handle for development only (not included in production bundles).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ocStore = store;
}

// Native agents use the private control plane, never simulated pointer input.
void startAgentControl();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
