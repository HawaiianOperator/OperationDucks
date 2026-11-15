"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";

export function DuckReplyActions({ question, answer }: { question: string; answer: string }) {
  const [audio, setAudio] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [rating, setRating] = useState<"helpful" | "needs-correction" | "">("");
  const [correction, setCorrection] = useState("");
  const [feedback, setFeedback] = useState<"" | "saving" | "saved" | "error">("");
  const voiceRequest = useRef<AbortController | null>(null);
  const deviceSpeech = useRef<SpeechSynthesisUtterance | null>(null);
  const [customVoice, setCustomVoice] = useState(false);
  const [playingDevice, setPlayingDevice] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/duck/voice", { signal: controller.signal })
      .then(response => response.json())
      .then(status => { if (!controller.signal.aborted) setCustomVoice(status.configured === true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    return () => { if (audio) URL.revokeObjectURL(audio); };
  }, [audio]);

  function playDevice() {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setVoiceError("Device speech is unavailable here. Try opening the dashboard in Edge or Chrome.");
      return;
    }
    if (deviceSpeech.current) {
      window.speechSynthesis.cancel();
      deviceSpeech.current = null;
      setPlayingDevice(false);
      return;
    }
    const speech = new SpeechSynthesisUtterance(answer);
    const voices = window.speechSynthesis.getVoices();
    speech.voice = voices.find(voice => voice.localService && /scot/i.test(voice.name + voice.lang))
      ?? voices.find(voice => voice.localService && voice.lang === "en-GB")
      ?? voices.find(voice => voice.localService && /^en\b/i.test(voice.lang)) ?? null;
    speech.lang = speech.voice?.lang ?? "en-GB";
    speech.rate = 0.94;
    const ended = () => {
      if (deviceSpeech.current !== speech) return;
      deviceSpeech.current = null;
      setPlayingDevice(false);
    };
    speech.onend = ended;
    speech.onerror = () => {
      if (deviceSpeech.current !== speech) return;
      ended();
      setVoiceError("The browser could not play the device voice. Check the audio output or try Edge or Chrome.");
    };
    setVoiceError("");
    deviceSpeech.current = speech;
    setPlayingDevice(true);
    window.speechSynthesis.speak(speech);
  }

  async function play() {
    if (!customVoice) {
      playDevice();
      return;
    }
    const controller = new AbortController();
    voiceRequest.current = controller;
    setSpeaking(true);
    setVoiceError("");
    try {
      const response = await fetch("/api/duck/voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer }), signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      if (!controller.signal.aborted) setAudio(URL.createObjectURL(blob));
    } catch (error) {
      if (!controller.signal.aborted) {
        setCustomVoice(false);
        setVoiceError("Duck’s custom voice is unavailable. Select Read aloud again to use the device voice.");
      }
    } finally {
      if (!controller.signal.aborted) setSpeaking(false);
    }
  }

  async function submit() {
    setFeedback("saving");
    try {
      const response = await fetch("/api/duck/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, correction, question, answer }),
      });
      setFeedback(response.ok ? "saved" : "error");
    } catch {
      setFeedback("error");
    }
  }

  // Abort a voice request when the answer is replaced or removed.
  useEffect(() => () => {
    voiceRequest.current?.abort();
    if (deviceSpeech.current) {
      deviceSpeech.current = null;
      window.speechSynthesis.cancel();
    }
  }, []);

  return <div className="duck-reply-actions">
    {audio ? <audio controls autoPlay src={audio} aria-label="Duck’s spoken reply" /> :
      <button type="button" className="outline" onClick={play} disabled={speaking || answer.length > 4000}>
        <Volume2 size={16} aria-hidden="true" /> {speaking ? "Preparing audio…" : playingDevice ? "Stop reading" : "Read aloud"}
      </button>}
    {playingDevice && <small role="status">Reading with your device voice.</small>}
    {voiceError && <p role="status">{voiceError}</p>}
    {feedback === "saved" ? <p role="status">Feedback saved for review.</p> : <details>
      <summary>Give feedback</summary>
      <div className="actions" aria-label="Rate Duck’s answer">
        <button type="button" className="outline" aria-pressed={rating === "helpful"} onClick={() => setRating("helpful")}>Helpful</button>
        <button type="button" className="outline" aria-pressed={rating === "needs-correction"} onClick={() => setRating("needs-correction")}>Needs correction</button>
      </div>
      <textarea aria-label="Correction or comment" maxLength={1000} rows={2} placeholder="What should Duck improve?"
        value={correction} onChange={event => setCorrection(event.target.value)} />
      <small>Submitting saves this question, answer, and feedback for review.</small>
      <button type="button" className="outline" onClick={submit} disabled={!rating || feedback === "saving"}>
        {feedback === "saving" ? "Saving…" : "Submit feedback"}
      </button>
      {feedback === "error" && <p role="status">Feedback could not be saved. Try again.</p>}
    </details>}
  </div>;
}
