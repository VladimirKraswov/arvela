import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { initialState } from '../src/state/initial';
import { DEFAULT_PREFS } from '../src/state/prefs';
import { emptySessionChat } from '../src/state/chatReducer';
import { collectHubRecords } from '../src/hub/collection';
import { hubOrigin } from '../src/hub/identity';
import type { Session } from '../src/api/types';

const session = (id: string, directory: string): Session => ({ id, directory, title: id, projectID: 'p', time: { created: 1, updated: 1 } });
function stateWithChats() {
  const state = initialState(structuredClone(DEFAULT_PREFS));
  state.directory = '/projects/foreground';
  state.sessions = [session('a', state.directory)];
  state.recentSessionList.sessions = [session('b', '/projects/background')];
  for (const id of ['a', 'b', 'unknown']) {
    const chat = emptySessionChat();
    chat.messageOrder = ['user'];
    chat.messages.user = { id: 'user', sessionID: id, role: 'user', time: { created: 1 } };
    state.chat.sessions[id] = chat;
  }
  return state;
}
it('attributes background history to its actual project and does not guess missing metadata', () => {
  const records = collectHubRecords(stateWithChats(), new Map(), true);
  expect(records.map(r => [r.sessionId, r.project])).toEqual([['a', 'foreground'], ['b', 'background']]);
  expect(records.every(r => r.diagnostics?.schema === 1)).toBe(true);
});
it('uses Pi ownership even when another OpenCode project is selected', () => {
  const state = stateWithChats();
  state.prefs.piSessions = { b: { id: 'b', directory: '/pi/project', title: 'Pi task', created: 1, updated: 1 } };
  const records = collectHubRecords(state, new Map(), false);
  expect(records[1]).toMatchObject({ engine: 'pi', project: 'project', title: '', text: '' });
});
it('binds enqueue to the exact native endpoint/certificate identity', async () => {
  const config = { endpoint: 'https://hub.example:8443', certificate: 'certificate\nfixture' };
  expect(await hubOrigin(config)).toBe(createHash('sha256').update(JSON.stringify([config.endpoint, config.certificate])).digest('hex'));
  expect(await hubOrigin({ ...config, certificate: 'changed' })).not.toBe(await hubOrigin(config));
});
