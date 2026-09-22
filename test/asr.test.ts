import { afterEach, expect, it, vi } from "vitest";
import {
  defaultAsr,
  getAsrKey,
  setAsrKey,
  transcribeAudio,
  validateAsr,
} from "../src/voice/asr";
afterEach(() => vi.unstubAllGlobals());
it("validates exact ASR endpoint and prevents key reuse at another host", () => {
  expect(validateAsr(defaultAsr)).toBeTruthy();
  expect(
    validateAsr({
      ...defaultAsr,
      endpoint: "http://192.168.31.71:8000/v1/audio/transcriptions",
    }),
  ).toBeNull();
  expect(
    validateAsr({
      ...defaultAsr,
      endpoint: "http://external.example/v1/audio/transcriptions",
    }),
  ).toBeTruthy();
  expect(
    validateAsr({
      ...defaultAsr,
      endpoint: "https://user:secret@api.example/v1/audio/transcriptions",
    }),
  ).toBeTruthy();
  setAsrKey("https://a.example/v1/audio/transcriptions", "secret");
  expect(getAsrKey("https://b.example/v1/audio/transcriptions")).toBe("");
});
it("posts audio as multipart and parses text, without leaking the key into persisted settings", async () => {
  vi.stubGlobal("window", {});
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ text: " Привет " }) });
  vi.stubGlobal("fetch", fetch);
  const settings = {
    ...defaultAsr,
    endpoint: "https://a.example/v1/audio/transcriptions",
  };
  setAsrKey(settings.endpoint, "fixture-key");
  expect(
    await transcribeAudio(
      new Blob(["test"], { type: "audio/mp4" }),
      settings,
      new AbortController().signal,
    ),
  ).toBe("Привет");
  const req = fetch.mock.calls[0][1];
  expect(req.body.get("model")).toBe("whisper-1");
  expect(req.body.get("file").name).toBe("dictation.m4a");
  expect(req.headers.Authorization).toBe("Bearer fixture-key");
  expect(JSON.stringify(settings)).not.toContain("fixture-key");
});
it("rejects empty recordings, canceled requests and missing transcript", async () => {
  vi.stubGlobal("window", {});
  const settings = {
    ...defaultAsr,
    endpoint: "https://a.example/v1/audio/transcriptions",
  };
  await expect(
    transcribeAudio(new Blob([]), settings, new AbortController().signal),
  ).rejects.toThrow("пуста");
  const c = new AbortController();
  c.abort();
  await expect(
    transcribeAudio(new Blob(["x"]), settings, c.signal),
  ).rejects.toThrow("Отменено");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  await expect(
    transcribeAudio(new Blob(["x"]), settings, new AbortController().signal),
  ).rejects.toThrow("не вернул");
});
