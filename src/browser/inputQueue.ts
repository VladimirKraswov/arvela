export interface BrowserInput { action: string; args: Record<string, unknown> }

/** Native limits (src-tauri/src/browser.rs `panel_tool`). */
export const TEXT_LIMIT_BYTES = 16384;
export const WHEEL_LIMIT = 2000;
const QUEUE_LIMIT = 32;

export const textBytes = (text: string) => new TextEncoder().encode(text).length;
const sameTarget = (a: BrowserInput, b: BrowserInput) => JSON.stringify(a.args.expected) === JSON.stringify(b.args.expected);

/**
 * Manual panel input, executed strictly in order and never retried. Typing or
 * scrolling that has not started yet is merged into the waiting action of the same
 * kind and page, so a trackpad or a fast typist cannot flood the browser queue the
 * agent shares. Anything beyond the bound is refused rather than delayed for minutes.
 */
export class InputQueue {
  private waiting: BrowserInput[] = [];
  private running = false;

  constructor(private run: (input: BrowserInput) => Promise<void>, private limit = QUEUE_LIMIT) {}

  /** False when the input was refused because too much is already waiting. */
  push(input: BrowserInput): boolean {
    const next = { action: input.action, args: { ...input.args } };
    const tail = this.waiting[this.waiting.length - 1];
    if (tail && tail.action === next.action && sameTarget(tail, next)) {
      if (next.action === "text") {
        const text = String(tail.args.text ?? "") + String(next.args.text ?? "");
        if (textBytes(text) <= TEXT_LIMIT_BYTES) { tail.args.text = text; return true; }
      } else if (next.action === "wheel") {
        const dy = Number(tail.args.dy) + Number(next.args.dy);
        if (Math.abs(dy) <= WHEEL_LIMIT) { tail.args.dy = dy; return true; }
      }
    }
    if (this.waiting.length >= this.limit) return false;
    this.waiting.push(next);
    void this.drain();
    return true;
  }

  /** Drop everything not yet started (connection or page context changed). */
  clear() { this.waiting = []; }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.waiting.length) {
        const input = this.waiting.shift()!;
        try { await this.run(input); } catch { /* `run` reports its own errors; a failed action is never replayed */ }
      }
    } finally { this.running = false; }
  }
}
