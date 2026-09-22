import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantMessage,
  MessagePart,
  PermissionRequest,
  QuestionRequest,
  Session,
  UserMessage,
} from "../api/types";
import { renderMarkdown, safeExternalUrl } from "../util/markdown";
import { useAppState } from "../state/store";

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      const safe = safeExternalUrl(href);
      if (safe)
        void import("@tauri-apps/plugin-opener")
          .then(({ openUrl }) => openUrl(safe))
          .catch(() => window.open(safe, "_blank", "noopener"));
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);
  return (
    <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function Fold({
  label,
  children,
  tone,
  right,
  defaultOpen = false,
  spinner,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  tone?: "reasoning" | "tool";
  right?: React.ReactNode;
  defaultOpen?: boolean;
  spinner?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`fold${open ? " open" : ""}${tone ? ` ${tone}` : ""}`}>
      <button
        className="fold-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tw">▶</span>
        <span
          style={{
            flex: "0 1 auto",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {spinner && <span className="tool-spinner" aria-label="Running" />}
        {right}
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}

function truncate(s: string, n = 6000): string {
  return s.length > n ? `${s.slice(0, n)}\n… truncated (${s.length} chars)` : s;
}

export const ToolPartView = memo(function ToolPartView({
  part,
}: {
  part: MessagePart;
}) {
  const st = part.state ?? { status: "pending" as const };
  const running = st.status === "running" || st.status === "pending";
  const dur =
    st.time?.start && st.time?.end
      ? `${(((st.time.end as number) - (st.time.start as number)) / 1000).toFixed(1)}s`
      : null;
  const label = (
    <>
      <span className="tool-name">{part.tool ?? "tool"}</span>
      {st.title ? <span> {st.title}</span> : null}
      {st.status === "error" && (
        <span className="tool-state-error"> — failed</span>
      )}
      {running && <span className="tool-state-run"> — running</span>}
    </>
  );
  const input =
    st.input === undefined
      ? ""
      : typeof st.input === "string"
        ? st.input
        : JSON.stringify(st.input, null, 2);
  return (
    <Fold
      label={label}
      tone="tool"
      spinner={running}
      right={dur ? <span className="tool-duration">{dur}</span> : undefined}
      defaultOpen={st.status === "error"}
    >
      {input && (
        <>
          <div style={{ color: "var(--text-faint)", marginBottom: 3 }}>
            input
          </div>
          <pre>{truncate(input)}</pre>
        </>
      )}
      {st.output ? (
        <>
          <div style={{ color: "var(--text-faint)", margin: "6px 0 3px" }}>
            result
          </div>
          <pre>{truncate(st.output)}</pre>
        </>
      ) : null}
      {st.error ? (
        <>
          <div style={{ color: "var(--err)", margin: "6px 0 3px" }}>error</div>
          <pre style={{ color: "var(--err)" }}>
            {truncate(String(st.error))}
          </pre>
        </>
      ) : null}
    </Fold>
  );
});

export function PartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case "text":
      if (part.ignored || part.synthetic) return null;
      return part.text ? <Markdown source={part.text} /> : null;
    case "reasoning":
      return part.text ? (
        <Fold label="Thinking" tone="reasoning">
          <div style={{ whiteSpace: "pre-wrap", color: "var(--text-dim)" }}>
            {part.text}
          </div>
        </Fold>
      ) : null;
    case "tool":
      return <ToolPartView part={part} />;
    case "step-finish":
      return null;
    case "patch":
      return (
        <Fold label={<span>patch applied</span>}>
          File changes recorded in the session diff.
        </Fold>
      );
    case "retry":
      return (
        <div className="msg-meta finish-note">
          Retrying…{" "}
          {String((part.metadata as { message?: string })?.message ?? "")}
        </div>
      );
    case "compaction":
      return <div className="msg-meta">Context compaction marker</div>;
    default:
      return null;
  }
}

function messageParts(
  s: ReturnType<typeof useAppState>,
  sessionId: string,
  messageId: string,
): MessagePart[] {
  const slot = s.chat.sessions[sessionId];
  if (!slot) return [];
  return (slot.partsByMessage[messageId] ?? [])
    .map((p) => slot.parts[p])
    .filter(Boolean);
}

export const AssistantMessageView = memo(function AssistantMessageView({
  sessionId,
  message,
}: {
  sessionId: string;
  message: AssistantMessage;
}) {
  const s = useAppState();
  const parts = messageParts(s, sessionId, message.id);
  const running = !message.time.completed;
  const errText = message.error ? describeError(message.error) : null;
  const finishBad =
    message.finish &&
    !["stop", "end_turn", "stop_sequence", "tool-calls", "tool_calls"].includes(
      message.finish,
    );
  return (
    <div className="msg-assistant">
      {parts.map((p) => (
        <PartView key={p.id} part={p} />
      ))}
      {running && parts.length === 0 && (
        <div className="status-line">
          <span className="tool-spinner" /> Working…
        </div>
      )}
      {errText && (
        <div className="msg-error" role="alert">
          {errText}
        </div>
      )}
      {(finishBad || message.finish === "length") && (
        <div className="msg-meta finish-note" role="status">
          {message.finish === "length"
            ? "Stopped: output budget exhausted for this step. You can ask to continue."
            : `Finished with status: ${message.finish}`}
        </div>
      )}
      {message.time.completed && (
        <div className="msg-meta">
          {message.modelID && (
            <span>
              {message.modelID}
              {message.variant ? ` · ${message.variant}` : ""}
            </span>
          )}
          {typeof message.tokens?.output === "number" &&
            message.tokens.output > 0 && (
              <span>{message.tokens.output} out tokens</span>
            )}
        </div>
      )}
    </div>
  );
});

function describeError(error: unknown): string {
  const e = error as { name?: string; data?: { message?: string } };
  if (e?.name === "MessageAbortedError") return "Response was aborted.";
  if (e?.name === "MessageOutputLengthError")
    return "Output budget exhausted for this step.";
  if (e?.data?.message) return String(e.data.message);
  return "The assistant message failed.";
}

export function UserMessageView({ message }: { message: UserMessage }) {
  const s = useAppState();
  const parts = messageParts(s, message.sessionID, message.id).filter(
    (p) => p.type === "text" && !p.synthetic && !p.ignored,
  );
  const text = parts
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
  if (!text) return null;
  return <div className="msg-user">{text}</div>;
}

export function PermissionCard({
  req,
  onReply,
}: {
  req: PermissionRequest;
  onReply: (r: "once" | "always" | "reject") => void;
}) {
  return (
    <div
      className="action-card"
      role="alertdialog"
      aria-label="Permission request"
    >
      <div className="caption">Permission requested</div>
      <div className="body">
        The agent is asking to use <b>{req.permission}</b>
        {req.tool?.callID ? " as part of a tool call" : ""}.
      </div>
      {req.patterns && req.patterns.length > 0 && (
        <div className="patterns">{req.patterns.join("\n")}</div>
      )}
      {req.metadata && Object.keys(req.metadata).length > 0 && (
        <div className="patterns">
          {truncate(JSON.stringify(req.metadata, null, 2), 1500)}
        </div>
      )}
      <div className="btn-row">
        <button className="btn small danger" onClick={() => onReply("reject")}>
          Reject
        </button>
        <button
          className="btn small"
          onClick={() => onReply("always")}
          title="Allow this permission for the rest of the session"
        >
          Always allow
        </button>
        <button className="btn small primary" onClick={() => onReply("once")}>
          Allow once
        </button>
      </div>
    </div>
  );
}

export function QuestionCard({
  req,
  onReply,
  onReject,
}: {
  req: QuestionRequest;
  onReply: (answers: string[][]) => void;
  onReject: () => void;
}) {
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const allAnswered = req.questions.every(
    (_, i) => (picks[i]?.length ?? 0) > 0 || custom[i]?.trim(),
  );
  const submit = () => {
    const answers = req.questions.map((_, i) => {
      const chosen = picks[i] ?? [];
      const c = custom[i]?.trim();
      return c ? [...chosen, c] : chosen;
    });
    onReply(answers);
  };
  return (
    <div
      className="action-card"
      role="group"
      aria-label="Question from the agent"
    >
      <div className="caption">The agent is asking</div>
      {req.questions.map((q, qi) => (
        <div
          key={qi}
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          <div className="question-text">{q.question}</div>
          {(q.options ?? []).map((opt) => (
            <label className="opt-row" key={opt.label}>
              <input
                type={q.multiple ? "checkbox" : "radio"}
                name={`${req.id}-${qi}`}
                checked={(picks[qi] ?? []).includes(opt.label)}
                onChange={() =>
                  setPicks((prev) => {
                    const cur = prev[qi] ?? [];
                    if (!q.multiple) setCustom((old) => ({ ...old, [qi]: "" }));
                    const next = q.multiple
                      ? cur.includes(opt.label)
                        ? cur.filter((x) => x !== opt.label)
                        : [...cur, opt.label]
                      : [opt.label];
                    return { ...prev, [qi]: next };
                  })
                }
              />
              <span>
                <span className="opt-label">{opt.label}</span>
                {opt.description && (
                  <span className="opt-desc"> — {opt.description}</span>
                )}
              </span>
            </label>
          ))}
          {(q.custom ?? true) && (
            <input
              className="search-box"
              placeholder="Type your own answer…"
              aria-label="Custom answer"
              value={custom[qi] ?? ""}
              onChange={(e) => {
                setCustom((prev) => ({ ...prev, [qi]: e.target.value }));
                if (!q.multiple) setPicks((prev) => ({ ...prev, [qi]: [] }));
              }}
            />
          )}
        </div>
      ))}
      <div className="btn-row">
        <button className="btn small danger" onClick={onReject}>
          Dismiss
        </button>
        <button
          className="btn small primary"
          disabled={!allAnswered}
          onClick={submit}
        >
          Send answer
        </button>
      </div>
    </div>
  );
}

export function sessionStatusLine(
  s: ReturnType<typeof useAppState>,
  session: Session | null,
): string | null {
  if (!session) return null;
  const st = s.chat.sessions[session.id]?.status ?? s.statuses[session.id];
  if (!st) return null;
  switch (st.type) {
    case "busy":
      return "Running…";
    case "retry":
      return `Retrying (attempt ${st.attempt ?? 1})${st.message ? `: ${st.message}` : ""}`;
    case "waiting":
      return "Waiting for input";
    default:
      return null;
  }
}
