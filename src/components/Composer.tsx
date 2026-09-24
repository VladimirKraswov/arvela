import { HostPicker } from "./WorkspacePicker";
import { ContextMeter } from "./ContextMeter";
import { VoiceInput } from "./VoiceInput";
import { accessOptions, type AccessMode } from "../state/access";
import { Icon } from "./Icon";
import { SelectMenu } from "./SelectMenu";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { store, useAppState } from "../state/store";
import { attachmentDrafts, attachmentScope, type DraftAttachment } from "../attachments/drafts";
import { LARGE_PASTE_THRESHOLD, pastedTextFile } from "../attachments/prepare";

function AttachmentChip({ file, onRemove, disabled }: { file: DraftAttachment; onRemove: () => void; disabled: boolean }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime)) return;
    const url = URL.createObjectURL(file.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="attachment-chip">
    {preview ? <img src={preview} alt=""/> : <Icon name="file" size={18}/>}
    <span title={file.name}>{file.name}</span><small>{file.size < 1024 * 1024 ? `${Math.max(1, Math.ceil(file.size / 1024))} КБ` : `${(file.size / 1024 / 1024).toFixed(1)} МБ`}</small>
    <button type="button" disabled={disabled} aria-label={`Убрать ${file.name}`} onClick={onRemove}><Icon name="close" size={14}/></button>
  </div>;
}

export function Composer() {
  const s = useAppState();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const scope = attachmentScope(s.prefs.workspaceKey ?? s.prefs.endpoint, s.directory, s.activeSessionId);
  const attachments = useSyncExternalStore(attachmentDrafts.subscribe, () => attachmentDrafts.snapshot(scope));
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

  useEffect(() => { void attachmentDrafts.ensure(scope).catch(error => setAttachmentError(String(error))); }, [scope]);
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    if (s.ui.sending) { setAttachmentError("Дождитесь подтверждения текущего запроса, затем добавьте файлы."); return; }
    setAttachmentError("");
    void attachmentDrafts.add(scope, files).catch(error => setAttachmentError(error instanceof Error ? error.message : String(error)));
  };
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault(); setDragging(true);
    };
    const drop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false); };
    window.addEventListener("dragover", over); window.addEventListener("drop", drop); window.addEventListener("dragleave", leave);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); window.removeEventListener("dragleave", leave); };
  });

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
    if ((!text.trim() && !attachments.length) || s.ui.sending || !connected) return;
    if (running) {
      if (attachments.length) { setAttachmentError("Вложения можно отправить после завершения текущего ответа. Они сохранены в черновике."); return; }
      store.enqueuePrompt(text);
      return;
    }
    // The store owns the draft lifecycle: on accept it removes exactly the submitted
    // revision; on failure the draft was never touched — nothing to lose or silently resend.
    setAttachmentError("");
    void store.sendPrompt(text, attachments, setAttachmentProgress);
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
      {attachmentError && <div className="composer-error" role="alert">{attachmentError}</div>}
      {attachmentProgress && <div className="workspace-progress" role="status">{attachmentProgress}</div>}
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
      <div className={`composer ${dragging ? "composer-drop-target" : ""}`}>
        {dragging && <div className="composer-drop-label">Перетащите файлы сюда</div>}
        {attachments.length > 0 && <div className="attachment-list" aria-label="Вложения">{attachments.map(file => <AttachmentChip key={file.id} file={file} disabled={s.ui.sending} onRemove={() => void attachmentDrafts.remove(scope, [file.id])}/>)}</div>}
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
          onPaste={event => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length) files.push(...Array.from(event.clipboardData.items).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => !!file));
            if (files.length) { event.preventDefault(); addFiles(files); return; }
            const value = event.clipboardData.getData("text/plain");
            if (value.length >= LARGE_PASTE_THRESHOLD) { event.preventDefault(); addFiles([pastedTextFile(value)]); }
          }}
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
          <div className="composer-controls-left">
            <button className="composer-plus" aria-label="Открыть команды" title="Команды и действия" onClick={() => store.setUi({paletteOpen: true})}>
              <Icon name="plus" size={19} />
            </button>
            <input ref={fileInputRef} type="file" multiple hidden disabled={s.ui.sending} aria-label="Выбрать файлы" onChange={event => { addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}/>
            <button className="composer-plus" type="button" disabled={s.ui.sending} aria-label="Приложить файлы" title="Приложить файлы" onClick={() => fileInputRef.current?.click()}><Icon name="file" size={18}/></button>
            <SelectMenu
              label="Режим доступа"
              disabled={running || s.ui.sending || !connected}
              value={store.getAccessMode()}
              options={[
                ...accessOptions,
                ...(store.getAccessMode() === "custom" ? [{value: "custom", label: "Свои разрешения", detail: "Правила этой сессии OpenCode"}] : []),
              ]}
              onChange={(mode) => mode !== "custom" && void store.setAccessMode(mode as AccessMode)}
            />
          </div>
          <div className="composer-controls-right">
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
                variants?.medium ? "medium" : null,
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
          <VoiceInput disabled={!connected || s.ui.workspacePreparing} />
          {running && session && (
            <button
              className="stop-btn"
              onClick={() => void store.stopSession(session.id)}
              aria-label="Stop generation"
              title="Остановить ответ"
            >
              <Icon name="stop" size={14} />
            </button>
          )}
          {(!running || !!draft.trim() || attachments.length > 0) && <button
            className="send-btn"
            aria-label={running ? "Добавить в очередь" : "Send prompt"}
            disabled={
              !connected ||
              (!draft.trim() && !attachments.length) ||
              s.ui.sending ||
              s.ui.workspacePreparing ||
              s.ui.runtimeLoading
            }
            onClick={send}
          >
            <Icon name={running ? "plus" : "arrow"} size={19} />
          </button>}
          </div>
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
