import { catalogUrl, layers, readSelection } from "../../worldview";

const capabilities = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml";

export async function GET() {
  try {
    const response = await fetch(capabilities, { next: { revalidate: 300 }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("NASA GIBS unavailable");
    const xml = await response.text();
    const datesById = new Map<string, string>();
    for (const [, content] of xml.matchAll(/<Layer(?:\s[^>]*)?>([\s\S]*?)<\/Layer>/g)) {
      const id = content.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1];
      const time = content.match(/<Dimension>\s*<ows:Identifier>Time<\/ows:Identifier>([\s\S]*?)<\/Dimension>/)?.[1];
      const date = time?.match(/<Default>(\d{4}-\d{2}-\d{2})(?:T[^<]*)?<\/Default>/)?.[1];
      if (id && date) datesById.set(id, date);
    }
    const dates = Object.fromEntries(Object.entries(layers).flatMap(([key, layer]) => {
      const date = "id" in layer ? datesById.get(layer.id) : undefined;
      return date ? [[key, date]] : [];
    }));
    if (!Object.keys(dates).length) throw new Error("NASA GIBS reported no dates");
    return Response.json({ dates, cloudDate: datesById.get("MODIS_Terra_Cloud_Fraction_Day") },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "NASA imagery dates could not be refreshed." }, { status: 502 });
  }
}

type RecordEntry = {
  title: string; time_start: string; polygons?: string[][];
  links?: { href?: string; rel?: string; inherited?: boolean }[];
};

function footprint(row: RecordEntry) {
  return (row.polygons ?? []).flatMap(group => group.flatMap(ring => {
    const values = ring.trim().split(/\s+/).map(Number);
    if (values.length < 6 || values.length % 2 || values.some(value => !Number.isFinite(value))) return [];
    const coords = [];
    for (let index = 0; index < values.length; index += 2) coords.push([values[index + 1], values[index]]);
    if (coords[0][0] !== coords.at(-1)?.[0] || coords[0][1] !== coords.at(-1)?.[1]) coords.push(coords[0]);
    return [{ type: "Feature" as const, properties: { title: row.title }, geometry: { type: "Polygon" as const, coordinates: [coords] } }];
  }));
}

export async function POST(request: Request) {
  const selection = readSelection(await request.json().catch(() => null));
  if (!selection) return Response.json({ error: "Choose a valid field, dataset, and date." }, { status: 400 });
  const url = catalogUrl(selection);
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Earthdata request failed");
    const result = await response.json();
    if (!Array.isArray(result.feed?.entry)) throw new Error("Invalid catalog response");
    return Response.json({
      scenes: result.feed.entry.map((row: RecordEntry) => ({
        title: row.title, time: row.time_start,
        footprints: footprint(row),
        files: (row.links ?? []).flatMap(link => !link.inherited && link.rel?.endsWith("/data#") &&
          link.href?.startsWith("https://") && /\.(nc|zip|tar|img)(?:\?|$)/i.test(link.href) ? [link.href] : []).slice(0, 5),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "NASA Earthdata could not return science-file matches. Try another date or open the source query." }, { status: 502 });
  }
}
