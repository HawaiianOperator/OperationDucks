import { rainfall } from "../../rainfall";
import { plotCropHistory } from "../../plot-crop-history";
import { soilProfile } from "../../soil";
import { forecast } from "../../forecast";

function endpoint(base: string, query: Record<string, string>) {
  return base + "?" + new URLSearchParams(query);
}

async function read(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Publisher request failed");
  return response.json();
}

type Event = {
  id: string; title: string; link: string; closed: string | null;
  categories: { id: string; title: string }[];
  geometry: { date: string }[];
  sources: { id: string; url: string }[];
};

function safeUrl(url: string) {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol) ? url : null;
  } catch { return null; }
}

async function events(lat: number, lon: number) {
  const north = Math.min(90, lat + 2);
  const south = Math.max(-90, lat - 2);
  const west = lon - 2;
  const east = lon + 2;
  const spans = west < -180 ? [[west + 360, 180], [-180, east]]
    : east > 180 ? [[west, 180], [-180, east - 360]] : [[west, east]];
  const urls = spans.map(([left, right]) => endpoint("https://eonet.gsfc.nasa.gov/api/v3/events", {
    bbox: [left, north, right, south].join(","),
    status: "all", days: "30",
    category: "drought,floods,wildfires,severeStorms,landslides,tempExtremes,volcanoes,earthquakes",
  }));
  const pages = await Promise.all(urls.map(read));
  if (pages.some(page => !Array.isArray(page.events))) throw new Error("Event catalog unavailable");
  const unique = new Map<string, Event>();
  for (const page of pages) for (const event of page.events as Event[]) unique.set(event.id, event);
  return {
    urls,
    items: [...unique.values()].map(event => ({
      id: event.id, title: event.title, closed: event.closed,
      categories: event.categories.map(category => category.title),
      date: event.geometry.map(point => point.date).sort().at(-1),
      url: safeUrl(event.link),
      sources: event.sources.flatMap(item => safeUrl(item.url) ? [item] : []),
    })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
  };
}

async function wind(lat: number, lon: number) {
  const url = endpoint("https://api.met.no/weatherapi/locationforecast/2.0/compact", {
    lat: String(lat), lon: String(lon),
  });
  const response = await fetch(url, {
    headers: { "User-Agent": "OperationDucks/0.1 (https://matt.edgecompute.space)" },
    cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Wind unavailable");
  const data = await response.json();
  const forecast = data.properties?.timeseries?.[0];
  const { wind_speed: speed, wind_from_direction: direction, wind_speed_of_gust: gust } = forecast?.data?.instant?.details ?? {};
  if (![speed, direction].every(Number.isFinite) || typeof forecast?.time !== "string") throw new Error("Wind unavailable");
  return { url, speed: +(speed * 3.6).toFixed(1), direction,
    gust: Number.isFinite(gust) ? +(gust * 3.6).toFixed(1) : undefined, time: forecast.time };
}

const feeds = { forecast, rainfall, events, wind, soil: soilProfile, "crop-history": plotCropHistory };

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const latitude = query.get("lat");
  const longitude = query.get("lon");
  if (!kind || !Object.hasOwn(feeds, kind) || !latitude?.trim() || !longitude?.trim()) {
    return Response.json({ error: "Choose a feed and map location." }, { status: 400 });
  }
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Coordinates are out of range." }, { status: 400 });
  }
  try {
    return Response.json(await feeds[kind as keyof typeof feeds](lat, lon), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "The data provider is unavailable. Try refreshing this location." }, { status: 502 });
  }
}

