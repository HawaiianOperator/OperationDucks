"use client";

import { useEffect, useState } from "react";
import { CloudSun, RotateCw } from "lucide-react";

const tabs = [
  ["forecast", "Weather"],
  ["rainfall", "Drought"],
  ["events", "Disasters"],
  ["soil", "Soil pH"],
  ["crop-history", "Crop history"],
] as const;
const columns = [
  ["temperature_2m_min", "Low", "°C"],
  ["temperature_2m_max", "High", "°C"],
  ["precipitation_sum", "Precip.", "mm"],
  ["precipitation_probability_max", "Precip. chance", "%"],
  ["wind_gusts_10m_max", "Peak gust", "km/h"],
  ["et0_fao_evapotranspiration", "Reference ET₀", "mm"],
] as const;
type Kind = typeof tabs[number][0];
type Forecast = { url: string; timezone: string; daily: { time: string[] } & Record<typeof columns[number][0], (number | null)[]> };
type Rainfall = { url: string; years: { year: number; total: number | null }[]; month: number };
type Events = {
  urls: string[];
  items: { id: string; title: string; closed: string | null; categories: string[]; date?: string; url: string | null;
    sources: { id: string; url: string }[] }[];
};
type Soil = { samples: { depth: string; ph: number | null }[]; source: string };
type CropHistory = { status: string; method: "cdl" | "csb" | "aci" | "rpg" | "brp" | "mapbiomas" | "kenya" | "indiaRice" | "worldcereal"; url: string; documentation: string;
  fields: { id: string; acres: number | null; county: string; history: { year: number; crop: string; code: number | null }[] }[] };
type Feed = { forecast: Forecast; rainfall: Rainfall; events: Events; soil: Soil; "crop-history": CropHistory };
type Result = { key: string; error?: string; data?: Feed[Kind] };

function Link({ url, children }: { url: string; children: React.ReactNode }) {
  return <a href={url} target="_blank" rel="noreferrer">{children}</a>;
}

function ForecastData({ data }: { data: Forecast }) {
  const { daily } = data;
  const signals = [
    ["Frost potential", daily.temperature_2m_min, (n: number) => n <= 0],
    ["Heat", daily.temperature_2m_max, (n: number) => n >= 35],
    ["Heavy precipitation", daily.precipitation_sum, (n: number) => n >= 25],
    ["Strong wind gusts", daily.wind_gusts_10m_max, (n: number) => n >= 50],
  ] as const;
  const flags = signals.flatMap(([label, readings, passes]) => {
    const days = daily.time.filter((_, index) => readings[index] !== null && passes(readings[index]!));
    return days.length ? [{ label, days }] : [];
  });
  return <>
    <p>Seven-day Open-Meteo forecast · {data.timezone}. Field conditions can differ from the forecast grid.</p>
    {flags.length ? <ul className="risk-flags">{flags.map(({ label, days }) =>
      <li key={label}><strong>{label}</strong> {days.join(", ")}</li>)}</ul>
      : <p>No screening thresholds were crossed in the available values.</p>}
    <div className="risk-scroll" tabIndex={0} role="region" aria-label="Daily weather data">
      <table><thead><tr><th scope="col">Local date</th>{columns.map(([key, label, unit]) =>
        <th key={key} scope="col">{label} ({unit})</th>)}</tr></thead>
        <tbody>{daily.time.map((day, index) => <tr key={day}><th scope="row">{day}</th>
          {columns.map(([key]) => <td key={key}>{daily[key][index]?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? "—"}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <details><summary>Thresholds and source</summary>
      <p>Frost potential at 0 °C or lower, heat at 35 °C or higher, daily precipitation of 25 mm or more, and gusts of 50 km/h or more. These are general screening thresholds. ET₀ estimates atmospheric demand for water over a reference surface. Missing values appear as a dash.</p>
      <Link url={data.url}>Inspect forecast JSON</Link>
    </details>
  </>;
}

function RainfallData({ data }: { data: Rainfall }) {
  const [latest, ...history] = [...data.years].reverse();
  const baseline = history.flatMap(row => row.total === null ? [] : [row.total]);
  const average = baseline.length ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length : null;
  const month = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(latest.year, data.month - 1)));
  const hasComparison = latest.total !== null && average !== null && baseline.length >= 8;
  return <>
    <p>NASA POWER · {month} rainfall at the selected grid point. Compares a completed month with the same month in the preceding ten years.</p>
    {hasComparison ? <p className="risk-reading"><strong>{latest.total!.toFixed(1)} mm</strong> in {latest.year}, compared with {average!.toFixed(1)} mm across {baseline.length} complete baseline years.
      {average! > 0 && ` That's ${Math.round(latest.total! / average! * 100)}% of the baseline average.`}</p>
      : <p>There are insufficient complete values for a comparison.</p>}
    <p>Use rainfall as a dry-weather indicator. Check drought severity, soil moisture, and impacts in the <Link url="https://drought.emergency.copernicus.eu/tumbo/gdo/map/">Global Drought Observatory</Link>.</p>
    <details><summary>Inspect annual totals and source</summary>
      <table><thead><tr><th scope="col">Year</th><th scope="col">{month} rainfall (mm)</th></tr></thead>
        <tbody>{[latest, ...history].map(row => <tr key={row.year}><th scope="row">{row.year}</th>
          <td>{row.total?.toFixed(1) ?? "Incomplete month"}</td></tr>)}</tbody></table>
      <Link url={data.url}>Inspect NASA POWER daily values</Link>
    </details>
  </>;
}

function EventData({ data }: { data: Events }) {
  const [category, setCategory] = useState("");
  const categories = [...new Set(data.items.flatMap(item => item.categories))].sort();
  const items = data.items.filter(item => !category || item.categories.includes(category));
  return <>
    <p>NASA EONET events cataloged over the past 30 days within 2° of the selected point in latitude and longitude. Check local authorities for warnings and field impacts.</p>
    {!!categories.length && <label className="risk-filter">Event type <select value={category} onChange={event => setCategory(event.target.value)}>
      <option value="">All types</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>}
    {items.length ? <div className="risk-events">{items.map(item => <details key={item.id}>
      <summary>{item.title} <small>{item.categories.join(", ")} · {item.closed ? "Closed" : "Open"} · {item.date?.slice(0, 10) ?? "Date unavailable"}</small></summary>
      {item.url && <p><Link url={item.url}>Inspect NASA EONET record</Link></p>}
      {!!item.sources.length && <ul>{item.sources.map((entry, index) =>
        <li key={index}><Link url={entry.url}>{entry.id} source report</Link></li>)}</ul>}
    </details>)}</div> : <p>No catalog matches for this search. Local incidents may be missing from the catalog.</p>}
    {data.urls.map((url, index) => <p key={url}><Link url={url}>Inspect EONET query {data.urls.length > 1 ? index + 1 : ""}</Link></p>)}
  </>;
}

function SoilData({ data }: { data: Soil }) {
  return <>
    <p>ISRIC SoilGrids modeled pH in water at this point · nominal 250 m grid.</p>
    <table><thead><tr><th scope="col">Soil depth</th><th scope="col">Estimated pH</th></tr></thead>
      <tbody>{data.samples.map(sample => <tr key={sample.depth}><th scope="row">{sample.depth} cm</th>
        <td>{sample.ph?.toFixed(1) ?? "Unavailable"}</td></tr>)}</tbody></table>
    <p>Use a field soil test to confirm pH before making amendment decisions.</p>
    <p><Link url={data.source}>Inspect SoilGrids data</Link> · <a href="#duck">Ask Duck about soil health or crop rotation</a></p>
  </>;
}

function CropData({ data }: { data: CropHistory }) {
  const description = {
    cdl: "USDA Cropland Data Layer · annual classes at the selected pixel.",
    csb: "USDA Crop Sequence Boundaries · crop classes for polygons at the selected point.",
    aci: "Canada Annual Crop Inventory · annual classes at the selected pixel.",
    rpg: "France Registre Parcellaire Graphique · declared crops for parcels at the selected point.",
  };
  return <>
    {data.status !== "outside" && <p>{description[data.method]}</p>}
    {data.status === "outside" && <p>The connected crop inventories have no coverage at this location.</p>}
    {data.status === "empty" && <p>No mapped crop observations were available at this point.</p>}
    {data.fields.map((field, index) => <details key={field.id} open={index === 0}>
      <summary>{data.method !== "csb" ? "Crop history at selected point" : <>{field.county ? `${field.county} · ` : ""}{field.acres?.toFixed(1) ?? "Unknown"} acres · CSB {field.id}</>}</summary>
      <table><thead><tr><th scope="col">Year</th><th scope="col">Crop class</th></tr></thead>
        <tbody>{field.history.map(row => <tr key={row.year}><th scope="row">{row.year}</th><td>{row.crop}</td></tr>)}</tbody>
      </table>
    </details>)}
    <p>Use farm records to confirm what was planted. {data.status !== "outside" && <Link url={data.documentation}>Dataset and coverage</Link>}
      {data.status !== "outside" && data.url !== data.documentation && <> · <Link url={data.url}>Inspect source query</Link></>}</p>
  </>;
}

export function FarmRisks({ place, point, onInspect }: {
  place: string; point: [number, number] | null; onInspect: () => void;
}) {
  const [kind, setKind] = useState<Kind>("forecast");
  const [revision, refresh] = useState(0);
  const [result, setResult] = useState<Result>();
  const lon = point?.[0].toFixed(4);
  const lat = point?.[1].toFixed(4);
  const key = `${kind}:${lat}:${lon}:${revision}`;
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ kind, lat, lon });
    fetch("/api/farm-risks?" + query, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (!controller.signal.aborted) setResult({ key, data: payload });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ key, error: error.message || "Data unavailable." });
      });
    return () => controller.abort();
  }, [kind, lat, lon, key]);

  return <section id="farm-risks" tabIndex={-1} className="farm-risks side-card detail-body" aria-labelledby="farm-risks-title">
    <div className="risk-heading">
      <div><h2 id="farm-risks-title"><CloudSun size={19} aria-hidden="true" /> Farm risks</h2>
        <p>{point ? `${place} · ${lat}, ${lon}` : "Search for a location or inspect the map center."}</p></div>
      <div className="risk-actions">
        <button className="outline" onClick={onInspect}>Inspect map center</button>
        {point && <button className="outline" onClick={() => refresh(value => value + 1)} aria-label="Refresh risk data"><RotateCw size={15} /></button>}
      </div>
    </div>
    <div className="tabs" aria-label="Risk data">{tabs.map(([id, label]) =>
      <button key={id} aria-pressed={id === kind} onClick={() => setKind(id)}>{label}</button>)}</div>
    <div className="risk-content" aria-live="polite">
      {point && !current && <p>Loading {tabs.find(([id]) => id === kind)?.[1].toLowerCase()} data…</p>}
      {current?.error && <p role="status">{current.error}</p>}
      {current?.data && (kind === "forecast" ? <ForecastData data={current.data as Forecast} />
        : kind === "rainfall" ? <RainfallData data={current.data as Rainfall} />
        : kind === "soil" ? <SoilData data={current.data as Soil} />
        : kind === "crop-history" ? <CropData data={current.data as CropHistory} />
        : <EventData data={current.data as Events} />)}
    </div>
  </section>;
}
