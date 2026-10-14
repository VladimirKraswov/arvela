import { expect, it } from 'vitest';
import { SseDecoder } from '../src/api/sse';

it('decodes split CRLF, standalone CR, comments and multiline data', () => {
  const decoder = new SseDecoder();
  const events: string[] = [];
  for (const chunk of [': heartbeat\r', '\ndata: first\r', '\ndata: second\r\r', 'data: third\n\n'])
    decoder.push(chunk, data => { events.push(data); return true; });
  expect(events).toEqual(['first\nsecond', 'third']);
});
it('bounds each event rather than discarding valid frames in a large transport chunk', () => {
  const decoder = new SseDecoder(20), events: string[] = [];
  decoder.push('data: value\n\n'.repeat(100), data => { events.push(data); return true; });
  expect(events).toHaveLength(100);
});
it('fails an oversized unfinished frame explicitly and never publishes its suffix', () => {
  const decoder = new SseDecoder(20);
  expect(() => decoder.push('data: ' + 'x'.repeat(21), () => { throw Error('must not dispatch'); })).toThrow('size limit');
});
