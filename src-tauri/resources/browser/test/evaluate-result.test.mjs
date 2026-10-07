import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvaluateResult } from './evaluate-result.mjs';

test('parses exact JSON before browser state or subsequent sections', () => {
  const value = { input: 'PANEL_UI_OK', result: 'PANEL_UI_OK', scrollY: 0 };
  const prefix = `### Result\n${JSON.stringify(value, null, 2)}`;
  for (const suffix of ['', '\nDesktop browser state: {"revision":4}', '\n### Ran Playwright code\nexample']) {
    assert.deepEqual(parseEvaluateResult(prefix + suffix), value);
  }
});

test('rejects missing or malformed results rather than reporting success', () => {
  assert.throws(() => parseEvaluateResult('no result'));
  assert.throws(() => parseEvaluateResult('### Result\nnot JSON'));
});
