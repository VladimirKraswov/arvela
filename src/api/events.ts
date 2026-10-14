// SSE over fetch: supports abort, bounded reconnect/backoff and generation guards.
// EventSource cannot carry per-connection state or be cleanly aborted across
// project switches, so we parse the SSE wire format from a fetch stream.

import { SseDecoder } from "./sse";
import type { ServerEvent } from "./types";

export interface GlobalEvent {
  directory?: string;
  payload: ServerEvent;
}

export interface EventStreamOptions<T = ServerEvent> {
  url: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onEvent: (event: T) => void;
  onState: (
    state: "connecting" | "open" | "reconnecting" | "closed" | "error",
    detail?: string,
  ) => void;
  maxBackoffMs?: number;
}

export async function runEventStream<T = ServerEvent>(opts: EventStreamOptions<T>): Promise<void> {
  const maxBackoff = opts.maxBackoffMs ?? 15000;
  let attempt = 0;
  try {
    while (!opts.signal.aborted) {
      opts.onState(attempt === 0 ? "connecting" : "reconnecting");
      let openedAt: number | undefined;
      try {
        const res = await fetch(opts.url, {
          headers: { ...opts.headers, Accept: "text/event-stream" },
          signal: opts.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          await res.body?.cancel();
          throw new Error(`event stream HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const cancel = () => { void reader.cancel().catch(() => {}); };
        opts.signal.addEventListener("abort", cancel, { once: true });
        try {
          if (opts.signal.aborted) { cancel(); break; }
          openedAt = Date.now();
          opts.onState("open");
          const decoder = new TextDecoder();
          const frames = new SseDecoder();
          while (!opts.signal.aborted) {
            const { done, value } = await reader.read();
            if (done || opts.signal.aborted) break;
            frames.push(decoder.decode(value, { stream: true }), data => {
              if (opts.signal.aborted) return false;
              let parsed: ServerEvent | GlobalEvent;
              try { parsed = JSON.parse(data); }
              // A lost status/part cannot be safely skipped. Reconnect lets the
              // store reconcile history without leaking the payload into logs.
              catch { throw new Error('Invalid event stream JSON'); }
              if (parsed && (typeof (parsed as ServerEvent).type === "string" ||
                  typeof (parsed as GlobalEvent).payload?.type === "string"))
                opts.onEvent(parsed as T);
              return !opts.signal.aborted;
            });
          }
        } finally {
          opts.signal.removeEventListener("abort", cancel);
          // EOF, cancellation, parser failure and subscriber failure all release
          // the transport. No unread body keeps an obsolete subscription alive.
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (!opts.signal.aborted) opts.onState("reconnecting", "stream ended");
      } catch (error) {
        if (opts.signal.aborted) break;
        opts.onState("error", error instanceof Error ? error.message : "Event stream failed");
      }
      if (opts.signal.aborted) break;
      // Merely getting HTTP headers is not a healthy stream. Immediate EOFs must
      // back off too, otherwise a broken endpoint is hammered indefinitely.
      if (openedAt !== undefined && Date.now() - openedAt >= 10000) attempt = 0;
      attempt += 1;
      const delay = Math.min(maxBackoff,
        1000 * 2 ** Math.min(attempt, 6) * (0.75 + Math.random() * 0.5));
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          opts.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        opts.signal.addEventListener("abort", done, { once: true });
        if (opts.signal.aborted) done();
      });
    }
  } finally { opts.onState("closed"); }
}

export function eventStreamUrl(
  baseUrl: string,
  directory: string | null,
): string {
  const url = new URL(baseUrl + "/event");
  if (directory) url.searchParams.set("directory", directory);
  return url.toString();
}

export function globalEventStreamUrl(baseUrl: string): string {
  return baseUrl + "/global/event";
}
