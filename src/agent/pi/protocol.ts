// Wire types for Pi's RPC mode, transcribed from the installed distribution's
// `docs/rpc.md` (verified against @earendil-works/pi-coding-agent 0.85.1).
//
// Only the parts this app actually consumes are typed. Everything is treated as
// additive: an unknown event or content block must be ignored, never fatal.

export interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

export interface PiTextContent {
  type: "text";
  text: string;
}
export interface PiThinkingContent {
  type: "thinking";
  thinking: string;
}
export interface PiToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments?: unknown;
}
export interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
export type PiContent =
  | PiTextContent
  | PiThinkingContent
  | PiToolCallContent
  | PiImageContent
  | { type: string; [key: string]: unknown };

export interface PiUserMessage {
  role: "user";
  content: string | PiContent[];
  timestamp?: number;
}
export interface PiAssistantMessage {
  role: "assistant";
  content: PiContent[];
  provider?: string;
  model?: string;
  usage?: PiUsage;
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
  timestamp?: number;
}
export interface PiToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: PiContent[];
  isError?: boolean;
  timestamp?: number;
}
export interface PiBashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  timestamp?: number;
}
export type PiMessage =
  | PiUserMessage
  | PiAssistantMessage
  | PiToolResultMessage
  | PiBashExecutionMessage
  | { role: string; [key: string]: unknown };

/** One line of the append-only session file; `id` is a durable cursor. */
export interface PiEntry {
  type: string;
  id: string;
  parentId?: string | null;
  timestamp?: string;
  message?: PiMessage;
  [key: string]: unknown;
}

export type PiAssistantDelta =
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content?: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; content?: string }
  | {
      type: "toolcall_start";
      contentIndex: number;
      id: string;
      toolName: string;
    }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | {
      type: "toolcall_end";
      contentIndex: number;
      toolCall: PiToolCallContent;
    }
  | { type: string; contentIndex?: number; [key: string]: unknown };

export interface PiEvent {
  type: string;
  message?: PiMessage;
  messages?: PiMessage[];
  assistantMessageEvent?: PiAssistantDelta;
  usage?: PiUsage;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: { content?: PiContent[]; details?: unknown };
  partialResult?: { content?: PiContent[] };
  isError?: boolean;
  willRetry?: boolean;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
  success?: boolean;
  reason?: string;
  steering?: string[];
  followUp?: string[];
  [key: string]: unknown;
}

/** Dialog methods block the agent until answered; the rest are informational. */
export const PI_DIALOG_METHODS = ["select", "confirm", "input", "editor"] as const;
export type PiDialogMethod = (typeof PI_DIALOG_METHODS)[number];

export interface PiUiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  timeout?: number;
}

export function isDialogMethod(method: string): method is PiDialogMethod {
  return (PI_DIALOG_METHODS as readonly string[]).includes(method);
}

export interface PiModel {
  id: string;
  name?: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number };
}

export interface PiCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | string;
  location?: string;
  path?: string;
}

export interface PiState {
  model?: PiModel | null;
  thinkingLevel?: string;
  isStreaming?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
}

/** Envelope pushed from the native side for every line Pi writes. */
export interface PiEnvelope {
  key: string;
  directory: string;
  sessionId: string;
  payload: PiEvent | PiUiRequest;
}
