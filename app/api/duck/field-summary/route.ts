import { csbSource } from "../../../crop-sequence";
import { cropHistorySource, plotCropHistory } from "../../../plot-crop-history";
import { forecast } from "../../../forecast";
import { soilProfile, soilSource } from "../../../soil";
import { nasaRadiusRecords, nasaSpatialFilter } from "../../../duck-nasa";

async function weatherOutlook(lat: number, lon: number) {
  const local = await forecast(lat, lon).catch(() => null);
  if (local) {
    const { daily, url } = local;
    const lows = daily.temperature_2m_min;
    const highs = daily.temperature_2m_max;
    const rain = daily.precipitation_sum;
    if (lows.every(n => n !== null && Number.isFinite(n)) && highs.every(n => n !== null && Number.isFinite(n)) &&
        rain.every(n => n !== null && Number.isFinite(n))) {
      return { url, value: `${daily.time[0]} to ${daily.time.at(-1)} · ${Math.min(...lows).toFixed(0)} to ${Math.max(...highs).toFixed(0)} °C · ${rain.reduce((sum, n) => sum + n, 0).toFixed(1)} mm forecast precipitation.` };
    }
  }
  const query = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  const url = "https://api.met.no/weatherapi/locationforecast/2.0/compact?" + query;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "OperationDucks/0.1 (https://matt.edgecompute.space)" } });
  if (!response.ok) throw new Error("Weather unavailable");
  const forecastData = await response.json();
  const series = forecastData.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) throw new Error("Weather unavailable");
  const from = Date.parse(series[0].time);
  const temperatures = series.flatMap(row => {
    const temperature = row.data?.instant?.details?.air_temperature;
    return Date.parse(row.time) < from + 86400000 && Number.isFinite(temperature) ? [temperature as number] : [];
  });
  if (temperatures.length < 4) throw new Error("Weather unavailable");
  return { url, value: `24-hour forecast from ${series[0].time.replace("T", " ").replace(/Z$/, "")} UTC · ${Math.min(...temperatures).toFixed(0)} to ${Math.max(...temperatures).toFixed(0)} °C.` };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const [lon, lat] = Array.isArray(body?.center) ? body.center : [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    return Response.json({ error: "Select a valid field location." }, { status: 400 });
  }
  const radius: unknown = body.radiusMeters;
  const areaSearch = nasaSpatialFilter([lon, lat], radius);
  const [weather, soil, history, imagery] = await Promise.all([
    weatherOutlook(lat, lon).catch(() => null),
    soilProfile(lat, lon).catch(() => null),
    plotCropHistory(lat, lon).catch(() => null),
    typeof radius === "number" && Number.isFinite(radius) && radius > 0
      ? nasaRadiusRecords([lon, lat], radius)
      : Promise.resolve([]),
  ]);
  const pH = soil?.samples.find(sample => sample.depth === "0-5")?.ph;
  const crops = history?.fields.length === 1 ? history.fields[0].history.slice(-3) : [];
  const mapped = crops.length ? crops.map(row => `${row.year} ${row.crop}`).join(", ") +
      ` · ${cropHistorySource[history.method]}.`
    : history?.status === "outside" ? "No connected crop-history coverage for this location."
    : history?.status === "empty" ? "No mapped crop history intersects this point."
    : history?.fields.length ? "Multiple crop polygons intersect this point. Inspect Crop history."
    : "Mapped crop history is currently unavailable.";
  return Response.json({
    items: [
      { title: "Weather outlook", value: weather?.value ?? "A forecast is currently unavailable.", url: weather?.url },
      { title: "Topsoil pH", value: pH == null ? "Estimate unavailable." : `${pH.toFixed(1)} modeled pH in water at 0–5 cm.`, url: soilSource },
      { title: "Mapped crop history", value: mapped, url: history?.status === "outside" ? undefined : history?.url ?? csbSource },
      ...(imagery.length ? [{
        title: "NASA Earthdata search area",
        value: areaSearch.circle ? `Observations intersecting the selected ${Math.round(Number(radius)).toLocaleString("en-US")} m radius. Catalog matches describe observation coverage.`
          : "NASA queried the field center because the selection is outside its supported circle search range.",
      }, ...imagery] : []),
    ],
  }, { headers: { "Cache-Control": "no-store" } });
}
