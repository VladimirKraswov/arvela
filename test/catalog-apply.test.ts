import { beforeEach, expect, it, vi } from 'vitest';
import { applyCatalog } from '../src/hub/modelCatalog';
import { hubModelsState } from '../src/models/catalog';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const model = { id: 'common', label: 'Common', opencode: { providerId: 'common', provider: { models: { m: {} } } }, pi: { providerId: 'common', provider: { models: [{ id: 'm' }] } } };
const prefs = hubModelsState({ hubModels: { enabled: true, appliedOpencode: ['old'], appliedPi: ['old'] } });
beforeEach(() => { invoke.mockReset(); });
it('preflights both files before writing so invalid Pi config cannot partially apply', async () => {
    invoke.mockImplementation(async (cmd: string) => ({ content: cmd === 'read_pi_models' ? 'broken' : '{}' }));
    await expect(applyCatalog({ version: 2, models: [model] }, prefs)).rejects.toThrow(/Pi/);
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['read_opencode_config', 'read_pi_models']);
});
it('persists successful OpenCode ownership when a concurrent Pi edit rejects the second write', async () => {
    invoke.mockImplementation(async (cmd: string) => { if (cmd.startsWith('read_'))
        return { content: '{}' }; if (cmd === 'write_pi_models')
        throw Error('CAS conflict'); });
    const applied = vi.fn();
    await expect(applyCatalog({ version: 2, models: [model] }, prefs, applied)).rejects.toThrow(/OpenCode применены; Pi не обновлён/);
    expect(applied).toHaveBeenCalledWith(['common']);
    expect(invoke.mock.calls.find(c => c[0] === 'write_opencode_config')?.[1]).toMatchObject({ expected: '{}' });
});
it('applies a published empty catalog to remove only previously managed providers in both engines', async () => {
    invoke.mockImplementation(async (cmd: string) => ({ content: JSON.stringify({ [cmd === 'read_pi_models' ? 'providers' : 'provider']: { old: { models: {} }, local: { models: {} } } }) }));
    const result = await applyCatalog({ version: 3, models: [] }, prefs);
    expect(result.appliedOpencode).toEqual([]);
    expect(result.appliedPi).toEqual([]);
    expect(result.report.removed).toEqual(['old']);
    for (const [cmd, body] of invoke.mock.calls.filter(c => c[0].startsWith('write_'))) {
        const parsed = JSON.parse(body.content);
        expect(Object.keys(parsed[cmd === 'write_pi_models' ? 'providers' : 'provider'])).toEqual(['local']);
    }
});
