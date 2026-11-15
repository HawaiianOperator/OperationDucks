export async function rainfall(lat: number, lon: number) {
  const cutoff = new Date(Date.now() - 7 * 86400000);
  const end = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 0));
  const month = end.getUTCMonth();
  const year = end.getUTCFullYear();
  const format = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
  const url = "https://power.larc.nasa.gov/api/temporal/daily/point?" + new URLSearchParams({
    latitude: String(lat), longitude: String(lon), parameters: "PRECTOTCORR", community: "AG",
    start: format(new Date(Date.UTC(year - 10, month, 1))), end: format(end),
    format: "JSON", "time-standard": "UTC",
  });
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("NASA POWER rainfall unavailable");
  const data = await response.json();
  const values = data.properties?.parameter?.PRECTOTCORR;
  if (!values) throw new Error("Rainfall unavailable");
  const years = Array.from({ length: 11 }, (_, index) => {
    const y = year - 10 + index;
    const days = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
    const daily = Array.from({ length: days }, (_, day) => values[format(new Date(Date.UTC(y, month, day + 1)))]);
    return {
      year: y,
      total: daily.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
        ? daily.reduce((sum, value) => sum + value, 0) as number
        : null,
    };
  });
  return { url, years, month: month + 1 };
}

