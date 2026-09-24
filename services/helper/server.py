"""CPU-only, private file conversion service for OpenCode Desktop.

No user file is retained. Only the Proxmox host may call the service; Desktop
reaches it through an authenticated loopback SSH tunnel. All tools are bounded.
"""
from __future__ import annotations

import base64
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.1.0"
MAX_INPUT = 50 * 1024 * 1024
MAX_TEXT = 750_000
MAX_FRAMES = 12
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 120
ALLOWED_CLIENT = os.environ.get("HELPER_ALLOWED_CLIENT", "192.168.31.2")
LIMIT = threading.BoundedSemaphore(2)


def run(*args: str, timeout: int = MAX_SECONDS) -> bytes:
    process = subprocess.run(args, capture_output=True, timeout=timeout, check=True)
    return process.stdout


def encoded(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def pages(path: Path, directory: Path) -> tuple[str, list[dict], list[str]]:
    info = run("pdfinfo", str(path), timeout=15).decode("utf-8", "replace")
    count = next((int(line.split(":", 1)[1]) for line in info.splitlines() if line.startswith("Pages:")), 0)
    if count < 1 or count > 2000:
        raise ValueError("PDF не содержит страниц или число страниц слишком велико")
    raw = run("pdftotext", "-layout", "-enc", "UTF-8", str(path), "-", timeout=90)
    text = raw.decode("utf-8", "replace")[:MAX_TEXT]
    numbers = list(range(1, count + 1)) if count <= MAX_FRAMES else sorted({1, count, *(1 + round(i * (count - 1) / (MAX_FRAMES - 1)) for i in range(MAX_FRAMES))})
    images = []
    ocr = []
    for number in numbers:
        prefix = directory / f"page-{number}"
        run("pdftoppm", "-f", str(number), "-l", str(number), "-scale-to", "1440", "-jpeg", "-singlefile", str(path), str(prefix), timeout=35)
        jpg = prefix.with_suffix(".jpg")
        if jpg.stat().st_size > 1_500_000:
            raise ValueError("Страница PDF слишком велика после преобразования")
        images.append({"label": f"Страница {number}/{count}", "mime": "image/jpeg", "data": encoded(jpg)})
        if len(text.strip()) < 100:
            try:
                ocr.append(f"Страница {number}:\n" + run("tesseract", str(jpg), "stdout", "-l", "rus+eng", timeout=30).decode("utf-8", "replace"))
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
    if not text.strip():
        text = "\n\n".join(ocr)[:MAX_TEXT]
    notes = []
    if count > MAX_FRAMES:
        notes.append(f"PDF: показаны {len(images)} страниц из {count}; текст извлечён из всего документа с лимитом {MAX_TEXT} символов")
    if len(raw) > MAX_TEXT:
        notes.append("Длинный текст PDF усечён до лимита контекста")
    return text, images, notes


def audio_chunks(path: Path, directory: Path) -> list[dict]:
    duration_json = json.loads(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path), timeout=15))
    duration = float(duration_json.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0 or duration > 4 * 3600:
        raise ValueError("Длительность аудио должна быть не больше 4 часов")
    result = []
    for i, start in enumerate(range(0, math.ceil(duration), 300)):
        output = directory / f"audio-{i}.m4a"
        run("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "2", "-ss", str(start), "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", "-t", "300", "-y", str(output), timeout=90)
        if not output.exists() or not output.stat().st_size:
            break
        if output.stat().st_size > MAX_AUDIO_BYTES:
            raise ValueError("Фрагмент звука превышает 25 МБ")
        result.append({"label": f"{start // 60}:00", "mime": "audio/mp4", "data": encoded(output)})
    return result


def video(path: Path, directory: Path) -> tuple[list[dict], list[dict], list[str]]:
    info = json.loads(run("ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path), timeout=15))
    duration = float(info.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0 or duration > 4 * 3600:
        raise ValueError("Длительность видео должна быть не больше 4 часов")
    if not any(stream.get("codec_type") == "video" for stream in info.get("streams", [])):
        raise ValueError("В файле нет видеодорожки")
    times = sorted({round(min(max(0.0, duration - 0.1), (i + .5) * duration / MAX_FRAMES), 3) for i in range(MAX_FRAMES)})
    frames = []
    for i, second in enumerate(times):
        output = directory / f"frame-{i}.jpg"
        run("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "2", "-ss", str(second), "-i", str(path), "-frames:v", "1", "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease", "-q:v", "4", "-y", str(output), timeout=30)
        if not output.exists() or not output.stat().st_size:
            continue
        if output.stat().st_size > 1_500_000:
            raise ValueError("Кадр слишком велик после преобразования")
        frames.append({"label": f"{second:.1f} с", "mime": "image/jpeg", "data": encoded(output)})
    if not frames:
        raise ValueError("Не удалось извлечь кадры видео")
    sound = audio_chunks(path, directory) if any(stream.get("codec_type") == "audio" for stream in info.get("streams", [])) else []
    return frames, sound, [f"Видео {duration:.1f} с: {len(frames)} кадров, {len(sound)} аудиофрагментов"]


def convert(kind: str, content: bytes) -> dict:
    if kind not in {"pdf", "audio", "video"}:
        raise ValueError("Неизвестный вид преобразования")
    with tempfile.TemporaryDirectory(prefix="oc-helper-") as tmp:
        directory = Path(tmp)
        path = directory / ("source.pdf" if kind == "pdf" else "source.bin")
        path.write_bytes(content)
        if kind == "pdf":
            if not content.startswith(b"%PDF-"):
                raise ValueError("Содержимое не является PDF")
            text, images, notes = pages(path, directory)
            return {"kind": kind, "text": text, "images": images, "audio": [], "notes": notes}
        if kind == "audio":
            return {"kind": kind, "text": "", "images": [], "audio": audio_chunks(path, directory), "notes": []}
        images, audio, notes = video(path, directory)
        return {"kind": kind, "text": "", "images": images, "audio": audio, "notes": notes}


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenCodeHelper/" + VERSION
    def do_OPTIONS(self):
        if not self.authorized(): return
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Kind")
        self.end_headers()

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in {"tauri://localhost", "http://tauri.localhost", "http://localhost:1425", "http://127.0.0.1:1425"}:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def reply(self, status: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        if self.client_address[0] == ALLOWED_CLIENT:
            return True
        self.reply(403, {"error": "Этот сервис доступен только через защищённый туннель"})
        return False

    def do_GET(self):
        if not self.authorized(): return
        if self.path == "/health":
            self.reply(200, {"ok": True, "version": VERSION, "services": ["pdf", "audio", "video"], "maxInputBytes": MAX_INPUT})
        else:
            self.reply(404, {"error": "Не найдено"})

    def do_POST(self):
        if not self.authorized(): return
        if self.path != "/v1/convert":
            self.reply(404, {"error": "Не найдено"}); return
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            size = -1
        if size < 1 or size > MAX_INPUT:
            self.reply(413, {"error": "Файл должен быть непустым и не больше 50 МБ"}); return
        if not LIMIT.acquire(blocking=False):
            self.reply(429, {"error": "Сервис занят, повторите позже"}); return
        try:
            content = self.rfile.read(size)
            if len(content) != size: raise ValueError("Файл передан не полностью")
            self.reply(200, convert(self.headers.get("X-Kind", ""), content))
        except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as error:
            self.reply(422, {"error": str(error) if isinstance(error, ValueError) else "Не удалось преобразовать файл"})
        finally:
            LIMIT.release()


if __name__ == "__main__":
    host = os.environ.get("HELPER_BIND", "0.0.0.0")
    ThreadingHTTPServer((host, 8080), Handler).serve_forever()
