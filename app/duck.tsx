"use client";

import { useState, type FormEvent } from "react";
import { layers, type DatasetContext } from "./worldview";
import { VoiceInput } from "./voice-input";
import { DuckReplyActions } from "./duck-reply-actions";

type Source = { title: string; url: string };
type Answer = { answer?: string; sources?: Source[]; error?: string };
type Plot = { key: string; name: string; center: [number, number]; boundary?: [number, number][]; radiusMeters?: number };
type PlotReply = { key: string; label?: string; reply: Answer };

export function Duck({ center, dataset, plots, includedPlots, onTogglePlot, onClearDataset }: {
  center: [number, number]; dataset: DatasetContext | null; plots: Plot[]; includedPlots: string[];
  onTogglePlot: (key: string) => void; onClearDataset: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("");
  const [farmNotes, setFarmNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ context: string; question: string; replies: PlotReply[] }>();
  const chosen = plots.filter(plot => includedPlots.includes(plot.key));
  const context = dataset ? JSON.stringify(dataset) : JSON.stringify(chosen.map(plot => [plot.key, plot.name]));
  const replies = result?.context === context ? result.replies : [];
  const noPlot = !dataset && !!plots.length && !chosen.length;

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending || noPlot) return;
    setPending(true);
    setResult(undefined);
    const targets: Plot[] = !dataset && chosen.length ? chosen : [{ key: "default", name: "", center }];
    const notesForRequest = targets.length > 1 ? farmNotes.split(/\r?\n/)
      .filter(line => !/^\s*20\d{2}\s*:/.test(line)).join("\n") : farmNotes;
    const results: PlotReply[] = [];
    try {
      for (let start = 0; start < targets.length; start += 4) {
        const batch = await Promise.all(targets.slice(start, start + 4).map(async target => {
          try {
            const response = await fetch("/api/duck", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question, scope: target.name ? "" : scope, center: target.center,
                dataset, farmNotes: notesForRequest, boundary: target.boundary, radiusMeters: target.radiusMeters, fieldSelected: !!target.name || !!dataset }),
            });
            return { key: target.key, label: target.name, reply: await response.json() as Answer };
          } catch {
            return { key: target.key, label: target.name, reply: { error: "The dashboard could not reach Duck." } };
          }
        }));
        results.push(...batch);
        setResult({ context, question, replies: [...results] });
      }
    } finally {
      setPending(false);
    }
  }

  return <section id="duck" className="side-card detail-body duck-panel" aria-label="Duck map assistant">
    <h2>Duck</h2>
    <form onSubmit={ask}>
      <textarea aria-label="Question for Duck" placeholder="Ask anything about getting started, growing crops, or this field" value={question}
        onChange={event => setQuestion(event.target.value)} maxLength={1000} rows={3} />
      <VoiceInput onText={value => setQuestion(value.slice(0, 1000))} />
      <details>
        <summary>Add farm details (optional)</summary>
        <small>Select one plot to use its crop history. Enter one year and crop per line, such as 2024: maize.</small>
        <textarea aria-label="Farm notes" placeholder="Example: sandy soil, drip irrigation, growing tomatoes" value={farmNotes}
          onChange={event => setFarmNotes(event.target.value)} maxLength={1000} rows={2} />
      </details>
      {dataset ? <div className="duck-dataset">
        <strong>{layers[dataset.layer].name}</strong><small>{dataset.place} · {dataset.date} UTC</small>
        <button className="outline" type="button" onClick={onClearDataset}>Clear dataset context</button>
        <button className="outline" type="button" onClick={() => setQuestion("What does this dataset mean for my field?")}>What does it mean?</button>
      </div> : plots.length ? <fieldset className="duck-plots">
        <legend>Plots for this question</legend>
        {plots.map(plot => <label key={plot.key}><input type="checkbox" checked={includedPlots.includes(plot.key)}
          onChange={() => onTogglePlot(plot.key)} /> {plot.name}</label>)}
        {noPlot && <small>Select at least one plot.</small>}
      </fieldset> : <>
        <small>{scope.trim() ? `Using ${scope.trim()}` : "Using the map center for location-based questions."}</small>
        <details>
          <summary>Use a different place or compare places</summary>
          <label>Place <input value={scope} onChange={event => setScope(event.target.value)} maxLength={160}
            placeholder="Place name or latitude, longitude" /></label>
          <small>For planting comparisons, separate places with semicolons.</small>
        </details>
      </>}
      <button className="primary" aria-busy={pending} disabled={pending || !question.trim() || noPlot}>{pending ? "Asking Duck…" : "Ask Duck"}</button>
    </form>
    <div aria-live="polite">{replies.map(({ key, label, reply }) => <section key={key} className="duck-plot-reply">
      {label && <h3>{label}</h3>}
      {reply?.error && <p>{reply.error}</p>}
      {reply?.answer && <p className="duck-answer" style={{ whiteSpace: "pre-line" }}>{reply.answer}</p>}
      {!!reply?.sources?.length && <ul>{reply.sources.map((source, index) => <li key={index}>
        <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
      </li>)}</ul>}
      {reply.answer && result && <DuckReplyActions question={result.question} answer={reply.answer} />}
    </section>)}</div>
  </section>;
}
