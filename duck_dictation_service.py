"""Transcribe short microphone clips on the local machine."""

import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

MAX_BYTES = 2 * 1024 * 1024


def serve(transcribe, port=19232):
    busy = Lock()

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status, body):
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):
            if self.path != "/transcribe":
                return self.send_json(404, {"error": "Unknown endpoint."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_BYTES:
                    raise ValueError
            except ValueError:
                return self.send_json(400, {"error": "Record a short question and try again."})
            if not busy.acquire(blocking=False):
                return self.send_json(429, {"error": "Dictation is busy. Try again shortly."})
            try:
                audio = self.rfile.read(size)
                text = transcribe(io.BytesIO(audio)).strip()
            except (RuntimeError, ValueError, OSError):
                return self.send_json(422, {"error": "Could not read the recording. Try again or type your question."})
            finally:
                busy.release()
            return self.send_json(200, {"text": text[:1000]})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    from pathlib import Path
    from faster_whisper import WhisperModel

    cache = Path(__file__).resolve().parent / ".duck-model" / "whisper"
    model = WhisperModel("tiny", device="cpu", compute_type="int8", download_root=str(cache), cpu_threads=4)

    def transcribe(audio):
        segments, _ = model.transcribe(audio, beam_size=3, vad_filter=True, condition_on_previous_text=False)
        return " ".join(segment.text.strip() for segment in segments)

    with serve(transcribe) as server:
        print("Duck dictation is listening on http://127.0.0.1:19232/transcribe", flush=True)
        server.serve_forever()
