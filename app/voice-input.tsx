"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

export function VoiceInput({ onText }: { onText: (text: string) => void }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "transcribing">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      request.current?.abort();
      recorder.current?.stream.getTracks().forEach(track => track.stop());
    };
  }, []);

  async function toggle() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    if (phase !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("This browser cannot record audio here. Open the dashboard in Edge or Chrome, or focus the question box and press Windows + H.");
      return;
    }
    setPhase("requesting");
    setMessage("");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const mic = new MediaRecorder(stream, { audioBitsPerSecond: 48000 });
      const chunks: Blob[] = [];
      mic.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
      mic.onstop = async () => {
        window.clearTimeout(timer.current);
        mic.stream.getTracks().forEach(track => track.stop());
        if (recorder.current !== mic) return;
        recorder.current = null;
        if (!mounted.current) return;
        const controller = new AbortController();
        request.current = controller;
        setPhase("transcribing");
        try {
          const blob = new Blob(chunks, { type: mic.mimeType });
          const response = await fetch("/api/duck/dictation", { method: "POST", body: blob, signal: controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (controller.signal.aborted) return;
          if (typeof result.text === "string" && result.text.trim()) {
            onText(result.text.trim());
            setMessage("Review the transcript, then select Ask Duck.");
          } else {
            setMessage("No speech detected. Try speaking closer to your microphone.");
          }
        } catch (error) {
          if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Dictation failed.");
        } finally {
          if (!controller.signal.aborted) setPhase("idle");
        }
      };
      mic.onerror = () => {
        recorder.current = null;
        window.clearTimeout(timer.current);
        mic.stream.getTracks().forEach(track => track.stop());
        setPhase("idle");
        setMessage("The microphone stopped recording. Try again.");
      };
      recorder.current = mic;
      mic.start();
      setPhase("recording");
      timer.current = window.setTimeout(() => { if (mic.state === "recording") mic.stop(); }, 20000);
    } catch (error) {
      recorder.current = null;
      stream?.getTracks().forEach(track => track.stop());
      if (!mounted.current) return;
      setPhase("idle");
      setMessage(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in the browser site settings, or press Windows + H in the question box."
        : "Unable to open the microphone. Check your input device and try again.");
    }
  }

  return <div>
    <button className="outline" type="button" aria-pressed={phase === "recording"} onClick={toggle}
      disabled={phase === "requesting" || phase === "transcribing"}>
      <Mic size={15} aria-hidden="true" /> {phase === "recording" ? "Stop and transcribe" : phase === "transcribing" ? "Transcribing…" : "Dictate question"}
    </button>
    <small role="status">{message || (phase === "requesting" ? "Waiting for microphone access…"
      : phase === "recording" ? "Recording. Select Stop when you’re finished." : "Records up to 20 seconds for local transcription.")}</small>
  </div>;
}
