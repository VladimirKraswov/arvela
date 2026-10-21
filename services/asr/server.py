#!/usr/bin/env python3
"""Small localhost HTTP service for persistent CPU-only GigaAM inference."""

from __future__ import annotations

import base64
import binascii
import json
import os
import subprocess
import threading
import time
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import transcribe_cpp


MODEL_PATH = os.environ.get(
    "GIGAAM_MODEL",
    "/Volumes/Extend/asr/gigaam-v3-e2e-rnnt-Q8_0.gguf",
)
HOST = os.environ.get("GIGAAM_HOST", "127.0.0.1")
PORT = int(os.environ.get("GIGAAM_PORT", "18081"))
THREADS = int(os.environ.get("GIGAAM_THREADS", "8"))
MAX_AUDIO_SECONDS = float(os.environ.get("GIGAAM_MAX_AUDIO_SECONDS", "600"))
CHUNK_SECONDS = float(os.environ.get("GIGAAM_CHUNK_SECONDS", "24"))
LEADING_PAD_SECONDS = float(os.environ.get("GIGAAM_LEADING_PAD_SECONDS", "0.65"))
TRAILING_PAD_SECONDS = float(os.environ.get("GIGAAM_TRAILING_PAD_SECONDS", "0.20"))
MAX_BODY_BYTES = int(os.environ.get("GIGAAM_MAX_BODY_BYTES", str(48 * 1024 * 1024)))
SAMPLE_RATE = 16_000
F32_BYTES = 4


class ASREngine:
    def __init__(self) -> None:
        started = time.perf_counter()
        self.model = transcribe_cpp.Model(MODEL_PATH, backend="cpu")
        self.lock = threading.Lock()
        self.loaded_seconds = time.perf_counter() - started
        self.arch = self.model.arch
        self.variant = self.model.variant
        self.backend = self.model.backend
        warmup_started = time.perf_counter()
        warmup_audio = b"\x00" * int(1.5 * SAMPLE_RATE) * F32_BYTES
        with self.model.session(n_threads=THREADS) as session:
            session.run(warmup_audio, language="ru", timestamps="none")
        self.warmup_seconds = time.perf_counter() - warmup_started
        print(
            f"GigaAM startup warmup completed in {self.warmup_seconds:.3f}s",
            flush=True,
        )

    def transcribe(self, encoded_audio: bytes) -> dict[str, object]:
        started = time.perf_counter()
        try:
            decoded = subprocess.run(
                [
                    "/usr/bin/ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-nostdin",
                    "-i",
                    "pipe:0",
                    "-map_metadata",
                    "-1",
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-f",
                    "f32le",
                    "pipe:1",
                ],
                input=encoded_audio,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=max(30.0, MAX_AUDIO_SECONDS * 2.0),
            )
        except subprocess.TimeoutExpired as exc:
            raise ValueError("Аудио не удалось декодировать за допустимое время") from exc

        if decoded.returncode != 0:
            detail = decoded.stderr.decode("utf-8", "replace").strip()[-400:]
            raise ValueError(f"FFmpeg не распознал формат аудио: {detail or 'unknown error'}")
        if len(decoded.stdout) % F32_BYTES:
            raise ValueError("Декодер вернул повреждённый PCM-буфер")

        samples = len(decoded.stdout) // F32_BYTES
        audio_seconds = samples / SAMPLE_RATE
        # Progressive dictation can end immediately after a clip boundary.
        # Keep every decoded sample: existing leading/trailing model padding
        # makes a short valid clip safe. Zero decoded samples is an empty result,
        # while actual container/decoder failures still raise above.
        if audio_seconds > MAX_AUDIO_SECONDS + 0.05:
            raise ValueError(
                f"Запись длится {audio_seconds:.1f} с; максимум {MAX_AUDIO_SECONDS:.0f} с"
            )

        decode_seconds = time.perf_counter() - started
        infer_started = time.perf_counter()
        content_seconds = max(
            1.0, CHUNK_SECONDS - LEADING_PAD_SECONDS - TRAILING_PAD_SECONDS
        )
        content_bytes = int(content_seconds * SAMPLE_RATE) * F32_BYTES
        leading_silence = b"\x00" * int(LEADING_PAD_SECONDS * SAMPLE_RATE) * F32_BYTES
        trailing_silence = b"\x00" * int(TRAILING_PAD_SECONDS * SAMPLE_RATE) * F32_BYTES
        raw_chunks = [
            decoded.stdout[offset : offset + content_bytes]
            for offset in range(0, len(decoded.stdout), content_bytes)
        ]
        if len(raw_chunks) > 1 and len(raw_chunks[-1]) < int(0.3 * SAMPLE_RATE) * F32_BYTES:
            raw_chunks[-2] += raw_chunks.pop()
        chunks = [leading_silence + chunk + trailing_silence for chunk in raw_chunks]
        results = []
        with self.lock:
            with self.model.session(n_threads=THREADS) as session:
                for chunk in chunks:
                    results.append(
                        session.run(
                            chunk,
                            language="ru",
                            timestamps="none",
                        )
                    )
        infer_seconds = time.perf_counter() - infer_started
        total_seconds = time.perf_counter() - started
        text = " ".join(result.text.strip() for result in results if result.text.strip())
        return {
            "text": text,
            "language": next((result.language for result in results if result.language), "ru"),
            "duration_seconds": round(audio_seconds, 3),
            "processing_seconds": round(total_seconds, 3),
            "inference_seconds": round(infer_seconds, 3),
            "decode_seconds": round(decode_seconds, 3),
            "realtime_factor": round(audio_seconds / max(total_seconds, 0.001), 2),
            "inference_realtime_factor": round(
                audio_seconds / max(infer_seconds, 0.001), 2
            ),
            "format": "pcm_f32le_16000_mono",
            "model": "GigaAM-v3 e2e RNN-T Q8_0",
            "chunks": len(chunks),
            "leading_padding_seconds": LEADING_PAD_SECONDS,
            "trailing_padding_seconds": TRAILING_PAD_SECONDS,
            "timings": {
                "mel_ms": round(sum(result.timings.mel_ms for result in results), 2),
                "encode_ms": round(
                    sum(result.timings.encode_ms for result in results), 2
                ),
                "decode_ms": round(
                    sum(result.timings.decode_ms for result in results), 2
                ),
            },
        }


ENGINE = ASREngine()


def parse_openai_multipart(body: bytes, content_type: str) -> tuple[bytes, str]:
    """Extract OpenAI Audio API's required `file` and `model` form fields."""
    try:
        envelope = (
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode(
                "ascii"
            )
            + body
        )
    except UnicodeEncodeError as exc:
        raise ValueError("Некорректный multipart Content-Type") from exc
    message = BytesParser(policy=policy.default).parsebytes(envelope)
    if not message.is_multipart():
        raise ValueError("Ожидался multipart/form-data")

    fields = {
        part.get_param("name", header="content-disposition"): part
        for part in message.iter_parts()
        if part.get_param("name", header="content-disposition")
    }
    file_part = fields.get("file")
    if file_part is None:
        raise ValueError("Multipart-поле file обязательно")
    audio = file_part.get_payload(decode=True)
    if not isinstance(audio, bytes) or not audio:
        raise ValueError("Аудиофайл пуст")

    model_part = fields.get("model")
    if model_part is None:
        raise ValueError("Multipart-поле model обязательно")
    model = model_part.get_content()
    if not isinstance(model, str) or not model.strip():
        raise ValueError("Multipart-поле model обязательно")

    return audio, (file_part.get_filename() or "recording.wav")[:240]


class Handler(BaseHTTPRequestHandler):
    server_version = "colibri-gigaam-asr/1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(
            f"{self.log_date_time_string()} {self.client_address[0]} {fmt % args}",
            flush=True,
        )

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") not in {"", "/health"}:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        self._json(
            HTTPStatus.OK,
            {
                "status": "ok",
                "model": "GigaAM-v3 e2e RNN-T Q8_0",
                "arch": ENGINE.arch,
                "variant": ENGINE.variant,
                "backend": ENGINE.backend,
                "threads": THREADS,
                "max_audio_seconds": MAX_AUDIO_SECONDS,
                "chunk_seconds": CHUNK_SECONDS,
                "leading_padding_seconds": LEADING_PAD_SECONDS,
                "trailing_padding_seconds": TRAILING_PAD_SECONDS,
                "loaded_seconds": round(ENGINE.loaded_seconds, 3),
                "warmup_seconds": round(ENGINE.warmup_seconds, 3),
            },
        )

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") not in {
            "/transcribe",
            "/v1/audio/transcriptions",
        }:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "empty_body"})
            return
        if content_length > MAX_BODY_BYTES:
            self._json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "body_too_large", "max_bytes": MAX_BODY_BYTES},
            )
            return

        try:
            body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")
            if content_type.lower().startswith("multipart/form-data"):
                audio, filename = parse_openai_multipart(body, content_type)
            else:
                request = json.loads(body)
                encoded = request.get("audio", "")
                if not isinstance(encoded, str) or not encoded:
                    raise ValueError("Поле audio с base64-данными обязательно")
                if encoded.startswith("data:"):
                    encoded = encoded.split(",", 1)[-1]
                audio = base64.b64decode(encoded, validate=True)
                if not audio:
                    raise ValueError("Аудиофайл пуст")
                filename = str(request.get("filename", "recording.wav"))[:240]
            result = ENGINE.transcribe(audio)
            result["filename"] = filename
            self._json(HTTPStatus.OK, result)
        except (ValueError, TypeError, json.JSONDecodeError, binascii.Error) as exc:
            self._json(
                HTTPStatus.BAD_REQUEST,
                {"error": "invalid_audio", "message": str(exc)},
            )
        except BrokenPipeError:
            return
        except Exception as exc:  # keep the daemon alive and return a useful error
            self._json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "transcription_failed", "message": str(exc)},
            )


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(
        json.dumps(
            {
                "event": "ready",
                "host": HOST,
                "port": PORT,
                "model": MODEL_PATH,
                "backend": ENGINE.backend,
                "threads": THREADS,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    server.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
