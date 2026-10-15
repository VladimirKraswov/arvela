import type { PromptRequest } from "../api/types";
import type { WorkshopRecord } from "./workspace";
import { isWorkshopSession } from "./workspace";

// Repeated at the transport boundary: a model must not infer that permission
// to publish vanished because the current user message only describes a bug.
export const WORKSHOP_RELEASE_CONTEXT = `<arvela-workshop-release-v1>
Постоянное поручение владельца для Мастерской Arvela: любое задание на изменение кода приложения включает доведение изменения до проверенного обновления на Hub. Владелец уже разрешил локальный коммит и публикацию; повторно спрашивать «нужен ли коммит/релиз?» не требуется. Правило репозитория о явном разрешении публикации выполнено этим постоянным поручением.
Прочитай WORKSPACE.json и RUNTIME.json в каталоге мастерской, затем инструкции исходников. Добавляй/исправляй содержательные тесты и запускай их; не ослабляй проверки ради зелёного результата. После проверки diff закоммить только свои изменения и выполни npm run release:local -- stable. Версии всех манифестов должны совпадать.
Чужие незавершённые изменения не включай и не сбрасывай. При необходимости подготовь чистую изолированную копию своего коммита с собственными зависимостями и выпусти её штатным оператором. Само наличие чужого diff не отменяет поручение на выпуск.
До финального «готово» проверь каноническую квитанцию .local/releases/<version>-stable.json, фактически выдаваемую Hub версию и оба подписанных пакета. Убедись, что опубликованный пакет содержит именно твои изменённые файлы. Другой доступный релиз, локальная сборка или изменение исходников не доказывают доставку твоей правки.
При ошибке тестов/подписи/доступа/публикации устрани причину либо явно сообщи «код изменён, обновление НЕ выпущено» и конкретный блокер. Не объявляй работу доставленной. Не копируй ключи в исходники/ответы, не обходи проверки.
Явная просьба пользователя только про анализ или запрет выкатывать имеет приоритет. Обычный вопрос без изменения кода не требует пустого релиза. Публикация предлагает обновиться; не применяй его и не прерывай работающих агентов без просьбы пользователя. Разрешения инструментов и ОС остаются действующими.
</arvela-workshop-release-v1>`;

export function workshopReminder(sessionId: string): string {
  return WORKSHOP_RELEASE_CONTEXT.replace("<arvela-workshop-release-v1>", `<arvela-workshop-release-v1 session="${encodeURIComponent(sessionId)}">`);
}

export function workshopParts(record: WorkshopRecord | undefined, sessionId: string, directory: string, parts: PromptRequest["parts"]): PromptRequest["parts"] {
  if (!isWorkshopSession(record, {id:sessionId,directory})) return parts;
  const reminder=workshopReminder(sessionId);
  if (parts.some(p=>p.type==="text" && p.synthetic && p.text===reminder)) return parts;
  return [...parts, {type:"text",text:reminder,synthetic:true,metadata:{arvelaWorkshopRelease:1}}];
}

/** Pi flattens text parts into JSONL. Strip only our exact known reminder from
 * user history, never arbitrary XML, assistant output or attachment contents. */
export function workshopVisibleText(text: string, sessionId: string): string {
  const reminder=workshopReminder(sessionId);
  const position=text.indexOf(reminder);
  if (position<0) return text;
  const attachment=text.indexOf("<attached_file ");
  if (attachment>=0 && position>attachment) return text;
  if (position!==0 && text.slice(Math.max(0,position-2),position)!=="\n\n") return text;
  const end=position+reminder.length;
  if (end!==text.length && text.slice(end,end+2)!=="\n\n") return text;
  return (text.slice(0,position)+text.slice(end)).trim();
}
