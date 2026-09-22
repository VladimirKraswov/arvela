// SSE over fetch: supports abort, bounded reconnect/backoff and generation guards.
// EventSource cannot carry per-connection state or be cleanly aborted across
// project switches, so we parse the SSE wire format from a fetch stream.

import type { ServerEvent } from "./types";

export interface EventStreamOptions {
  url: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onEvent: (event: ServerEvent) => void;
  onState: (
    state: "connecting" | "open" | "reconnecting" | "closed" | "error",
    detail?: string,
  ) => void;
  maxBackoffMs?: number;
}

export async function runEventStream(opts: EventStreamOptions): Promise<void> {
  const maxBackoff = opts.maxBackoffMs ?? 15000;
  let attempt = 0;
  while (!opts.signal.aborted) {
    opts.onState(attempt === 0 ? "connecting" : "reconnecting");
    try {
      const res = await fetch(opts.url, {
        headers: { ...opts.headers, Accept: "text/event-stream" },
        signal: opts.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        throw new Error(`event stream HTTP ${res.status}`);
      }
      opts.onState("open");
      attempt = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 4_000_000) buffer = buffer.slice(-1_000_000); // bounded retention
        let match: RegExpExecArray | null;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const chunk = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          const dataLines = chunk
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""));
          if (dataLines.length === 0) continue;
          const data = dataLines.join("\n");
          if (!data) continue;
          try {
            const parsed = JSON.parse(data) as ServerEvent;
            if (parsed && typeof parsed.type === "string") opts.onEvent(parsed);
          } catch {
            // Malformed frame: ignore, resync on next frame.
          }
        }
      }
      if (!opts.signal.aborted) opts.onState("reconnecting", "stream ended");
    } catch (e) {
      if (opts.signal.aborted) break;
      opts.onState("error", (e as Error)?.message);
    }
    if (opts.signal.aborted) break;
    attempt += 1;
    const delay =
      Math.min(1000 * 2 ** Math.min(attempt, 6), maxBackoff) *
      (0.75 + Math.random() * 0.5);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        opts.signal.removeEventListener("abort", done);
        resolve();
      };
      const t = setTimeout(done, delay);
      opts.signal.addEventListener("abort", done, { once: true });
    });
  }
  opts.onState("closed");
}

export function eventStreamUrl(
  baseUrl: string,
  directory: string | null,
): string {
  const url = new URL(baseUrl + "/event");
  if (directory) url.searchParams.set("directory", directory);
  return url.toString();
}
