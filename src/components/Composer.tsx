import { useEffect, useMemo, useRef } from "react";
import { store, useAppState } from "../state/store";

export function Composer() {
  const s = useAppState();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draft = store.getDraft();
  const choice = store.getModelChoice();
  const providers = store.connectedProvidersWithModels();
  const session = s.sessions.find((x) => x.id === s.activeSessionId) ?? null;
  const status = session ? (s.chat.sessions[session.id]?.status ?? s.statuses[session.id]) : s.ui.sending ? { type: "busy" as const } : { type: "idle" as const };
  const running = status?.type === "busy" || status?.type === "retry";
  const connected = s.connection.phase === "connected";

  const modelList = useMemo(() => {
    const out: { providerID: string; modelID: string; label: string }[] = [];
    for (const p of providers) {
      for (const m of Object.values(p.models)) {
        if (m.status === "deprecated") continue;
        out.push({ providerID: p.id, modelID: m.id, label: `${m.name ?? m.id}` });
      }
    }
    return out;
  }, [providers]);

  const variantOptions = useMemo(() => {
    if (!choice) return [];
    const model = store.modelInfo(choice.providerID, choice.modelID);
    const variants = model?.variants ? Object.keys(model.variants) : [];
    return variants;
  }, [choice, s.rev]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight + 8, 240)}px`;
  }, [draft]);

  const send = () => {
    const text = store.getDraft();
    // s.ui.sending also blocks a second Enter while the first request awaits acknowledgement.
    if (!text.trim() || s.ui.sending || !connected) return;
    // The store owns the draft lifecycle: on accept it removes exactly the submitted
    // revision; on failure the draft was never touched — nothing to lose or silently resend.
    void store.sendPrompt(text);
  };

  return (
    <div className="composer-wrap">
      {!connected && (
        <div className="offline-banner" role="alert">
          <span>Disconnected from OpenCode. Drafts and history are kept.</span>
          <button onClick={() => void store.retryConnection()}>Reconnect</button>
        </div>
      )}
      {connected && s.connection.streamState === "reconnecting" && (
        <div className="offline-banner" style={{ borderColor: "var(--warn)", color: "var(--warn)" }} role="status">
          Reconnecting to live updates…
        </div>
      )}
      {s.ui.sendError && <div className="composer-error" role="alert">{s.ui.sendError}</div>}
      <div className="composer">
        <textarea
          ref={textareaRef}
          aria-label="Message"
          placeholder={s.directory ? "Describe a task… (Enter to send, Shift+Enter for newline)" : "Select a project first"}
          value={draft}
          disabled={!s.directory}
          onChange={(e) => store.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-bar">
          <select
            aria-label="Model"
            disabled={!connected || modelList.length === 0}
            value={choice ? `${choice.providerID}/${choice.modelID}` : ""}
            onChange={(e) => {
              const [providerID, ...rest] = e.target.value.split("/");
              const modelID = rest.join("/");
              // Keep the effort variant only if the newly selected model actually supports it.
              const info = store.modelInfo(providerID, modelID);
              const keep = choice?.variant && info?.variants && choice.variant in info.variants ? choice.variant : null;
              store.setModelChoice(providerID, modelID, keep);
            }}
          >
            {modelList.length === 0 && <option value="">no models</option>}
            {choice && !modelList.some((m) => m.providerID === choice.providerID && m.modelID === choice.modelID) && (
              <option value={`${choice.providerID}/${choice.modelID}`}>{choice.modelID}</option>
            )}
            {modelList.map((m) => (
              <option key={`${m.providerID}/${m.modelID}`} value={`${m.providerID}/${m.modelID}`}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Agent"
            disabled={s.agents.filter((a) => a.mode !== "subagent").length === 0}
            value={store.getAgentChoice() ?? ""}
            onChange={(e) => {
              // Agent choice is applied on session creation and next prompt.
              const name = e.target.value;
              const dir = s.directory ?? "*";
              store.setAgentOverride(dir, name);
            }}
          >
            {store.primaryAgentNames().map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {variantOptions.length > 0 && (
            <select
              aria-label="Reasoning effort"
              value={choice?.variant ?? ""}
              onChange={(e) => choice && store.setModelChoice(choice.providerID, choice.modelID, e.target.value || null)}
            >
              <option value="">default effort</option>
              {variantOptions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          )}
          <span className="spacer" />
          {running && session && (
            <button className="btn small danger" onClick={() => void store.stopSession(session.id)} aria-label="Stop generation">
              ■ Stop
            </button>
          )}
          <button
            className="send-btn"
            aria-label="Send prompt"
            disabled={!connected || !draft.trim() || s.ui.sending}
            onClick={send}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
