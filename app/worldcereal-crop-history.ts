const collection = "esa-worldcereal-wintercereals-10m-2021-v1";
const documentation = "https://esa-worldcereal.org/en/products/global-maps";

async function read(url: string) {
  const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("WorldCereal lookup failed");
  return response.json();
}

export async function worldCerealCropHistory(lat: number, lon: number) {
  // Share a small catalog search across nearby points, then query each exact location.
  const west = Math.floor(lon * 20) / 20;
  const south = Math.floor(lat * 20) / 20;
  const query = new URLSearchParams({ collections: collection,
    bbox: [west, south, west + 0.05, south + 0.05].join(","), limit: "10" });
  const url = `https://stac.terrascope.be/search?${query}`;
  const source = { method: "worldcereal" as const, documentation, url };
  const catalog = await read(url);
  if (!Array.isArray(catalog.features)) throw new Error("Invalid WorldCereal catalog response");
  const items = catalog.features.filter(item => item.collection === collection &&
    typeof item.id === "string" && /^\d+_tc-wintercereals_wintercereals_2021$/.test(item.id) &&
    Array.isArray(item.bbox) && item.bbox.length === 4 && lon >= item.bbox[0] && lon <= item.bbox[2] &&
    lat >= item.bbox[1] && lat <= item.bbox[3]);
  const results = await Promise.allSettled(items.map(async item => {
    const point = await read(`https://titiler.terrascope.be/collections/${collection}/items/${item.id}/point/${lon},${lat}?assets=classification`);
    if (!Array.isArray(point.coordinates) || Math.abs(point.coordinates[0] - lon) > 0.000001 ||
      Math.abs(point.coordinates[1] - lat) > 0.000001 || !Array.isArray(point.values)) {
      throw new Error("Invalid WorldCereal point response");
    }
    return point.values[0];
  }));
  const values = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!values.includes(100) && results.some(result => result.status === "rejected")) {
    throw new Error("Some WorldCereal crop observations were unavailable");
  }
  // Keep the published crop group. A negative or conflicting value identifies no crop.
  return values.includes(100) && !values.includes(0)
    ? { ...source, status: "found", fields: [{ id: "worldcereal-pixel", acres: null, county: "",
      history: [{ year: 2021, code: 100, crop: "Winter cereals (crop group)" }] }] }
    : { ...source, status: "empty", fields: [] };
}
