import type { AssistantMessage, MessagePart } from '../api/types';
/** Only classify a terminal length stop; ordinary long reasoning/tool data is
 * not a loop. Inspect a bounded tail without retaining or logging its contents. */
export function repetitiveOutput(message: AssistantMessage, parts: readonly MessagePart[]): boolean {
  if (message.finish !== 'length' && (message.error as {name?:string} | undefined)?.name !== 'MessageOutputLengthError') return false;
  const last = [...parts].reverse().find(p => (p.type === 'reasoning' || p.type === 'text') && p.text?.trim());
  const tail = last?.text?.trimEnd().slice(-768) ?? '';
  if (tail.length < 768 || !tail.trim()) return false;
  for (let width = 1; width <= 12; width++) {
    const unit = tail.slice(-width), repeated = unit.repeat(Math.floor(tail.length / width));
    if (unit.trim() && tail.endsWith(repeated)) return true;
  }
  return false;
}
