import { expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import { mergeOpencodeProviders, mergePiModels, planCatalog, hubModelsState } from '../src/models/catalog';
it('merges JSONC with braces in comments and keeps unrelated bytes', () => {
    const input = '// { header\n{\n "provider": {\n  "local": {"models": {}, /* } */ "note": "keep"},\n  "old": {"models": {}} // } comment\n },\n "theme": "dark"\n}';
    const result = mergeOpencodeProviders(input, { next: { models: { n: {} } } }, ['old']);
    expect(result.error).toBeUndefined();
    expect(parse(result.text)).toEqual({ provider: { local: { models: {}, note: 'keep' }, next: { models: { n: {} } } }, theme: 'dark' });
    expect(result.text).toContain('"local": {"models": {}, /* } */ "note": "keep"}');
    expect(result.text).toContain('// { header');
});
it.each(['{oops', '[]', '{"theme":true} trailing', '{"provider":{},"provider":{}}'])('refuses invalid or ambiguous configuration: %s', input => {
    const result = mergeOpencodeProviders(input, { next: { models: { n: {} } } }, []);
    expect(result.error).toBeTruthy();
    expect(result.changed).toBe(false);
    expect(result.text).toBe(input);
});
it('does not replace an invalid Pi providers block', () => {
    const result = mergePiModels('{"providers":[]}', { next: { models: [] } }, []);
    expect(result.error).toBeTruthy();
    expect(result.changed).toBe(false);
});
it('supports provider names inherited by Object.prototype', () => {
    const prefs = hubModelsState({ hubModels: { enabled: true } });
    const plan = planCatalog({ version: 1, models: [{ id: 'x', label: 'X', opencode: { providerId: 'constructor', provider: { models: { x: {} } } } }] }, prefs);
    expect(Object.keys(plan.opencode)).toEqual(['constructor']);
    const merged = mergePiModels('{}', JSON.parse('{"__proto__":{"models":[]}}'), []);
    expect(Object.keys(JSON.parse(merged.text).providers)).toEqual(['__proto__']);
});
it('keeps a local JSONC provider including its own trailing comma byte-for-byte', () => {
    const local = '"local": {"models": {"m": {},},}';
    const result = mergeOpencodeProviders('{"provider":{' + local + ',"old":{}}}', {}, ['old']);
    expect(result.error).toBeUndefined();
    expect(result.text).toContain(local);
});
