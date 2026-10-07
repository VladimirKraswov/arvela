import { modelServices } from "../models/services";
import { compactModelName } from "../models/display";
import { ModelSwitchStatus } from "./ModelSwitchStatus";
import { HostPicker } from "./WorkspacePicker";
import { ContextMeter } from "./ContextMeter";
import { VoiceInput } from "./VoiceInput";
import { accessOptions, type AccessMode } from "../state/access";
import { Icon } from "./Icon";
import { engineOptions } from "../state/engines";
import { PI_BACKEND_ID } from "../agent/pi/backend";
import { SelectMenu } from "./SelectMenu";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { store, useAppState } from "../state/store";
import { attachmentDrafts, attachmentScope, type DraftAttachment } from "../attachments/drafts";
import { LARGE_PASTE_THRESHOLD, pastedTextFile } from "../attachments/prepare";
import { filesFromNativeDrop } from "../attachments/native-drop";
import { pathBasename } from "../util/paths";
import { openFileInput, registerComposer } from "../attachments/composerBridge";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFile, stat } from "@tauri-apps/plugin-fs";

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
  const switches = useSyncExternalStore(modelServices.subscribe, modelServices.snapshot);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentProgress, setAttachmentProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const scope = attachmentScope(s.prefs.workspaceKey ?? s.prefs.endpoint, s.directory, s.activeSessionId);
  const attachments = useSyncExternalStore(attachmentDrafts.subscribe, () => attachmentDrafts.snapshot(scope));
  const draft = store.getDraft();
  const choice = store.getModelChoice();
  const switchState = choice ? modelServices.statusFor(choice.providerID, choice.modelID) : undefined;
  const switchError = choice ? modelServices.errorFor(choice.providerID, choice.modelID) : undefined;
  const switching = !!switchState && !switchState.ready && switchState.phase !== "failed" && switchState.phase !== "unloaded";
  const providers = store.connectedProvidersWithModels();
  const session = store.activeSession() ?? null;
  const status = session
    ? (s.chat.sessions[session.id]?.status ?? s.statuses[session.id])
    : s.ui.sending
      ? { type: "busy" as const }
      : { type: "idle" as const };
  const running = status?.type === "busy" || status?.type === "retry";
  // The engine that will run the prompt decides readiness, not OpenCode alone.
  const connected = store.engineReady();

  useEffect(() => { void attachmentDrafts.ensure(scope).catch(error => setAttachmentError(String(error))); }, [scope]);
  // Files from a chooser belong to the chat it was opened for, even if the user
  // switched chats while the native dialog was open.
  const chooserScope = useRef<string | null>(null);
  const addFiles = (files: File[], target = scope) => {
    if (!files.length) return;
    if (s.ui.sending) { setAttachmentError("Дождитесь подтверждения текущего запроса, затем добавьте файлы."); return; }
    setAttachmentError("");
    void attachmentDrafts.add(target, files).catch(error => setAttachmentError(error instanceof Error ? error.message : String(error)));
  };
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const openChooser = () => {
    if (store.state.ui.sending) return false;
    chooserScope.current = scopeRef.current;
    return openFileInput(fileInputRef.current);
  };
  useEffect(() => registerComposer({
    scope: () => scopeRef.current,
    openFiles: openChooser,
    focus: () => textareaRef.current?.focus(),
  }), []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === "enter" || event.payload.type === "over") { setDragging(true); return; }
      setDragging(false);
      if (event.payload.type !== "drop") return;
      void filesFromNativeDrop(event.payload.paths, stat, readFile)
        .then(files => { if (!disposed) addFilesRef.current(files); })
        .catch(error => { if (!disposed) setAttachmentError(error instanceof Error ? error.message : String(error)); });
    }).then(stop => { if (disposed) stop(); else unlisten = stop; })
      .catch(error => { if (!disposed) setAttachmentError(`Не удалось включить перетаскивание файлов: ${String(error)}`); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault(); setDragging(true);
    };
    const drop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault(); setDragging(false); addFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false); };
    window.addEventListener("dragover", over); window.addEventListener("drop", drop); window.addEventListener("dragleave", leave);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); window.removeEventListener("dragleave", leave); };
  }, []);

  const engineId = store.engineIdFor();
  const engines = engineOptions(s.prefs, store.piInstalled);
  const isPi = engineId === PI_BACKEND_ID;

  const modelList = useMemo(() => {
    const out: {
      providerID: string;
      modelID: string;
      label: string;
      detail?: string;
    }[] = [];
    if (isPi) {
      // Pi keeps its own catalog; OpenCode providers must not leak into it.
      // Only models which answered a real request are selectable here.
      for (const m of store.piModelOptions().filter(m => modelServices.allowed(m.providerID, m.modelID, engineId)))
        out.push({
          providerID: m.providerID,
          modelID: m.modelID,
          label: compactModelName(m.label),
          detail: `${m.label} · ${m.providerID} · проверена`,
        });
      return out;
    }
    for (const p of providers) {
      for (const m of Object.values(p.models)) {
        if (m.status === "deprecated" || !modelServices.allowed(p.id, m.id, engineId)) continue;
        out.push({
          providerID: p.id,
          modelID: m.id,
          label: compactModelName(m.name ?? m.id),
          detail: `${m.name ?? m.id} · ${p.id}`,
        });
      }
    }
    return out;
  }, [providers, isPi, s.piHealth, s.prefs.pi?.verifiedModels, s.prefs.pi?.verifiedModel, switches.revision]);

  const variantOptions = store.effortOptions();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight + 8, 240)}px`;
  }, [draft]);

  const send = () => {
    const text = store.getDraft();
    // s.ui.sending also blocks a second Enter while the first request awaits acknowledgement.
    if ((!text.trim() && !attachments.length) || s.ui.sending || switching || !connected) return;
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
          <span>{isPi
            ? "Pi не найден. Проверьте путь к Pi в настройках; черновики и история сохранены."
            : "Нет связи с OpenCode. Черновики и история сохранены."}</span>
          <button onClick={() => void (isPi ? store.refreshPiInstall() : store.retryConnection())}>
            Проверить снова
          </button>
        </div>
      )}
      {connected && !isPi && s.connection.streamState === "reconnecting" && (
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
      {switchState && <ModelSwitchStatus state={switchState}
        modelName={modelList.find(m => m.modelID === (switchState.target_model ?? switchState.active_model))?.label
          ?? compactModelName(switchState.target_model ?? switchState.active_model ?? "Модель")}/>}
      {switchError && <div className="composer-error" role="alert">{switchError}</div>}
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
                      disabled={!connected || switching || s.ui.sending}
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
      <div className={`composer ${dragging ? "composer-drop-target" : ""} ${voiceActive ? "composer-voice-active" : ""}`}>
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
            <input ref={fileInputRef} type="file" multiple hidden disabled={s.ui.sending} aria-label="Выбрать файлы" onChange={event => {
              addFiles(Array.from(event.currentTarget.files ?? []), chooserScope.current ?? scope);
              chooserScope.current = null; event.currentTarget.value = "";
            }}/>
            <button className="composer-plus" type="button" disabled={s.ui.sending} aria-label="Приложить файлы" title="Приложить файлы" onClick={openChooser}><Icon name="file" size={18}/></button>
            {isPi ? (
              // OpenCode's permission rules do not govern Pi. Pi chats get their
              // own approval policy instead of a control that would lie.
              <SelectMenu
                label="Доступ Pi"
                disabled={running || s.ui.sending}
                value={s.prefs.pi?.toolPolicy === "full" ? "full" : "ask"}
                options={[
                  { value: "ask", label: "Спрашивать", detail: "Подтверждение на запись, правку и команды" },
                  { value: "full", label: "Полный доступ", detail: "Pi выполняет инструменты без запроса" },
                ]}
                onChange={(value) => store.setPiSettings({ toolPolicy: value === "full" ? "full" : "ask" })}
              />
            ) : (
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
            )}
          </div>
          <div className="composer-controls-right">
          <SelectMenu
            label="Агент"
            className="composer-engine-picker"
            disabled={!connected || running || switching || s.ui.sending}
            value={engineId}
            options={engines.map((e) => ({
              value: e.id,
              label: e.label,
              detail: e.available ? undefined : e.reason,
              disabled: !e.available,
            }))}
            onChange={(id) => store.setSessionEngine(s.activeSessionId, id)}
          />
          <SelectMenu
            label="Модель"
            className="composer-model-picker"
            disabled={!connected || running || s.ui.sending || switching || (isPi && modelList.length === 0)}
            value={isPi && modelList.length === 0
              ? "Проверьте модель в настройках Pi"
              : choice ? `${choice.providerID}/${choice.modelID}` : ""}
            options={modelList.map((m) => ({
              value: `${m.providerID}/${m.modelID}`,
              label: m.label,
              detail: m.detail ?? m.providerID,
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
              className="composer-effort-picker"
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
          {!isPi && <SelectMenu
            label="Профиль OpenCode"
            className="composer-agent-picker"
            value={store.getAgentChoice() ?? ""}
            options={store
              .primaryAgentNames()
              .map((name) => ({ value: name, label: name }))}
            onChange={(name) =>
              store.setAgentOverride(s.directory ?? "*", name)
            }
          />}
          </div>
          <div className="composer-actions">
          <VoiceInput disabled={!connected || s.ui.workspacePreparing} onActiveChange={setVoiceActive} />
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
              switching ||
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
            : s.directory ? pathBasename(s.directory) : undefined}
        </span>
        <ContextMeter />
        {s.activeSessionId && <button className="browser-task-toggle" aria-label="Браузерная задача" aria-pressed={store.browserTaskActive()} disabled={running || s.ui.sending}
          title="Отдельный профиль: меньше рассуждений для обычных действий; усилие можно изменить вручную. Разрешения агента сохраняются."
          onClick={() => store.setBrowserTask(!store.browserTaskActive())}><Icon name="browser" size={13}/>{store.browserTaskActive() ? "Браузер · профиль" : "Браузерная задача"}</button>}

        <span className="spacer" />
        <span className="composer-keyboard-hint">
          Enter ↵{" "}
          <span className="optional-hint">· Shift+Enter новая строка</span>
        </span>
      </div>
    </div>
  );
}
