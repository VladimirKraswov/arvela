// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const { fetchCatalog } = vi.hoisted(() => ({ fetchCatalog: vi.fn() }));
vi.mock('../src/hub/modelCatalog', () => ({ fetchCatalog, applyCatalog: vi.fn(), publishCatalog: vi.fn() }));
vi.mock('../src/state/store', () => ({
    useAppState: () => ({ prefs: { hubModels: { enabled: true, excluded: [], appliedVersion: 0, appliedOpencode: [], appliedPi: [] } } }),
    store: { state: { activityStatuses: {}, statuses: {} }, setHubModels: vi.fn() }
}));
import { ModelCatalogSettings } from '../src/components/ModelCatalogSettings';
it('refreshing a catalog version replaces stale editor values as well as its summary', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const catalog = (version: number, label: string) => ({ version, models: [{ id: 'same-id', label, opencode: { providerId: 'local', provider: { models: { m: {} } } } }] });
    fetchCatalog.mockResolvedValueOnce(catalog(1, 'Old')).mockResolvedValueOnce(catalog(2, 'New'));
    const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find(b => b.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()); };
    try {
        await act(async () => root.render(createElement(ModelCatalogSettings)));
        await click('Изменить');
        expect((host.querySelector('#catalog-0-label') as HTMLInputElement).value).toBe('Old');
        await click('Обновить с Hub');
        await click('Изменить');
        expect((host.querySelector('#catalog-0-label') as HTMLInputElement).value).toBe('New');
    }
    finally {
        await act(async () => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    }
});
