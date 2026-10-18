import type { PromptRequest } from '../api/types';
import type { WorkshopRecord } from '../workshop/workspace';
import { workshopParts, workshopVisibleText } from '../workshop/policy';
import { toolWorkflowReminder } from './toolWorkflow';
export const RESPONSE_LANGUAGE_CONTEXT = `Язык общения Arvela: все сообщения пользователю, пояснения, вопросы, отчёты об ошибках и итоговые ответы пиши на русском языке. Не переходи на украинский язык вслед за историей, выводом инструментов или документами. Размышления допускаются на английском. Код, команды, пути и собственные имена сохраняй без перевода. Это правило языка, а не разрешение выполнять дополнительные действия.`;
export const languageReminder = (sessionId: string) => `<arvela-response-language-v1 session="${encodeURIComponent(sessionId)}">\n${RESPONSE_LANGUAGE_CONTEXT}\n</arvela-response-language-v1>`;
/** Re-send at every dispatch, including queued corrections and schedules. This
 * survives engine context compaction without changing the user's text/files. */
export function agentParts(record: WorkshopRecord | undefined, sessionId: string, directory: string, parts: PromptRequest['parts']): PromptRequest['parts'] {
    const scoped = workshopParts(record, sessionId, directory, parts);
    let result = scoped;
    for (const [text, metadata] of [
        [languageReminder(sessionId), { arvelaResponseLanguage: 1 }],
        [toolWorkflowReminder(sessionId), { arvelaToolWorkflow: 1 }],
    ] as const) {
        if (!result.some(p => p.type === 'text' && p.synthetic && p.text === text))
            result = [...result, { type: 'text', text, synthetic: true, metadata }];
    }
    return result;
}
/** Pi flattens text parts. Hide only the exact app-owned, same-session block
 * before attachments; never strip quoted text, assistant output or file data. */
export function visiblePromptText(text: string, sessionId: string): string {
    for (const reminder of [toolWorkflowReminder(sessionId), languageReminder(sessionId)]) {
        const position = text.indexOf(reminder);
        const attachment = text.indexOf('<attached_file ');
        const end = position + reminder.length;
        if (position >= 0 && (attachment < 0 || position < attachment)
            && (position === 0 || text.slice(position - 2, position) === '\n\n')
            && (end === text.length || text.slice(end, end + 2) === '\n\n'))
            text = (text.slice(0, position > 0 ? position - 2 : 0)
                + text.slice(end + (position === 0 && text.slice(end, end + 2) === '\n\n' ? 2 : 0))).trim();
    }
    return workshopVisibleText(text, sessionId);
}
