import { expect, it, vi } from "vitest";
import { runEventStream } from "../src/api/events";
it("parses LF and split CRLF events and stops cleanly", async () => {
  const ctrl = new AbortController(),
    events: any[] = [];
  const bytes = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const t of [
                'data: {"type":"a"}\r',
                '\n\r\ndata: {"type":"b"}\n',
                "\n",
              ])
                c.enqueue(bytes.encode(t));
              c.close();
            },
          }),
        ),
    ),
  );
  await runEventStream({
    url: "http://localhost/event",
    signal: ctrl.signal,
    onState: () => {},
    onEvent: (e) => {
      events.push(e);
      if (events.length === 2) ctrl.abort();
    },
  });
  expect(events.map((x) => x.type)).toEqual(["a", "b"]);
  vi.unstubAllGlobals();
});

it("accepts the OpenCode global event envelope with its directory", async () => {
  const ctrl = new AbortController();
  const events: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode(
        'data: {"directory":"/work/a","payload":{"type":"session.status","properties":{"sessionID":"ses_a","status":{"type":"idle"}}}}\n\n',
      ));
      c.close();
    } }),
  )));
  await runEventStream({
    url: "http://localhost/global/event",
    signal: ctrl.signal,
    onState: () => {},
    onEvent: (event) => { events.push(event); ctrl.abort(); },
  });
  expect(events).toEqual([{ directory: "/work/a", payload: {
    type: "session.status", properties: { sessionID: "ses_a", status: { type: "idle" } },
  } }]);
  vi.unstubAllGlobals();
});
