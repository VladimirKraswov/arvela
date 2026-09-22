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
