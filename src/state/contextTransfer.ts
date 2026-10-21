import type { AssistantMessage, Message, MessageResponse, ModelInfo } from '../api/types';

export function inputBudget(model: ModelInfo): number {
  const context = model.limit?.context ?? 0;
  const output = Math.min(model.limit?.output || 32000, 32000);
  return Math.max(0, Math.min(model.limit?.input || context, context - output) - 24576);
}

/** Usage belongs to the last successful model, even after a failed model switch.
 * A successful summary is a boundary: its large INPUT is no longer live context. */
export function transferSource(messages: Message[], target: ModelInfo): AssistantMessage | undefined {
  const budget = inputBudget(target);
  if (!budget) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || m.error) continue;
    if (m.summary && m.time.completed && m.finish && m.finish !== 'length')
      return (m.tokens?.output ?? 0) + 24576 >= budget ? m : undefined;
    const t = m.tokens;
    const used = t?.total || (t?.input ?? 0) + (t?.output ?? 0) + (t?.cache?.read ?? 0) + (t?.cache?.write ?? 0);
    if (used) return used >= budget && (m.providerID !== target.providerID || m.modelID !== target.id) ? m : undefined;
  }
}

export function verifiedSummary(rows: MessageResponse[], prior: Set<string>, target?: ModelInfo, tail = 16000): MessageResponse {
  const row = [...rows].reverse().find(r => r.info.role === 'assistant' && r.info.summary && !prior.has(r.info.id));
  const m = row?.info;
  if (!m || m.role !== 'assistant' || m.error || !m.time.completed || !m.finish || m.finish === 'length')
    throw new Error('Сжатие не завершилось успешно. Модель не переключена, история и черновик сохранены.');
  const text = row!.parts.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n');
  if (!text.trim()) throw new Error('Сжатие вернуло пустую выжимку. Модель не переключена.');
  // Conservative byte estimate when no output usage is reported. Never count the
  // source summary request's input as the destination context or drop its tail.
  const estimate = Math.max(m.tokens?.output ?? 0, new TextEncoder().encode(text).length) + Math.max(0, tail) + 8192;
  if (target && estimate >= inputBudget(target))
    throw new Error('Выжимка с недавними шагами всё ещё велика для выбранной модели. Выберите модель с большим контекстом.');
  return row!;
}

/** A transport acknowledgement can precede durable completion. Observe the same
 * native request; never replay compaction or switch on a merely pending summary. */
export async function waitForSummary(load: () => Promise<MessageResponse[]>, prior: Set<string>, target: ModelInfo,
  tail: number, deadline: number): Promise<MessageResponse> {
  while (Date.now() < deadline) {
    const rows = await load();
    const row = [...rows].reverse().find(r => r.info.role === 'assistant' && r.info.summary && !prior.has(r.info.id));
    if (row?.info.error || row?.info.time.completed) return verifiedSummary(rows, prior, target, tail);
    await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('Не дождались завершения сжатия. Переключение не выполнено; проверьте ход работы в чате. Повторный запрос автоматически не отправлен.');
}
