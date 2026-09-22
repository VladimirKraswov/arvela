import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { store } from "./state/store";
import "./styles.css";

// Debug handle for development only (not included in production bundles).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ocStore = store;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
