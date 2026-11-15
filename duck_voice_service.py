"""Serve Duck's voice model independently from the chat router on localhost."""

import argparse
from functools import lru_cache
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
from threading import Lock

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
LANGUAGES = {"en-GB-scotland": "English", "es-MX": "Spanish", "zh-CN": "Chinese", "ja-JP": "Japanese"}


def chunks(text):
    for sentence in re.split(r"\n+|(?<=[.!?])\s+|(?<=[。！？])", text.strip()):
        sentence = sentence.strip()
        while len(sentence) > 360:
            cut = sentence.rfind(" ", 180, 360)
            cut = cut if cut != -1 else 360
            yield sentence[:cut]
            sentence = sentence[cut:].lstrip()
        if sentence:
            yield sentence


def load_voice(references):
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import HfApi, snapshot_download
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("Start the voice service with CUDA-enabled PyTorch on the A30.")
    clips = {}
    for locale in LANGUAGES:
        wav = references / f"{locale}.wav"
        transcript = references / f"{locale}.txt"
        if wav.is_file() and transcript.is_file():
            text = transcript.read_text(encoding="utf-8").strip()
            if text:
                clips[locale] = (wav, text)
    if not clips:
        raise RuntimeError("Add a permitted reference WAV and matching transcript under voice-references.")
    info = HfApi().model_info(MODEL_ID)
    if not info.safetensors or not 0 < info.safetensors.total <= 1_000_000_000:
        raise RuntimeError("The main voice checkpoint exceeds the parameter limit or its size is unknown.")
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    model = Qwen3TTSModel.from_pretrained(snapshot_download(MODEL_ID, revision=info.sha), device_map="cuda:0", dtype=dtype)
    print(f"Loaded voice revision {info.sha}; available locales: {', '.join(clips)}", flush=True)

    @lru_cache(maxsize=len(clips))
    def prompt(locale):
        wav, transcript = clips[locale]
        return model.create_voice_clone_prompt(ref_audio=str(wav), ref_text=transcript)

    def synthesize(text, locale):
        if locale not in clips:
            raise ValueError("No reference recording is configured for that voice.")
        parts = []
        sample_rate = None
        with torch.inference_mode():
            for part in chunks(text):
                audio, rate = model.generate_voice_clone(
                    text=part, language=LANGUAGES[locale], voice_clone_prompt=prompt(locale),
                )
                if sample_rate is not None and rate != sample_rate:
                    raise RuntimeError("Voice chunks have inconsistent sample rates.")
                sample_rate = rate
                if parts:
                    parts.append(np.zeros(int(rate * 0.16), dtype=np.float32))
                parts.append(audio[0])
        buffer = io.BytesIO()
        sf.write(buffer, np.concatenate(parts), sample_rate, format="WAV", subtype="PCM_16")
        return buffer.getvalue()

    return synthesize


def serve(synthesize, port, token=""):
    busy = Lock()

    class Handler(BaseHTTPRequestHandler):
        def send_payload(self, status, payload, mime="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def error_json(self, status, message):
            self.send_payload(status, json.dumps({"error": message}).encode())

        def do_POST(self):
            if self.path != "/speak":
                return self.error_json(404, "Use POST /speak.")
            authorization = self.headers.get("Authorization", "").encode()
            if token and not hmac.compare_digest(authorization, f"Bearer {token}".encode()):
                return self.error_json(401, "Voice API credentials are required.")
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 32768:
                    raise ValueError
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError
                text, locale = body.get("text"), body.get("locale")
                if not isinstance(text, str) or not text.strip() or len(text) > 4000 or not isinstance(locale, str) or locale not in LANGUAGES:
                    raise ValueError
            except (ValueError, TypeError):
                return self.error_json(400, "Provide a supported locale and up to 4,000 characters of text.")
            if not busy.acquire(blocking=False):
                return self.error_json(429, "Voice model is already generating audio.")
            try:
                audio = synthesize(text, locale)
            except ValueError as error:
                return self.error_json(422, str(error))
            except RuntimeError:
                return self.error_json(502, "Voice generation failed.")
            finally:
                busy.release()
            self.send_payload(200, audio, "audio/wav")

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=19231)
    parser.add_argument("--references", type=Path, default=Path(__file__).with_name("voice-references"))
    options = parser.parse_args()
    with serve(load_voice(options.references), options.port, os.environ.get("DUCK_VOICE_API_TOKEN", "")) as server:
        print(f"Duck voice is listening on http://127.0.0.1:{options.port}/speak", flush=True)
        server.serve_forever()
