import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ConnectionError,
  DEFAULT_BASE_URL,
  OpenCodeClient,
  isAllowedBaseUrl,
  normalizeBaseUrl,
} from "../src/api/client";
import { eventStreamUrl } from "../src/api/events";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("endpoint safety", () => {
  it("accepts plain-HTTP loopback endpoints only", () => {
    expect(isAllowedBaseUrl("http://127.0.0.1:4096")).toBe(true);
    expect(isAllowedBaseUrl("http://localhost:3000")).toBe(true);
    expect(isAllowedBaseUrl("http://[::1]:4096")).toBe(true);
    expect(isAllowedBaseUrl("http://127.0.0.1:0")).toBe(false);
    expect(isAllowedBaseUrl("https://127.0.0.1:4096")).toBe(false);
    expect(isAllowedBaseUrl("http://example.com")).toBe(false);
    expect(isAllowedBaseUrl("http://10.0.0.5:4096")).toBe(false);
    expect(isAllowedBaseUrl("not a url")).toBe(false);
    expect(isAllowedBaseUrl("file:///etc/passwd")).toBe(false);
  });

  it("falls back to the default endpoint instead of trusting invalid input", () => {
    expect(normalizeBaseUrl("  http://127.0.0.1:4096/  ")).toBe(
      "http://127.0.0.1:4096",
    );
    expect(normalizeBaseUrl("http://evil.example.com")).toBe(DEFAULT_BASE_URL);
  });

  it("converts the http endpoint to a loopback ws:// URL for PTY streams", () => {
    const client = new OpenCodeClient(DEFAULT_BASE_URL);
    const url = client.ptySocketUrl("pty_1", "/tmp/proj");
    expect(url.startsWith("ws://127.0.0.1:4096/pty/pty_1/connect?")).toBe(true);
    expect(decodeURIComponent(url)).toContain("directory=/tmp/proj");
  });

  it("scopes the SSE URL to the selected directory", () => {
    expect(
      decodeURIComponent(eventStreamUrl("http://127.0.0.1:4096", "/tmp/proj")),
    ).toBe("http://127.0.0.1:4096/event?directory=/tmp/proj");
    expect(eventStreamUrl("http://127.0.0.1:4096", null)).toBe(
      "http://127.0.0.1:4096/event",
    );
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenCodeClient transport", () => {
  it("sends scoped directory query and JSON body for prompts", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }),
    );
    const client = new OpenCodeClient();
    await client.prompt("ses_1", "/tmp/proj", {
      model: { providerID: "anthropic", modelID: "claude" },
      parts: [{ type: "text", text: "hi" }],
    });
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(calls[0].url)).toBe(
      "http://127.0.0.1:4096/session/ses_1/prompt_async?directory=/tmp/proj",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: { providerID: "anthropic" },
    });
  });

  it("requires the mandatory diff mode on /vcs/diff (1.18.18 rejects requests without it)", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return jsonResponse(200, []);
      }),
    );
    const client = new OpenCodeClient();
    await client.vcsDiff("/tmp/proj");
    expect(decodeURIComponent(urls[0])).toBe(
      "http://127.0.0.1:4096/vcs/diff?directory=/tmp/proj&mode=git",
    );
    await client.vcsDiff("/tmp/proj", { mode: "branch", context: 3 });
    expect(decodeURIComponent(urls[1])).toBe(
      "http://127.0.0.1:4096/vcs/diff?directory=/tmp/proj&mode=branch&context=3",
    );
  });

  it("surfaces API error details from JSON and plain bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { message: "model not found" })),
    );
    const client = new OpenCodeClient();
    await expect(
      client.prompt("ses_x", "/tmp", {
        model: { providerID: "p", modelID: "m" },
        parts: [],
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      detail: "model not found",
    });
  });

  it("maps unreachable servers to ConnectionError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const client = new OpenCodeClient("http://127.0.0.1:59999");
    await expect(client.health()).rejects.toBeInstanceOf(ConnectionError);
  });

  it("honours caller cancellation without turning it into a connection failure", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new DOMException("stop", "AbortError"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        await new Promise((_, rej) =>
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("Aborted", "AbortError")),
          ),
        );
        return jsonResponse(200, {});
      }),
    );
    const client = new OpenCodeClient();
    await expect(client.health(ctrl.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("parses health and normalizes sessions on the way out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { healthy: true, version: "1.18.18" }),
      ),
    );
    const client = new OpenCodeClient();
    await expect(client.health()).resolves.toMatchObject({
      healthy: true,
      version: "1.18.18",
    });
  });

  it("rejects unexpected 204 on JSON endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const client = new OpenCodeClient();
    await expect(client.health()).rejects.toBeInstanceOf(ApiError);
  });
});

it("uses the documented PTY CSRF header and ticket field; 403 is never silently retried", async () => {
  const fetcher = vi.fn(async () =>
    jsonResponse(200, { ticket: "short-lived-test", expires_in: 30 }),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = new OpenCodeClient();
  expect(await client.ptyConnectToken("pty_test", "/test")).toEqual({
    token: "short-lived-test",
    rejected: false,
  });
  expect((fetcher.mock.calls as any)[0][1].headers).toMatchObject({
    "x-opencode-ticket": "1",
  });
  fetcher.mockResolvedValue(
    jsonResponse(403, { message: "Invalid PTY connect token request" }),
  );
  await expect(
    client.ptyConnectToken("pty_test", "/test"),
  ).rejects.toMatchObject({ status: 403 });
});
it("rejects credentials, paths, queries and fragments in endpoint origins", () => {
  for (const url of [
    "http://user:secret@localhost:4096",
    "http://localhost:4096/other",
    "http://localhost:4096?x=1",
    "http://localhost:4096#frag",
  ])
    expect(isAllowedBaseUrl(url)).toBe(false);
});

it("returns the server-provided opaque history cursor rather than inventing a message-ID cursor", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", {
          headers: {
            "content-type": "application/json",
            "x-next-cursor": "opaque-cursor-from-server",
          },
        }),
    ),
  );
  const page = await new OpenCodeClient().messages("ses_test", {
    directory: "/test",
    limit: 200,
  });
  expect(page.before).toBe("opaque-cursor-from-server");
});

it("loads root recent sessions across projects with archive mode and cursor pagination", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: "ses_recent", directory: "/work/b", title: "Recent", time: { created: 1, updated: 456 } }]), { headers: { "content-type": "application/json", "x-next-cursor": "456" } }));
  vi.stubGlobal("fetch", fetcher);
  const result = await new OpenCodeClient().recentSessions(true, 789);
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.pathname).toBe("/experimental/session");
  expect(Object.fromEntries(url.searchParams)).toEqual({ roots: "true", archived: "true", limit: "20", cursor: "789" });
  expect(result.cursor).toBe(456); expect(result.sessions[0].id).toBe("ses_recent");
});


it("retains the parent request ID needed to associate a preparation answer with its prompt", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, [{
    info: { id: "msg_answer", sessionID: "ses_fork", role: "assistant", parentID: "msg_request", finish: "stop", time: { created: 1, completed: 2 } },
    parts: [{ id: "part_answer", messageID: "msg_answer", sessionID: "ses_fork", type: "text", text: "handoff" }],
  }])));
  const page = await new OpenCodeClient().messages("ses_fork", { directory: "/fixture" });
  expect(page.messages[0].info).toMatchObject({ parentID: "msg_request", finish: "stop", time: { completed: 2 } });
});

it("reports a malformed body as an API fault, not as an unreachable server", async () => {
  // A 200 with broken JSON is an API incompatibility. Calling it "cannot reach
  // the server" sent the user to check the connection instead of the version.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response("<html>proxy error</html>", {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  const error = await new OpenCodeClient()
    .projects()
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).not.toBeInstanceOf(ConnectionError);
  expect((error as ApiError).message).toContain("malformed response");
});

it("decodes nested OpenCode errors without dumping their payload or losing the reference", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, {
    name: "UnknownError", data: { message: "Unexpected server error.", ref: "err_abc123", secret: "DO_NOT_DISPLAY" },
  })));
  await expect(new OpenCodeClient().sessionStatuses("/test/A")).rejects.toMatchObject({
    status: 500, detail: "Unexpected server error. (err_abc123)", filesystemDenied: false,
  });
});
