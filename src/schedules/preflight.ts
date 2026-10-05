// Pure checks a scheduled prompt passes before it is sent. They only read state the
// agent already reported; nothing here answers a permission or question.
import type { AgentInfo, PermissionRequest, ProviderResponse, QuestionRequest, SessionStatus } from "../api/types";
import type { ScheduledTask } from "./tasks";

export interface ChatActivity {
  status?: SessionStatus;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  /** User prompts queued in this chat. They always go first. */
  queued: number;
  /** The app's own view says the chat is running (events may be ahead of the read). */
  running: boolean;
  /** Another operation of this app owns the chat (queue dispatch, compaction). */
  locked: boolean;
  /** A blocking Pi extension dialog for this chat awaits the user. */
  dialog: boolean;
}

/** Why the chat cannot take a scheduled prompt right now, or null when it can. */
export function chatBlocker(sessionID: string, activity: ChatActivity): string | null {
  if (activity.permissions.some(p => p.sessionID === sessionID)) return "Ждёт вашего решения по запросу разрешения в чате";
  if (activity.questions.some(q => q.sessionID === sessionID) || activity.dialog) return "Агент ждёт вашего ответа в чате";
  if (activity.queued) return "Сначала отправляются ваши запросы из очереди чата";
  if (activity.locked) return "В чате выполняется другая операция";
  if (activity.running || (activity.status && activity.status.type !== "idle")) return "Агент занят; запуск после завершения текущего ответа";
  return null;
}

/**
 * A definite reason the saved model, reasoning variant or agent can no longer be
 * used on this server, or null. An empty catalog proves nothing (the server then
 * decides), so it never blocks; a listed catalog without the saved model does.
 */
export function modelProblem(task: ScheduledTask, providers: ProviderResponse | null, agents: AgentInfo[] | null): string | null {
  const { providerID, modelID, variant } = task.model;
  const label = `${providerID}/${modelID}`;
  if (providers?.all?.length) {
    const provider = providers.all.find(p => p.id === providerID);
    const model = provider?.models?.[modelID];
    if (!provider || !model) return `Модель ${label} больше не настроена на сервере. Создайте задание с доступной моделью.`;
    if (providers.connected?.length && !providers.connected.includes(providerID))
      return `Провайдер ${providerID} сейчас не подключён на сервере. Проверьте его настройку и возобновите задание.`;
    if (variant && model.variants && !Object.prototype.hasOwnProperty.call(model.variants, variant))
      return `Вариант рассуждения «${variant}» больше не предлагается для модели ${label}.`;
  }
  if (task.agent && agents?.length && !agents.some(agent => agent.name === task.agent))
    return `Агент «${task.agent}» больше не настроен на сервере.`;
  return null;
}

export interface LiveModel { providerID: string; modelID: string; thinking?: string }

/**
 * A running Pi process keeps the model it was started with and ignores the one in
 * a prompt. Sending anyway would silently substitute the model, so it blocks.
 */
export function liveModelProblem(task: ScheduledTask, live: LiveModel | null): string | null {
  const saved = `${task.model.providerID}/${task.model.modelID}`;
  if (!live) return `Запущенный чат Pi не сообщил свою модель; запрос для ${saved} не отправлен.`;
  if (live.providerID !== task.model.providerID || live.modelID !== task.model.modelID)
    return `Чат Pi уже работает с моделью ${live.providerID}/${live.modelID}, а задание сохранено для ${saved}. Модель не подменяется: создайте задание заново.`;
  if (task.model.variant && live.thinking && live.thinking !== task.model.variant)
    return `Чат Pi работает с уровнем рассуждения «${live.thinking}», а задание сохранено с «${task.model.variant}».`;
  return null;
}
