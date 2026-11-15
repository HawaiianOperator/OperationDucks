import { NextRequest, NextResponse } from "next/server";
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from "satellite.js";
import { satelliteGroups, type Spacecraft } from "../../spacecraft";

const ttl = 2 * 60 * 60 * 1000;
const catalog = (group: string) => group === "starlink-supplemental"
  ? "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json"
  : `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
type Entry = { name: string; norad: number; epoch: string; period: number; record: ReturnType<typeof json2satrec> };
type Feed = { entries: Entry[]; stale: boolean };
const cache = new Map<string, { expires: number; result: Promise<Feed> }>();
const lastGood = new Map<string, Entry[]>();

function elements(group: string) {
  const existing = cache.get(group);
  if (existing && existing.expires > Date.now()) return existing.result;
  const result = (async () => {
    const response = await fetch(catalog(group), { next: { revalidate: ttl / 1000 }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`CelesTrak HTTP ${response.status}`);
    const rows: Parameters<typeof json2satrec>[0][] = await response.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error("Empty orbital feed");
    const entries = rows.flatMap(row => {
      const norad = Number(row.NORAD_CAT_ID);
      const motion = Number(row.MEAN_MOTION);
      if (!Number.isSafeInteger(norad) || !(motion > 0) || !Number.isFinite(Date.parse(row.EPOCH))) return [];
      try {
        return [{ name: row.OBJECT_NAME, norad, epoch: row.EPOCH, period: 1440 / motion, record: json2satrec(row) }];
      } catch {
        return [];
      }
    });
    if (!entries.length) throw new Error("No usable orbital elements");
    lastGood.set(group, entries);
    return { entries, stale: false };
  })().catch(error => {
    const entries = lastGood.get(group);
    if (entries) return { entries, stale: true };
    throw error;
  });
  const entry = { expires: Date.now() + ttl, result };
  cache.set(group, entry);
  return result;
}

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category") ?? "active";
  if (!Object.hasOwn(satelliteGroups, category)) return NextResponse.json({ error: "Unknown satellite category." }, { status: 400 });
  const groups = satelliteGroups[category as keyof typeof satelliteGroups].feeds;
  let results = await Promise.allSettled(groups.map(elements));
  const failed = groups.filter((_, index) => results[index].status === "rejected");
  let selectedGroups = groups;
  if (category === "active" && failed.length) {
    // Start with the highest-coverage fallback groups. Other groups load on demand.
    const fallback = ["starlink", "oneweb", "gnss", "weather", "resource", "military", "stations", "science"];
    results = await Promise.allSettled(fallback.map(elements));
    selectedGroups = fallback;
    failed.push(...fallback.filter((_, index) => results[index].status === "rejected"));
  }
  if (failed.includes("starlink")) {
    const supplemental = "starlink-supplemental";
    const [result] = await Promise.allSettled([elements(supplemental)]);
    results = [...results, result];
    selectedGroups = [...selectedGroups, supplemental];
    if (result.status === "rejected") failed.push(supplemental);
  }
  if (results.every(result => result.status === "rejected")) {
    return NextResponse.json({ error: "CelesTrak orbital feed is unavailable.", failed }, { status: 502 });
  }
  const now = new Date();
  const sidereal = gstime(now);
  const unique = new Set<number>();
  const features: GeoJSON.Feature<GeoJSON.Point, Spacecraft>[] = [];
  const stale = selectedGroups.filter((_, index) => {
    const result = results[index];
    return result.status === "fulfilled" && result.value.stale;
  });
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const { name, norad, epoch, period, record } of result.value.entries) {
      if (unique.has(norad)) continue;
      const position = propagate(record, now)?.position;
      if (!position) continue;
      const { longitude, latitude, height } = eciToGeodetic(position, sidereal);
      if (![latitude, longitude, height].every(Number.isFinite) || height < 0) continue;
      unique.add(norad);
      const key = String(norad);
      features.push({
        type: "Feature", id: key,
        geometry: { type: "Point", coordinates: [degreesLong(longitude), degreesLat(latitude)] },
        properties: { key, name, norad, epoch, period, height },
      });
    }
  }
  return NextResponse.json({ points: { type: "FeatureCollection", features }, at: now.toISOString(), failed, stale }, {
    headers: { "Cache-Control": "no-store" },
  });
}
