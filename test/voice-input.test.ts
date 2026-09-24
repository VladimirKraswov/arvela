// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_PREFS } from "../src/state/prefs";
import { captureErrorMessage } from "../src/voice/captureError";

const fake = vi.hoisted(() => ({
  state: {} as any, setUi: vi.fn(), appendDictation: vi.fn(), transcribe: vi.fn(),
}));
vi.mock("../src/state/store", () => ({ store: fake }));
vi.mock("../src/voice/asr", async (original) => ({
  ...await original<typeof import("../src/voice/asr")>(), transcribeAudio: fake.transcribe,
}));
import { VoiceInput } from "../src/components/VoiceInput";

let root: Root;
let resume: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, capture: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.state = { prefs: structuredClone(DEFAULT_PREFS), activeSessionId: "session", directory: "/tmp" };
  resume = vi.fn().mockResolvedValue(undefined); close = vi.fn().mockResolvedValue(undefined); capture = vi.fn();
  vi.stubGlobal("AudioContext", class { resume = resume; close = close; });
  vi.stubGlobal("MediaRecorder", class {});
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: capture } });
  const node = document.createElement("div"); document.body.append(node);
  root = createRoot(node); act(() => root.render(createElement(VoiceInput, { disabled: false })));
});
afterEach(() => {
  act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals();
});
async function click(label: string) {
  await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
}
it("explains native permission refusal without exposing the raw WebKit error or contacting ASR", async () => {
  capture.mockRejectedValue(new DOMException("The request is not allowed by the user agent", "NotAllowedError"));
  await click("Надиктовать");
  const alert = document.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Конфиденциальность и безопасность → Микрофон");
  expect(alert.textContent).toContain("Если доступ уже включён");
  expect(alert.textContent).not.toContain("user agent");
  expect(close).toHaveBeenCalled(); expect(fake.transcribe).not.toHaveBeenCalled();
  expect(document.querySelector('button[aria-label="Надиктовать"]')).not.toBeNull();
  await click("Закрыть ошибку микрофона");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it("does not request microphone permission after cancellation during audio startup", async () => {
  let finish!: () => void;
  resume.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  await click("Надиктовать"); await click("Отменить диктовку");
  await act(async () => finish());
  expect(capture).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
  expect(fake.transcribe).not.toHaveBeenCalled();
});
it("stops a late granted microphone stream after cancellation without transcription", async () => {
  let finish!: (stream: any) => void;
  capture.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const stop = vi.fn();
  await click("Надиктовать"); await click("Отменить диктовку");
  await act(async () => finish({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce(); expect(fake.transcribe).not.toHaveBeenCalled();
  expect(fake.appendDictation).not.toHaveBeenCalled();
});
it("distinguishes missing and unavailable devices from permission errors", () => {
  expect(captureErrorMessage({ name: "NotFoundError" })).toContain("Микрофон не найден");
  expect(captureErrorMessage({ name: "NotReadableError" })).toContain("занято ли оно");
  expect(captureErrorMessage({ name: "AbortError" })).toContain("прерван");
  expect(captureErrorMessage(new Error("private raw details"))).not.toContain("private raw details");
});
