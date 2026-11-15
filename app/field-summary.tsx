"use client";

import { useEffect, useRef, useState } from "react";
import type { Point } from "./plot-geometry";

type Item = { title: string; value: string; url?: string };
type Summary = { key: string; items?: Item[]; error?: string };

export function FieldSummary({ point, boundary, radiusMeters }: { point: Point; boundary: Point[]; radiusMeters?: number }) {
  const [summary, setSummary] = useState<Summary>();
  const [attempt, setAttempt] = useState(0);
  const [rotation, setRotation] = useState<{ key: string; answer?: string; error?: string; sources?: { title: string; url: string }[] }>();
  const rotationRequest = useRef<AbortController | null>(null);
  const [lon, lat] = point;
  const key = `${lon}:${lat}:${radiusMeters ?? ""}:${attempt}`;
  const result = summary?.key === key ? summary : undefined;
  const plot = JSON.stringify([point, boundary]);
  const currentRotation = rotation?.key === plot ? rotation : undefined;
  const checkingRotation = currentRotation && !currentRotation.answer && !currentRotation.error;
  useEffect(() => () => rotationRequest.current?.abort(), [plot]);

  async function getRotations() {
    const controller = new AbortController();
    rotationRequest.current?.abort();
    rotationRequest.current = controller;
    setRotation({ key: plot });
    try {
      const response = await fetch("/api/duck", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ question: "Show the best crop cycle for this field", center: point,
          boundary, radiusMeters, fieldSelected: true }),
      });
      const body = await response.json();
      if (!controller.signal.aborted) setRotation(response.ok
        ? { key: plot, answer: body.answer, sources: body.sources }
        : { key: plot, error: body.error ?? "Crop rotation options could not load." });
    } catch {
      if (!controller.signal.aborted) setRotation({ key: plot, error: "Crop rotation options could not load." });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/duck/field-summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ center: [lon, lat], radiusMeters }), signal: controller.signal, cache: "no-store",
    }).then(async response => {
      const body = await response.json();
      if (!controller.signal.aborted) {
        setSummary(response.ok ? { key, items: body.items } : { key, error: body.error });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setSummary({ key, error: "The field summary couldn’t load." });
    });
    return () => controller.abort();
  }, [lon, lat, radiusMeters, key]);

  return <section className="field-summary" aria-labelledby="field-summary-title">
    <h3 id="field-summary-title">Phase One · Field data</h3>
    <div aria-live="polite">
      {!result && <small>Checking weather, soil, and crop history…</small>}
      {result?.error && <><small>{result.error}</small><button type="button" className="outline"
        onClick={() => setAttempt(value => value + 1)}>Retry summary</button></>}
      {!!result?.items?.length && <dl>{result.items.map(item => <div key={item.title}>
        <dt>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</dt>
        <dd>{item.value}</dd>
      </div>)}</dl>}
    </div>
    <small>Weather, soil pH, and mapped crop history use the field center. Rotation checks sample across the selected shape.</small>
    <h4>Phase Two · Crop rotation</h4>
    <button className="secondary" type="button" disabled={checkingRotation} onClick={getRotations}>
      {checkingRotation ? "Checking crop history…" : "Compare crop combinations"}
    </button>
    <div className="field-rotation" aria-live="polite">
      {currentRotation?.error && <small>{currentRotation.error}</small>}
      {currentRotation?.answer && <p className="duck-answer">{currentRotation.answer}</p>}
      {!!currentRotation?.sources?.length && <ul>{currentRotation.sources.map(source =>
        <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>}
    </div>
    <a className="outline" href="#duck">Ask Duck a follow-up</a>
  </section>;
}
