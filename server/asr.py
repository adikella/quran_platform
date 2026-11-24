"""Распознавание чтения Корана: принимает запись, возвращает текст с огласовкой.

Модель: tarteel-ai/whisper-base-ar-quran (Apache 2.0), переведённая в CTranslate2 на сервере:
  ct2-transformers-converter --model tarteel-ai/whisper-base-ar-quran --quantization int8 \
    --output_dir /var/lib/quran-asr/ct2/whisper-base-ar-quran \
    --copy_files tokenizer_config.json preprocessor_config.json normalizer.json added_tokens.json
На процессоре Ampere (3 ядра) режим int8_float32 самый быстрый: около 5 секунд на каждые 30 секунд записи.

Сравнение с текстом мусхафа делает приложение: здесь только распознавание.
Записи не сохраняются: файл читается в память, расшифровывается и забывается.
"""

import os
import subprocess
import threading
import time

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_DIR = os.environ.get("ASR_MODEL_DIR", "/var/lib/quran-asr/ct2/whisper-base-ar-quran")
MODEL = "tarteel-ai/whisper-base-ar-quran"
MAX_BYTES = 15 * 1024 * 1024
MAX_SECONDS = 6 * 60
RATE = 16000

model = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8_float32", cpu_threads=int(os.environ.get("ASR_THREADS", "3")))
# Одна расшифровка за раз: ядер мало, параллельно было бы только медленнее.
lock = threading.Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def decode(data: bytes) -> np.ndarray:
    """Любой формат (webm, ogg, m4a, mp3, wav) в 16 кГц моно через ffmpeg."""
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-t", str(MAX_SECONDS + 5),
         "-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1"],
        input=data, capture_output=True, timeout=60,
    )
    if p.returncode != 0 or not p.stdout:
        raise HTTPException(400, "bad audio")
    return np.frombuffer(p.stdout, dtype=np.float32)


FRAME = int(0.02 * RATE)
PIECE = 24.0  # секунд в одном куске: модель слушает окнами по 30
PAUSE = 0.2   # сколько тишины оставить с каждой стороны речи


def split(wave: np.ndarray) -> list[np.ndarray]:
    """Режет запись по паузам на куски до 24 секунд и выкидывает долгое молчание.

    Без этого модель режет сама, ровно через 30 секунд, и слово на стыке рвётся или теряется.
    """
    n = len(wave) // FRAME
    if n < 10:
        return [wave]
    energy = np.sqrt((wave[: n * FRAME].reshape(n, FRAME) ** 2).mean(1) + 1e-12)
    threshold = max(1e-3, min(np.percentile(energy, 95) * 0.06, np.percentile(energy, 60) * 0.5))
    voiced = energy > threshold
    speech: list[list[int]] = []
    i = 0
    while i < n:
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j < n and voiced[j]:
            j += 1
        if speech and (i - speech[-1][1]) * 0.02 < 0.35:
            speech[-1][1] = j
        else:
            speech.append([i, j])
        i = j
    pad = int(PAUSE / 0.02)
    parts = []
    end = 0
    for a, b in speech:
        if (b - a) * 0.02 < 0.1:
            continue
        a, b = max(end, a - pad), min(n, b + pad)
        while (b - a) * 0.02 > PIECE:
            # Читает без пауз: режем в самом тихом месте.
            lo, hi = a + int(8 / 0.02), a + int(PIECE / 0.02)
            cut = lo + int(np.argmin(np.convolve(energy[lo:hi], np.ones(9) / 9, "same")[4:-4])) + 4
            parts.append((a, cut))
            a = cut
        parts.append((a, b))
        end = b
    out, cur, length = [], [], 0.0
    for a, b in parts:
        d = (b - a) * 0.02
        if cur and length + d > PIECE:
            out.append(np.concatenate(cur))
            cur, length = [], 0.0
        cur.append(wave[a * FRAME : b * FRAME])
        length += d
    if cur:
        out.append(np.concatenate(cur))
    return out


def transcribe(piece: np.ndarray) -> str:
    segments, _ = model.transcribe(
        piece, language="ar", beam_size=1, temperature=0.0, without_timestamps=True, condition_on_previous_text=False,
    )
    return " ".join(s.text.strip() for s in segments)


@app.get("/api/asr/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/api/asr")
def recognize(audio: UploadFile = File(...)):
    data = audio.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "too large")
    wave = decode(data)
    seconds = len(wave) / RATE
    if seconds < 0.5:
        raise HTTPException(400, "too short")
    if seconds > MAX_SECONDS:
        # Обрезать молча нельзя: конец чтения показался бы пропущенным.
        raise HTTPException(413, "too long")
    started = time.time()
    with lock:
        text = " ".join(transcribe(p) for p in split(wave))
    return {"text": text.strip(), "seconds": round(seconds, 1), "took": round(time.time() - started, 1), "model": MODEL}
