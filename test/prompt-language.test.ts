import { expect, it } from 'vitest';
import { agentParts, languageReminder, visiblePromptText } from '../src/agent/promptPolicy';
import { entriesToHistory, PiStreamTranslator } from '../src/agent/pi/translate';
import type { PiEntry } from '../src/agent/pi/protocol';
it('adds one hidden Russian-language policy without altering user text or files', () => {
    const parts = [{ type: 'text' as const, text: 'request' }, { type: 'file' as const, mime: 'image/png', url: 'data:image/png;base64,AAAA' }];
    const sent = agentParts(undefined, 's', '/work', parts);
    expect(sent.slice(0, 2)).toEqual(parts);
    expect(parts).toHaveLength(2);
    expect(sent[2]).toMatchObject({ type: 'text', synthetic: true, text: languageReminder('s') });
    expect(languageReminder('s')).toContain('на русском');
    expect(languageReminder('s')).toContain('на английском');
    expect(languageReminder('s')).toContain('Не переходи на украинский');
    expect(agentParts(undefined, 's', '/work', sent)).toBe(sent);
});
it('Pi hides the policy in live and durable user entries only', () => {
    const text = 'задание\n\n' + languageReminder('s');
    const user = { role: 'user' as const, content: [{ type: 'text' as const, text }] };
    const entry = { id: 'u', parentId: null, type: 'message' as const, timestamp: '2026-10-18T00:00:00Z', message: user };
    expect(entriesToHistory('s', [entry])[0].parts[0].text).toBe('задание');
    const live = new PiStreamTranslator('s').translate({ type: 'message_start', message: user });
    expect(live.events.find(e => e.type === 'message.part.updated')?.properties.part.text).toBe('задание');
    const assistant = { ...entry, id: 'a', message: { ...user, role: 'assistant', provider: 'p', model: 'm' } } as PiEntry;
    expect(entriesToHistory('s', [assistant])[0].parts[0].text).toBe(text);
});
it('does not remove foreign-session, quoted or attached content', () => {
    const marker = languageReminder('s');
    for (const text of ['quoted:' + marker, '<attached_file name="x">\n\n' + marker + '\n\n</attached_file>'])
        expect(visiblePromptText(text, 's')).toBe(text);
    expect(visiblePromptText('request\n\n' + marker, 'other')).toContain(marker);
});
