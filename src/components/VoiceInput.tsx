import { useEffect, useRef, useState } from "react";
import { store } from "../state/store";
import { draftKey } from "../state/prefs";
import { defaultAsr, transcribeAudio, validateAsr } from "../voice/asr";
import { captureErrorMessage, micUnavailableMessage } from "../voice/captureError";
import { Icon } from "./Icon";

export function VoiceInput({ disabled, onActiveChange }: { disabled: boolean; onActiveChange?: (active: boolean) => void }) {
  const [phase, setPhase] = useState<
    "idle" | "requesting" | "recording" | "transcribing"
  >("idle");
  const [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0);
  useEffect(() => onActiveChange?.(phase !== "idle"), [phase, onActiveChange]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const operation = useRef(0),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    frame = useRef(0),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    cancel = useRef<AbortController | null>(null);
  const cleanup = () => {
    cancelAnimationFrame(frame.current);
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
  };
  const abort = () => {
    operation.current++;
    cancel.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    cleanup();
    setPhase("idle");
  };
  useEffect(
    () => () => {
      operation.current++;
      cancel.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      cleanup();
    },
    [],
  );
  const start = async () => {
    const s = store.state,
      settings = { ...(s.prefs.asr ?? defaultAsr) },
      problem = validateAsr(settings);
    if (problem) {
      setError(problem);
      store.setUi({ settingsOpen: true });
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        micUnavailableMessage(),
      );
      return;
    }
    const epoch = ++operation.current,
      key = draftKey(s.activeSessionId, s.directory),
      endpoint = s.prefs.endpoint;
    setError("");
    setPhase("requesting");
    setSeconds(0);
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (epoch !== operation.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      // WebKit can leave AudioContext.resume() pending indefinitely. Sound
      // visualization is optional and must never block the actual recorder.
      let analyser: AnalyserNode | null = null;
      try {
        const audio = new AudioContext();
        context.current = audio;
        analyser = audio.createAnalyser();
        analyser.fftSize = 256;
        audio.createMediaStreamSource(input).connect(analyser);
        void audio.resume().catch(() => {});
      } catch {
        void context.current?.close().catch(() => {});
        context.current = null;
      }
      const data = new Uint8Array(analyser?.frequencyBinCount ?? 0),
        history = Array<number>(48).fill(0);
      const draw = () => {
        if (epoch !== operation.current) return;
        analyser?.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        history.push(data.length ? Math.min(1, Math.sqrt(sum / data.length) * 5) : 0);
        history.shift();
        const el = canvas.current,
          ctx = el?.getContext("2d");
        if (el && ctx) {
          ctx.clearRect(0, 0, el.width, el.height);
          ctx.fillStyle = getComputedStyle(el).color;
          history.forEach((v, i) => {
            const h = Math.max(3, v * el.height);
            ctx.beginPath();
            ctx.roundRect(i * 6, (el.height - h) / 2, 3, h, 2);
            ctx.fill();
          });
        }
        frame.current = requestAnimationFrame(draw);
      };
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(
        input,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onerror = () => {
        if (epoch === operation.current) {
          abort();
          setError("Запись прервана. Проверьте микрофон.");
        }
      };
      rec.onstop = async () => {
        if (epoch !== operation.current) return;
        cleanup();
        setPhase("transcribing");
        const controller = new AbortController();
        cancel.current = controller;
        try {
          const text = await transcribeAudio(
            new Blob(chunks, { type: rec.mimeType }),
            settings,
            controller.signal,
          );
          if (epoch === operation.current)
            store.appendDictation(endpoint, key, text);
        } catch (e) {
          if (epoch === operation.current)
            setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (epoch === operation.current) setPhase("idle");
        }
      };
      rec.start(250);
      setPhase("recording");
      draw();
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 120 && rec.state === "recording") rec.stop();
      }, 250);
    } catch (e) {
      if (epoch === operation.current) {
        cleanup();
        setPhase("idle");
        setError(captureErrorMessage(e));
      }
    }
  };
  return (
    <div className="voice-control">
      {error && (
        <div className="voice-error" role="alert">
          {error}
          <button
            onClick={() => setError("")}
            aria-label="Закрыть ошибку микрофона"
          >
            ×
          </button>
        </div>
      )}
      {phase === "idle" ? (
        <button
          className="icon-btn"
          title="Надиктовать"
          aria-label="Надиктовать"
          disabled={disabled}
          onClick={() => void start()}
        >
          <Icon name="mic" />
        </button>
      ) : (
        <div className="voice-recording" role="status" aria-label="Надиктовка">
          <button
            className="voice-cancel icon-btn"
            aria-label="Отменить диктовку"
            title="Отменить диктовку"
            onClick={abort}
          >
            <Icon name="close" />
          </button>
          {phase === "recording" ? (
            <>
              <canvas
                width="288"
                height="32"
                ref={canvas}
                aria-label="Уровень звука микрофона"
              />
              <span className="voice-timer">
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, "0")}
              </span>
              <button
                className="voice-finish icon-btn"
                aria-label="Закончить и распознать"
                title="Закончить и распознать"
                onClick={() => recorder.current?.stop()}
              >
                <Icon name="stop" size={14} />
              </button>
            </>
          ) : (
            <span>
              {phase === "requesting" ? "Доступ к микрофону…" : "Распознаю…"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
