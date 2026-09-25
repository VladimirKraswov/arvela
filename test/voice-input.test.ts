// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEFAULT_PREFS } from "../src/state/prefs";
import { captureErrorMessage } from "../src/voice/captureError";
import { resetPlatformCache } from "../src/native/platform";

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
  // The permission hint is host-specific; pin macOS so the assertion is exact.
  resetPlatformCache();
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", mediaDevices: { getUserMedia: capture } });
  const node = document.createElement("div"); document.body.append(node);
  root = createRoot(node); act(() => root.render(createElement(VoiceInput, { disabled: false })));
});
afterEach(() => {
  act(() => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPlatformCache();
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
  expect(close).not.toHaveBeenCalled(); expect(fake.transcribe).not.toHaveBeenCalled();
  expect(document.querySelector('button[aria-label="Надиктовать"]')).not.toBeNull();
  await click("Закрыть ошибку микрофона");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it("records and transcribes even when Web Audio never resumes", async () => {
  const stop = vi.fn();
  capture.mockResolvedValue({ getTracks: () => [{ stop }] });
  resume.mockReturnValue(new Promise<void>(() => {}));
  vi.stubGlobal("AudioContext", class {
    resume = resume; close = close;
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 48, getByteTimeDomainData: (data: Uint8Array) => data.fill(128) }; }
    createMediaStreamSource() { return { connect: () => {} }; }
  });
  const started = vi.fn();
  vi.stubGlobal("MediaRecorder", class {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm";
    onstop: (() => void) | null = null;
    start() { this.state = "recording"; started(); }
    stop() { this.state = "inactive"; this.onstop?.(); }
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillStyle: "",
  } as unknown as CanvasRenderingContext2D);
  fake.transcribe.mockResolvedValue("распознано");
  await click("Надиктовать");
  expect(capture).toHaveBeenCalledOnce();
  expect(started).toHaveBeenCalledOnce();
  expect(document.querySelector('button[aria-label="Закончить и распознать"]')).not.toBeNull();
  await click("Закончить и распознать");
  expect(fake.transcribe).toHaveBeenCalledOnce();
  expect(fake.appendDictation).toHaveBeenCalledWith(expect.any(String), expect.any(String), "распознано");
  expect(stop).toHaveBeenCalledOnce();
});
it("keeps the composer in recording layout until cancellation completes", async () => {
  const onActiveChange = vi.fn();
  act(() => root.render(createElement(VoiceInput, { disabled: false, onActiveChange })));
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  let finish!: (stream: any) => void;
  capture.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await click("Надиктовать");
  expect(onActiveChange).toHaveBeenLastCalledWith(true);
  expect(document.querySelector('.voice-recording[aria-label="Надиктовка"]')).not.toBeNull();
  expect(document.querySelector('button[aria-label="Отменить диктовку"]')).not.toBeNull();
  await click("Отменить диктовку");
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  const stop = vi.fn();
  await act(async () => finish({ getTracks: () => [{ stop }] }));
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  expect(capture).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
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
it("names the host's own permission location instead of assuming macOS", () => {
  const denied = { name: "NotAllowedError" };
  expect(captureErrorMessage(denied, "macos")).toContain("Конфиденциальность и безопасность → Микрофон");
  expect(captureErrorMessage(denied, "linux")).toContain("xdg-desktop-portal");
  expect(captureErrorMessage(denied, "windows")).toContain("Параметры → Конфиденциальность");
  for (const host of ["macos", "linux", "windows", "other"] as const)
    expect(captureErrorMessage(denied, host)).toContain("Если доступ уже включён");
});
it("distinguishes missing and unavailable devices from permission errors", () => {
  expect(captureErrorMessage({ name: "NotFoundError" })).toContain("Микрофон не найден");
  expect(captureErrorMessage({ name: "NotReadableError" })).toContain("занято ли оно");
  expect(captureErrorMessage({ name: "AbortError" })).toContain("прерван");
  expect(captureErrorMessage(new Error("private raw details"))).not.toContain("private raw details");
});
