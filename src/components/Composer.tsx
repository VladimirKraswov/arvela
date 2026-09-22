import { HostPicker } from "./WorkspacePicker";
import { ContextMeter } from "./ContextMeter";
import { VoiceInput } from "./VoiceInput";
import { accessOptions, type AccessMode } from "../state/access";
import { Icon } from "./Icon";
import { SelectMenu } from "./SelectMenu";
import { useEffect, useMemo, useRef } from "react";
import { store, useAppState } from "../state/store";

export function Composer() {
  const s = useAppState();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draft = store.getDraft();
  const choice = store.getModelChoice();
  const providers = store.connectedProvidersWithModels();
  const session = s.sessions.find((x) => x.id === s.activeSessionId) ?? null;
  const status = session
    ? (s.chat.sessions[session.id]?.status ?? s.statuses[session.id])
    : s.ui.sending
      ? { type: "busy" as const }
      : { type: "idle" as const };
  const running = status?.type === "busy" || status?.type === "retry";
  const connected = s.connection.phase === "connected";

  const modelList = useMemo(() => {
    const out: { providerID: string; modelID: string; label: string }[] = [];
    for (const p of providers) {
      for (const m of Object.values(p.models)) {
        if (m.status === "deprecated") continue;
        out.push({
          providerID: p.id,
          modelID: m.id,
          label: `${m.name ?? m.id}`,
        });
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
    if (running) {
      store.enqueuePrompt(text);
      return;
    }
    // The store owns the draft lifecycle: on accept it removes exactly the submitted
    // revision; on failure the draft was never touched — nothing to lose or silently resend.
    void store.sendPrompt(text);
  };

  return (
    <div className="composer-wrap">
      {!connected && (
        <div className="offline-banner" role="alert">
          <span>Disconnected from OpenCode. Drafts and history are kept.</span>
          <button onClick={() => void store.retryConnection()}>
            Reconnect
          </button>
        </div>
      )}
      {connected && s.connection.streamState === "reconnecting" && (
        <div
          className="offline-banner"
          style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
          role="status"
        >
          Reconnecting to live updates…
        </div>
      )}
      {s.ui.sendError && (
        <div className="composer-error" role="alert">
          {s.ui.sendError}
        </div>
      )}
      {store.getQueue().length > 0 && (
        <div className="prompt-queue" aria-label="Очередь запросов">
          <div className="queue-heading">
            <b>В очереди · {store.getQueue().length}</b>
            <span>
              {store.isQueueArmed()
                ? "После текущего ответа"
                : "Приостановлена"}
            </span>
            {!store.isQueueArmed() && (
              <button onClick={() => store.resumeQueue()}>
                Продолжить очередь
              </button>
            )}
          </div>
          {store.getQueue().map((item) => (
            <div className="queued-prompt" key={item.id}>
              <p>{item.text}</p>
              <div className="queue-actions">
                {item.state === "ready" ? (
                  <>
                    <button
                      disabled={!connected || s.ui.sending}
                      title="Передать уточнение на следующий шаг агента без остановки инструмента"
                      onClick={() => void store.steerQueued(item.id)}
                    >
                      Скорректировать сейчас
                    </button>
                    <button
                      disabled={!!draft.trim()}
                      onClick={() => store.editQueued(item.id)}
                    >
                      Изменить
                    </button>
                  </>
                ) : (
                  <span>
                    {item.state === "sending"
                      ? "Отправляется…"
                      : "Отправка не подтверждена. Проверьте историю перед повтором."}
                  </span>
                )}
                <button
                  disabled={item.state === "sending"}
                  aria-label="Убрать из очереди"
                  onClick={() => store.removeQueued(item.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {s.ui.workspacePreparing && (
        <div className="workspace-progress" role="status">
          Подготовка рабочего места чата…
        </div>
      )}
      <div className="composer">
        <textarea
          ref={textareaRef}
          aria-label="Message"
          placeholder={
            store.isProjectless()
              ? "Спросите что угодно или поручите задачу…"
              : "Спросите о коде или поручите задачу…"
          }
          value={draft}
          disabled={s.ui.workspacePreparing}
          onChange={(e) => store.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-bar">
          <SelectMenu
            label="Модель"
            disabled={!connected}
            value={choice ? `${choice.providerID}/${choice.modelID}` : ""}
            options={modelList.map((m) => ({
              value: `${m.providerID}/${m.modelID}`,
              label: m.label,
              detail: m.providerID,
            }))}
            onChange={(value) => {
              const [providerID, ...rest] = value.split("/");
              const modelID = rest.join("/");
              const variants = store.modelInfo(providerID, modelID)?.variants;
              store.setModelChoice(
                providerID,
                modelID,
                choice?.variant && variants?.[choice.variant]
                  ? choice.variant
                  : variants?.medium
                    ? "medium"
                    : null,
              );
            }}
          />
          {variantOptions.length > 0 && (
            <SelectMenu
              label="Усилие рассуждения"
              value={choice?.variant ?? ""}
              options={[
                { value: "", label: "По умолчанию" },
                ...variantOptions.map((v) => ({
                  value: v,
                  label: v.charAt(0).toUpperCase() + v.slice(1),
                })),
              ]}
              onChange={(v) =>
                choice &&
                store.setModelChoice(
                  choice.providerID,
                  choice.modelID,
                  v || null,
                )
              }
            />
          )}
          <SelectMenu
            label="Агент"
            value={store.getAgentChoice() ?? ""}
            options={store
              .primaryAgentNames()
              .map((name) => ({ value: name, label: name }))}
            onChange={(name) =>
              store.setAgentOverride(s.directory ?? "*", name)
            }
          />
          <span className="spacer" />
          <VoiceInput disabled={!connected || s.ui.workspacePreparing} />
          {running && session && (
            <button
              className="btn small danger"
              onClick={() => void store.stopSession(session.id)}
              aria-label="Stop generation"
            >
              <Icon name="stop" size={15} />
            </button>
          )}
          <button
            className="send-btn"
            aria-label={running ? "Добавить в очередь" : "Send prompt"}
            disabled={
              !connected ||
              !draft.trim() ||
              s.ui.sending ||
              s.ui.workspacePreparing ||
              s.ui.runtimeLoading
            }
            onClick={send}
          >
            <Icon name={running ? "plus" : "arrow"} size={19} />
          </button>
        </div>
      </div>
      <div className="composer-footer">
        {!s.activeSessionId ? (
          <HostPicker />
        ) : (
          <span
            title={`Инструменты выполняются: ${store.hostLabel()} · ${s.directory}`}
          >
            <Icon name={store.currentHost() ? "server" : "monitor"} size={13} />
            {store.hostLabel()}
          </span>
        )}
        <span
          className="workspace-caption"
          title={
            s.directory ??
            "Для нового чата будет создана отдельная рабочая папка"
          }
        >
          <Icon name={store.isProjectless() ? "chat" : "folder"} size={13} />
          {store.isProjectless()
            ? "Без проекта"
            : s.directory?.split("/").filter(Boolean).pop()}
        </span>
        <SelectMenu
          label="Режим доступа"
          disabled={running || s.ui.sending || !connected}
          value={store.getAccessMode()}
          options={[
            ...accessOptions,
            ...(store.getAccessMode() === "custom"
              ? [
                  {
                    value: "custom",
                    label: "Свои разрешения",
                    detail: "Правила этой сессии OpenCode",
                  },
                ]
              : []),
          ]}
          onChange={(mode) =>
            mode !== "custom" && void store.setAccessMode(mode as AccessMode)
          }
        />
        <ContextMeter />
        <span className="spacer" />
        <span>
          Enter ↵{" "}
          <span className="optional-hint">· Shift+Enter новая строка</span>
        </span>
      </div>
    </div>
  );
}
