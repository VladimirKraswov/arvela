/** Bound mounted history independently of total cached history. Never slide a reader's window. */
export function conversationWindow(order: readonly string[], first: string | undefined, following: boolean) {
  const saved = !following && first ? order.indexOf(first) : -1;
  const start = following || saved < 0 ? Math.max(0, order.length - 60) : saved;
  return {start, end: Math.min(order.length, start + (following ? 60 : 120))};
}
