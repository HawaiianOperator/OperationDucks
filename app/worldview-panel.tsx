"use client";

import { useEffect, useState } from "react";
import { catalogUrl, imageryLayer, layers, worldviewUrl, type DatasetContext, type LayerKey } from "./worldview";
import { watchFeed } from "./watch-feed";

type Scene = { title: string; time: string; files?: string[]; footprints?: GeoJSON.Feature<GeoJSON.Polygon>[] };
type Result = { key: string; scenes?: Scene[]; error?: string };

export function WorldviewPanel({ context, layer, date, shown, latest, onLayer, onDate, onToggle, onAsk, onFootprints }: {
  context: DatasetContext | null;
  layer: LayerKey;
  date: string;
  shown: boolean;
  latest: boolean;
  onLayer: (layer: LayerKey) => void;
  onDate: (date: string) => void;
  onToggle: () => void;
  onAsk: () => void;
  onFootprints: (features: GeoJSON.Feature<GeoJSON.Polygon>[]) => void;
}) {
  const spectral = !imageryLayer(layer);
  const request = context && date ? JSON.stringify({ layer, date, bounds: context.bounds }) : "";
  const [result, setResult] = useState<Result>();
  const current = result?.key === request ? result : undefined;
  useEffect(() => {
    onFootprints([]);
    if (!request) return;
    const refresh = async (signal: AbortSignal) => {
      try {
        const response = await fetch("/api/worldview", {
          method: "POST", body: request, headers: { "Content-Type": "application/json" }, signal, cache: "no-store",
        });
        const body = await response.json();
        if (signal.aborted) return;
        if (!response.ok) throw new Error(body.error || "Could not reach NASA Earthdata.");
        setResult({ key: request, scenes: body.scenes });
        if (spectral) onFootprints((body.scenes as Scene[]).flatMap(scene => scene.footprints ?? []));
      } catch (error) {
        if (!signal.aborted) setResult(previous => ({
          key: request, scenes: previous?.key === request ? previous.scenes : undefined,
          error: error instanceof Error ? error.message : "Could not reach NASA Earthdata.",
        }));
      }
    };
    if (latest) return watchFeed(refresh, 300000);
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [request, spectral, latest, onFootprints]);

  return <section id="worldview" className="side-card detail-body worldview-panel" aria-labelledby="worldview-title">
    <h2 id="worldview-title">NASA Worldview</h2>
    {!context ? <p>Draw or open a saved field to see its area, browse imagery, and find science files.</p> : <>
      <p><strong>{context.place}</strong> · {context.hectares.toLocaleString(undefined, { maximumFractionDigits: 3 })} ha</p>
      <div className="worldview-controls">
        <label>Dataset <select value={layer} onChange={event => onLayer(event.target.value as LayerKey)}>
          {Object.entries(layers).map(([key, value]) => <option value={key} key={key}>{value.name}</option>)}
        </select></label>
        <label>{spectral ? "Search end date (UTC)" : "Observation date (UTC)"} <input type="date" value={date} onChange={event => onDate(event.target.value)} /></label>
        {latest ? <small>Following latest · checks every 5 minutes</small>
          : <button className="outline" onClick={() => onDate("")}>Follow latest</button>}
        <button className="outline" disabled={!date} aria-pressed={shown && !!date} onClick={onToggle}>
          {spectral ? (shown ? "Hide footprints on map" : "Show footprints on map")
            : (shown ? "Hide imagery on map" : "Show imagery on map")}
        </button>
      </div>
      {date && <>
        <div className="worldview-links">
          {!spectral && <a href={worldviewUrl(context)} target="_blank" rel="noreferrer">Open this area in NASA Worldview</a>}
          <a href={catalogUrl(context)} target="_blank" rel="noreferrer">Inspect Earthdata catalog results</a>
          <button className="outline" onClick={onAsk}>Ask Duck about this dataset</button>
        </div>
        <p>{spectral ? "Searches the 365 days ending on the selected date. Outlines show acquisition footprints when NASA supplies them. The science files contain the reflectance bands."
          : layer === "smap" ? "SMAP shows regional soil moisture on a 9 km grid. Open Worldview for the color legend."
          : layer === "rain" || layer === "heat" ? "Open Worldview for the color legend. Earthdata lists related science files for this date and area."
          : "True-color imagery gives visual context. Cloud cover can obscure the ground."}</p>
        <div aria-live="polite">
          {!current && <p>Looking for science files that overlap the field’s bounding box…</p>}
          {current?.error && <p>{current.error}</p>}
          {current?.scenes?.length === 0 && <p>No matching science files for this area and search window.</p>}
          {!!current?.scenes?.length && <details>
            <summary>Inspect matching science files ({current.scenes.length}{current.scenes.length === 6 ? " shown" : ""})</summary>
            <ul>{current.scenes.map((scene, index) => <li key={index}><strong>{scene.title}</strong><small>{scene.time ?? "Observation time unavailable"}</small>
              {spectral && scene.files?.map((url, index) => <small key={url}><a href={url} target="_blank" rel="noreferrer">
                Open science file {index + 1} with NASA Earthdata
              </a></small>)}</li>)}</ul>
          </details>}
        </div>
      </>}
    </>}
  </section>;
}
