import { expect, it, vi } from "vitest";
import { InputQueue, TEXT_LIMIT_BYTES, type BrowserInput } from "../src/browser/inputQueue";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

it("runs in order and merges only waiting typing/scrolling for the same page", async () => {
  const gate = deferred(), seen: BrowserInput[] = [];
  const queue = new InputQueue(async input => { seen.push(structuredClone(input)); if (seen.length === 1) await gate.promise; });
  const page = { pageId: "p", revision: 1, url: "https://example.com" };
  queue.push({ action: "click", args: { x: 1, y: 2, expected: page } }); // starts immediately
  for (const ch of "hello") queue.push({ action: "text", args: { text: ch, expected: page } });
  queue.push({ action: "wheel", args: { dy: 100, expected: page } });
  queue.push({ action: "wheel", args: { dy: 50, expected: page } });
  queue.push({ action: "text", args: { text: "!", expected: { ...page, revision: 2 } } }); // another page state: not merged
  gate.resolve(); await flush();
  expect(seen.map(i => [i.action, i.args.text ?? i.args.dy ?? i.args.x])).toEqual([
    ["click", 1], ["text", "hello"], ["wheel", 150], ["text", "!"],
  ]);
});

it("never replays a failed action and refuses an unbounded backlog", async () => {
  const gate = deferred();
  const run = vi.fn(async (input: BrowserInput) => { if (input.action === "key") { await gate.promise; throw new Error("rejected"); } });
  const queue = new InputQueue(run, 2);
  expect(queue.push({ action: "key", args: { key: "Enter" } })).toBe(true); // running
  expect(queue.push({ action: "click", args: { x: 1, y: 1 } })).toBe(true);
  expect(queue.push({ action: "click", args: { x: 2, y: 2 } })).toBe(true);
  expect(queue.push({ action: "click", args: { x: 3, y: 3 } })).toBe(false);
  gate.resolve(); await flush();
  expect(run.mock.calls.map(([i]) => i.action)).toEqual(["key", "click", "click"]);
});

it("keeps merged text within the native limit and drops waiting input on clear", async () => {
  const gate = deferred(), seen: BrowserInput[] = [];
  const queue = new InputQueue(async input => { seen.push(input); if (seen.length === 1) await gate.promise; });
  queue.push({ action: "key", args: { key: "Tab" } });
  queue.push({ action: "text", args: { text: "a".repeat(TEXT_LIMIT_BYTES) } });
  queue.push({ action: "text", args: { text: "b" } }); // would exceed the limit: separate action
  queue.clear(); queue.push({ action: "text", args: { text: "c" } });
  gate.resolve(); await flush();
  expect(seen.map(i => i.args.text ?? i.args.key)).toEqual(["Tab", "c"]);
});
