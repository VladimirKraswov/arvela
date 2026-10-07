import type { SessionChatState } from "../state/chatReducer";
export interface BrowserPerformance { calls: number; failed: number; queueMs: number; actionMs: number; observeMs: number; completedSteps: number }
export function browserPerformance(value: unknown): BrowserPerformance | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>, keys = ["calls", "failed", "queueMs", "actionMs", "observeMs", "completedSteps"] as const;
  if (keys.some(key => typeof data[key] !== "number" || !Number.isFinite(data[key]) || (data[key] as number) < 0)) return null;
  return Object.fromEntries(keys.map(key => [key, data[key]])) as unknown as BrowserPerformance;
}
function union(intervals: [number, number][]) {
  const sorted = intervals.sort((a,b) => a[0] - b[0]); let end = -Infinity, sum = 0;
  for (const [a,b] of sorted) { sum += Math.max(0, b - Math.max(a,end)); end = Math.max(end,b); } return sum;
}
/** Only the already loaded current turn. No session search or transcript reads. */
export function currentTurnPerformance(chat?: SessionChatState) {
  if (!chat) return null;
  const ids = chat.messageOrder, last = ids.map(id => chat.messages[id]).map(m => m?.role).lastIndexOf("user");
  if (last < 0) return null;
  const messages = ids.slice(last).map(id => chat.messages[id]).filter(Boolean), start = messages[0].time.created;
  const assistants = messages.filter(m => m.role === "assistant");
  const end = assistants.length && assistants.every(m => m.time.completed) ? Math.max(...assistants.map(m => m.time.completed!)) : null;
  const intervals: [number, number][] = [], thinking: [number, number][] = [];
  let calls = 0, failed = 0, output = 0, reasoning = 0, tokenKnown = false;
  for (const m of assistants) {
    if (m.tokens) { tokenKnown = true; output += m.tokens.output ?? 0; reasoning += m.tokens.reasoning ?? 0; }
    for (const id of chat.partsByMessage[m.id] ?? []) {
      const p = chat.parts[id]; if (!p) continue;
      const t = p.type === "tool" ? p.state?.time : p.time;
      if (p.type === "tool") { calls++; if (p.state?.status === "error") failed++; }
      if (t && typeof t.start === "number" && typeof t.end === "number" && t.end >= t.start) {
        const bounded: [number,number] = [Math.max(start,t.start), end ? Math.min(end,t.end) : t.end];
        if (bounded[1] >= bounded[0]) { if (p.type === "tool") intervals.push(bounded); else if (p.type === "reasoning") thinking.push(bounded); }
      }
    }
  }
  return { wallMs: end ? Math.max(0,end-start) : null, toolMs: intervals.length ? union(intervals) : null,
    reasoningMs: thinking.length ? union(thinking) : null, calls, failed, output: tokenKnown ? output : null, reasoning: tokenKnown ? reasoning : null };
}
