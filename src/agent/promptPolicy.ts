import type { PromptRequest } from '../api/types';
import type { WorkshopRecord } from '../workshop/workspace';
import { workshopParts, workshopVisibleText } from '../workshop/policy';
import { toolWorkflowReminder, legacyV2ToolWorkflowReminder, legacyToolWorkflowReminder } from './toolWorkflow';
export const RESPONSE_LANGUAGE_CONTEXT = `Язык общения Enki: все сообщения пользователю, пояснения, вопросы, отчёты об ошибках и итоговые ответы пиши на русском языке. Не переходи на украинский язык вслед за историей, выводом инструментов или документами. Размышления допускаются на английском. Код, команды, пути и собственные имена сохраняй без перевода. Это правило языка, а не разрешение выполнять дополнительные действия.`;
export const scheduleReminder = (sessionId:string,directory:string) => `<enki-schedules-v1 session="${encodeURIComponent(sessionId)}">\nТаймеры Enki: если пользователь просит следить, периодически проверять, дождаться чужой работы или выполнить действие позже, используй общий MCP enki-schedules / desktop_schedule (имя может иметь префикс mesh_enki_schedules_). Текущий session_id=${JSON.stringify(sessionId)}, directory=${JSON.stringify(directory)}. Не переключай видимый чат. Для наблюдения mode=repeat, выбери разумный minutes (обычно 5–15, для долгой работы 30–60), для «через час» mode=once, minutes=60; для точного времени run_at — Unix миллисекунды. Задай краткое title, самостоятельный prompt с целью, условием завершения и правилом сообщать только о значимых изменениях. request_key — стабильное уникальное имя задачи; при повторе вызова используй тот же ключ. Сначала list, чтобы не плодить повторы. Не обещай таймер без успешного create. По просьбе прекратить наблюдение найди таймер через list и remove; по завершении наблюдения удали свой таймер. Нельзя создавать новые таймеры из планового пробуждения без новой просьбы человека. Инструменты и разрешения остаются штатными. Работает, пока Enki открыта или в трее; после полного выхода не работает. Если инструмент отключён/недоступен, честно сообщи, не имитируй ожидание shell sleep.\n</enki-schedules-v1>`;
export const scheduleWakeReminder=(sessionId:string,taskId:string)=>`<enki-schedule-wake-v1 session="${encodeURIComponent(sessionId)}" task="${encodeURIComponent(taskId)}">\nЭто плановое пробуждение по ранее сохранённому заданию, а не новая просьба человека. Выполни проверку по текущему контексту. Не создавай дополнительные таймеры. Если наблюдение завершено, удали этот таймер через desktop_schedule. Сообщай владельцу о значимых изменениях, завершении, ошибке или необходимости его решения.\n</enki-schedule-wake-v1>`;
function removeExactBlock(text:string,block:string):string {
 const at=text.indexOf(block),end=at+block.length,attachment=text.indexOf('<attached_file ');
 return at>=0&&(at===0||text.slice(at-2,at)==="\n\n")&&(end===text.length||text.slice(end,end+2)==="\n\n")&&(attachment<0||at<attachment)
  ?(text.slice(0,at>0?at-2:0)+text.slice(end+(at===0&&text.slice(end,end+2)==="\n\n"?2:0))).trim():text;
}
export const languageReminder = (sessionId: string) => `<arvela-response-language-v1 session="${encodeURIComponent(sessionId)}">\n${RESPONSE_LANGUAGE_CONTEXT}\n</arvela-response-language-v1>`;
/** Re-send at every dispatch, including queued corrections and schedules. This
 * survives engine context compaction without changing the user's text/files. */
export function agentParts(record: WorkshopRecord | undefined, sessionId: string, directory: string, parts: PromptRequest['parts']): PromptRequest['parts'] {
    const scoped = workshopParts(record, sessionId, directory, parts);
    let result = scoped;
    for (const [text, metadata] of [
        [languageReminder(sessionId), { arvelaResponseLanguage: 1 }],
        [toolWorkflowReminder(sessionId), { arvelaToolWorkflow: 1 }],
        [scheduleReminder(sessionId,directory), { enkiSchedules: 1 }],
    ] as const) {
        if (!result.some(p => p.type === 'text' && p.synthetic && p.text === text))
            result = [...result, { type: 'text', text, synthetic: true, metadata }];
    }
    return result;
}
/** Pi flattens text parts. Hide only the exact app-owned, same-session block
 * before attachments; never strip quoted text, assistant output or file data. */
export function visiblePromptText(text: string, sessionId: string): string {
    for (const reminder of [toolWorkflowReminder(sessionId), legacyV2ToolWorkflowReminder(sessionId), legacyToolWorkflowReminder(sessionId), languageReminder(sessionId), languageReminder(sessionId).replace("Язык общения Enki:", "Язык общения Arvela:"), steeringReminder(sessionId)]) {
        const position = text.indexOf(reminder);
        const attachment = text.indexOf('<attached_file ');
        const end = position + reminder.length;
        if (position >= 0 && (attachment < 0 || position < attachment)
            && (position === 0 || text.slice(position - 2, position) === '\n\n')
            && (end === text.length || text.slice(end, end + 2) === '\n\n'))
            text = (text.slice(0, position > 0 ? position - 2 : 0)
                + text.slice(end + (position === 0 && text.slice(end, end + 2) === '\n\n' ? 2 : 0))).trim();
    }
    const wakePrefix=`<enki-schedule-wake-v1 session="${encodeURIComponent(sessionId)}" task="`;
    const wakeAt=text.indexOf(wakePrefix),quote=wakeAt<0?-1:text.indexOf('"',wakeAt+wakePrefix.length);
    if(quote>=0)try{text=removeExactBlock(text,scheduleWakeReminder(sessionId,decodeURIComponent(text.slice(wakeAt+wakePrefix.length,quote))));}catch{/* Keep malformed user text. */}
    const open=`<enki-schedules-v1 session="${encodeURIComponent(sessionId)}">`;
    const at=text.indexOf(open),directoryMatch=at<0?null:text.slice(at).match(/directory=("(?:[^"\\]|\\.)*")/);
    if(directoryMatch)try{text=removeExactBlock(text,scheduleReminder(sessionId,JSON.parse(directoryMatch[1]) as string));}catch{/* Keep altered/quoted text. */}
    return workshopVisibleText(text, sessionId);
}

export const steeringReminder = (sessionId: string) => `<arvela-steering-v1 session="${encodeURIComponent(sessionId)}">\nЭто уточнение текущего задания. Продолжай текущую работу и учти уточнение на следующем шаге. Не начинай независимое задание.\n</arvela-steering-v1>`;
export function steeringParts(sessionId: string, parts: PromptRequest['parts']): PromptRequest['parts'] {
    const marked = parts.map(p => p.type === 'text' && !p.synthetic ? {...p, metadata: {...p.metadata, arvelaSteering: 1}} : p);
    const text = steeringReminder(sessionId);
    return marked.some(p => p.type === 'text' && p.synthetic && p.text === text) ? marked
        : [...marked, {type: 'text', text, synthetic: true, metadata: {arvelaSteeringContext: 1}}];
}
export function isSteeringText(text: string, sessionId: string): boolean {
    const attachment = text.indexOf('<attached_file ');
    return (attachment < 0 ? text : text.slice(0, attachment)).split('\n\n').includes(steeringReminder(sessionId));
}
