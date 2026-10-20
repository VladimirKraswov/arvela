import { afterEach, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { executionFeedback } from '../src-tauri/resources/browser/execution-feedback.mjs';
import accessPolicy from '../src-tauri/resources/browser/access-policy.mjs';
import gate from '../src-tauri/resources/pi/tool-gate';
import { legacyV2ToolWorkflowReminder, toolWorkflowReminder } from '../src/agent/toolWorkflow';
import { visiblePromptText } from '../src/agent/promptPolicy';

const footer = '<shell_metadata>\nshell tool terminated command after exceeding timeout 600000 ms\n</shell_metadata>';
afterEach(() => { delete process.env.ENKI_EXECUTION_FEEDBACK_MODULE; });
it('recognizes an executor terminal timeout even with a large redirected output', () => {
  const result = executionFeedback('opencode', 'bash', 'log\n'.repeat(5000) + footer);
  expect(result?.outcome).toBe('timed_out');
  expect(result?.message).toContain('проверка не завершена успешно');
});
it('does not turn ordinary timeout logs, nonterminal examples or other tools into failure', () => {
  for (const output of ['request timeout', 'Command exited with code 1', footer + '\nprocess succeeded', 'example timeout 600000 ms'])
    expect(executionFeedback('opencode', 'bash', output)).toBeUndefined();
  expect(executionFeedback('opencode', 'read', footer)).toBeUndefined();
  expect(executionFeedback('pi', 'bash', 'Command timed out after 10 seconds', false)).toBeUndefined();
  expect(executionFeedback('pi', 'bash', 'connection timeout', true)).toBeUndefined();
});
it('OpenCode keeps original output, metadata and command while labeling the timeout', async () => {
  const hooks = await accessPolicy({ client: {}, directory: '/isolated' });
  const input = { tool: 'bash', args: { command: 'my-gui', timeout: 600000 } };
  const output = { title: 'my-gui', output: 'game output\n' + footer, metadata: { exit: null, owner: 'keep' } };
  await hooks['tool.execute.after'](input, output);
  expect(input.args).toEqual({ command: 'my-gui', timeout: 600000 });
  expect(output.output.startsWith('game output\n' + footer)).toBe(true);
  expect(output.metadata).toMatchObject({ exit: null, owner: 'keep', enkiExecution: { outcome: 'timed_out' } });
  expect(output.title).toContain('таймауту');
  const normal = { title: 'ok', output: 'passed', metadata: { exit: 0 } };
  await hooks['tool.execute.after'](input, normal);
  expect(normal).toEqual({ title: 'ok', output: 'passed', metadata: { exit: 0 } });
});
it('Pi preserves images/text and returns an error with the same generic diagnostics', async () => {
  process.env.ENKI_EXECUTION_FEEDBACK_MODULE = fileURLToPath(new URL('../src-tauri/resources/browser/execution-feedback.mjs', import.meta.url));
  const handlers: Record<string, (event: any) => Promise<any>> = {};
  gate({ on: (name: string, handler: any) => { handlers[name] = handler; } } as never);
  const content = [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'log\n\nCommand timed out after 1.5 seconds' }];
  const event = { toolName: 'bash', content, isError: true };
  const result = await handlers.tool_result(event);
  expect(result?.isError).toBe(true);
  expect(result.content.slice(0, 2)).toEqual(content);
  expect(content).toHaveLength(2);
  expect(result.content[2].text).toBe(executionFeedback('pi', 'bash', content[1].text, true)?.message);
  expect(await handlers.tool_result({ ...event, isError: false })).toBeUndefined();
});
it('a missing diagnostic module cannot affect permission policy or normal tool results', async () => {
  process.env.ENKI_EXECUTION_FEEDBACK_MODULE = '/missing/enki-feedback.mjs';
  const handlers: Record<string, (event: any, context?: any) => Promise<any>> = {};
  gate({ on: (name: string, handler: any) => { handlers[name] = handler; } } as never);
  expect(await handlers.tool_result({ toolName: 'bash', content: [], isError: false })).toBeUndefined();
  expect(await handlers.tool_call({ toolName: 'bash', input: {} }, { ui: { confirm: async () => false } })).toMatchObject({ block: true });
});
it('refreshed guidance and old v2 histories stay hidden only in their own session', () => {
  for (const block of [legacyV2ToolWorkflowReminder('own'), toolWorkflowReminder('own')]) {
    expect(visiblePromptText('request\n\n' + block, 'own')).toBe('request');
    expect(visiblePromptText('request\n\n' + block, 'other')).toBe('request\n\n' + block);
    expect(visiblePromptText('quote:' + block, 'own')).toBe('quote:' + block);
  }
});
