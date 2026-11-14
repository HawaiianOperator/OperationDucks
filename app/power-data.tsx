import { useEffect, useState } from "react";

const metrics = [
  ["T2M", "Air temperature", "°C"],
  ["PRECTOTCORR", "Precipitation", "mm/day"],
  ["ALLSKY_SFC_SW_DWN", "Solar radiation", "kWh/m²/day"],
] as const;

type DailyValues = Record<string, Record<string, number>>;

export function PowerData({ points }: { points: [number, number][] }) {
  const [longitude, latitude] = points.reduce(
    ([x, y], [lng, lat]) => [x + lng / points.length, y + lat / points.length], [0, 0],
  );
  const [result, setResult] = useState<DailyValues>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setFailed(false);
    const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
    const end = Date.now() - 8 * 86400000;
    const query = new URLSearchParams({
      parameters: metrics.map(([id]) => id).join(","),
      community: "AG",
      longitude: String(((longitude % 360 + 540) % 360) - 180),
      latitude: String(latitude),
      start: format(new Date(end - 6 * 86400000)),
      end: format(new Date(end)),
      format: "JSON",
    });
    fetch("https://power.larc.nasa.gov/api/temporal/daily/point?" + query, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("NASA POWER request failed");
        const data = await response.json();
        const values = data.properties?.parameter;
        if (!values) throw new Error("NASA POWER returned no parameters");
        setResult(values);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [longitude, latitude]);

  if (failed) return <p role="status">NASA POWER is unavailable. Reopen Data to retry.</p>;
  if (!result) return <p role="status">Loading NASA POWER data…</p>;

  return <>
    <p>NASA POWER · 7-day averages near the field</p>
    <ul className="source-list">{metrics.map(([id, label, unit]) => {
      const days = Object.values(result[id] ?? {}).filter(value => Number.isFinite(value) && value !== -999);
      const mean = days.reduce((sum, value) => sum + value, 0) / days.length;
      return <li key={id}><strong>{label}</strong><span>{days.length ? mean.toFixed(1) + " " + unit : "Unavailable"}</span></li>;
    })}</ul>
  </>;
}
