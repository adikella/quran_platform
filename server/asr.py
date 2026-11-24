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
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-t", str(MAX_SECONDS),
         "-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1"],
        input=data, capture_output=True, timeout=60,
    )
    if p.returncode != 0 or not p.stdout:
        raise HTTPException(400, "bad audio")
    return np.frombuffer(p.stdout, dtype=np.float32)


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
    started = time.time()
    with lock:
        segments, _ = model.transcribe(
            wave, language="ar", beam_size=1, without_timestamps=True, condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments)
    return {"text": text.strip(), "seconds": round(seconds, 1), "took": round(time.time() - started, 1), "model": MODEL}
