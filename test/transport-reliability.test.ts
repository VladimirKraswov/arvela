import { afterEach, expect, it, vi } from 'vitest';
import { runEventStream } from '../src/api/events';
import { ConnectionError, OpenCodeClient } from '../src/api/client';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('backs off repeated immediate EOFs rather than resetting on HTTP headers', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const controller = new AbortController(), attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => { attempts.push(Date.now()); return new Response(''); }));
  const operation = runEventStream({ url: 'http://localhost/event', signal: controller.signal, onEvent: () => {},
    onState: state => { if (state === 'open' && attempts.length === 4) controller.abort(); },
  });
  await vi.runAllTimersAsync();
  await operation;
  expect(attempts).toEqual([0, 2000, 6000, 14000]);
  vi.restoreAllMocks();
});

it('does not deliver buffered events after the subscription is cancelled', async () => {
  const controller = new AbortController();
  const received: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"first"}\n\ndata: {"type":"stale"}\n\n')));
  await runEventStream({ url: 'http://localhost/event', signal: controller.signal, onState: () => {},
    onEvent: event => { received.push(event.type); controller.abort(); },
  });
  expect(received).toEqual(['first']);
});

it('cancels and releases an idle stream reader on subscription disposal', async () => {
  const controller = new AbortController();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { source = c; }, cancel });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  const state = vi.fn();
  const operation = runEventStream({ url: 'http://localhost/event', signal: controller.signal, onState: state, onEvent: () => {} });
  await vi.waitFor(() => expect(body.locked).toBe(true));
  controller.abort();
  try {
    await vi.waitFor(() => expect(state).toHaveBeenCalledWith('closed'), { timeout: 200 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  } finally {
    if (!cancel.mock.calls.length) source.close();
    await operation;
  }
});

it('reports subscriber failure so reconnect can resynchronize instead of silently losing an event', async () => {
  const controller = new AbortController();
  const errors: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"type":"first"}\n\n')));
  await runEventStream({ url: 'http://localhost/event', signal: controller.signal,
    onEvent: () => { throw new Error('reducer failure'); },
    onState: (state, detail) => {
      if (state === 'error') errors.push(detail ?? '');
      if (state === 'error' || (state === 'reconnecting' && detail)) controller.abort();
    },
  });
  expect(errors).toEqual(['reducer failure']);
});

it('reports malformed frames without exposing their contents', async () => {
  const controller = new AbortController(), errors: string[] = [];
  const event = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: private invalid payload\n\n')));
  await runEventStream({ url: 'http://localhost/event', signal: controller.signal, onEvent: event,
    onState: (state, detail) => { if (state === 'error') { errors.push(detail ?? ''); controller.abort(); } },
  });
  expect(errors).toEqual(['Invalid event stream JSON']);
  expect(event).not.toHaveBeenCalled();
});

it.each(['timeout', 'cancel'] as const)('classifies %s while reading the response body correctly', async kind => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => ({
    ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      if (kind === 'cancel') controller.abort(new DOMException('Caller cancelled', 'AbortError'));
    }),
  })));
  const request = new OpenCodeClient('http://localhost:4096', 10).request('GET', '/fixture', { signal: controller.signal });
  if (kind === 'cancel') await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  else await expect(request).rejects.toBeInstanceOf(ConnectionError);
});
