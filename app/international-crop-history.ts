const canadaService = "https://agriculture.canada.ca/imagery-images/rest/services/annual_crop_inventory";
const canadaDocumentation = "https://agriculture.canada.ca/atlas/annual-crop-inventory";
const franceService = "https://data.geopf.fr/wfs/ows";
const franceDocumentation = "https://www.data.gouv.fr/datasets/rpg";
const years = [2021, 2022, 2023, 2024, 2025];

type CropRow = { year: number; code: number; crop: string };

async function read(url: string) {
  const response = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("Crop inventory request failed");
  return response;
}

async function mappedHistory(
  method: "aci" | "rpg", documentation: string, query: (year: number) => Promise<CropRow | null>,
) {
  return historyResult(method, documentation, await Promise.allSettled(years.map(query)));
}

function historyResult(method: "aci" | "rpg", documentation: string, results: PromiseSettledResult<CropRow | null>[]) {
  if (results.every(result => result.status === "rejected")) throw new Error("Crop inventory unavailable");
  const history = results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (!history.length && results.some(result => result.status === "rejected")) {
    throw new Error("Some years could not be checked");
  }
  return {
    method, documentation, url: documentation, status: history.length ? "found" : "empty",
    incompleteYears: years.filter((_, index) => results[index].status === "rejected"),
    fields: history.length ? [{ id: "sample-location", acres: null, county: "", history }] : [],
  };
}

export async function canadaCropHistory(lat: number, lon: number) {
  const legendUrl = "https://agriculture.canada.ca/atlas/data_donnees/annualCropInventory/supportdocument_documentdesupport/aci_crop_classifications_iac_classifications_des_cultures.csv";
  const legend = await (await read(legendUrl)).text();
  const names = new Map(legend.split(/\r?\n/).flatMap(line => {
    const [code, , , , , label] = line.split(",");
    return /^\d+$/.test(code) && label ? [[Number(code), label.trim()] as const] : [];
  }));
  if (!names.size) throw new Error("Canadian crop inventory legend unavailable");
  return mappedHistory("aci", canadaDocumentation, async year => {
    const params = new URLSearchParams({
      f: "json", geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPoint", returnGeometry: "false", returnCatalogItems: "false",
    });
    const data = await (await read(`${canadaService}/${year}/ImageServer/identify?${params}`)).json();
    if (data.error || !Object.hasOwn(data, "value")) throw new Error("Canadian crop inventory query failed");
    const code = Number(data.value);
    const crop = names.get(code);
    return crop && code !== 10 ? { year, code, crop } : null;
  });
}

function inRing(lon: number, lat: number, ring: GeoJSON.Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i];
    const [otherX, otherY] = ring[j];
    if ((y > lat) !== (otherY > lat) && lon < x + (lat - y) * (otherX - x) / (otherY - y)) inside = !inside;
  }
  return inside;
}

function franceQuery(typeNames: string, extra: Record<string, string> = {}) {
  return franceService + "?" + new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeNames, outputFormat: "application/json", ...extra,
  });
}

type CropParcel = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

export async function francePlotHistories(points: [number, number][]) {
  const longitudes = points.map(([lon]) => lon);
  const latitudes = points.map(([, lat]) => lat);
  const bbox = [Math.min(...longitudes) - 0.00001, Math.min(...latitudes) - 0.00001,
    Math.max(...longitudes) + 0.00001, Math.max(...latitudes) + 0.00001, "CRS:84"].join(",");
  const legends = new Map<string, Promise<string>>();
  async function cropName(year: number, code: string) {
    const layer = year >= 2024 ? "RPG.2024" : "RPG.2022";
    const url = franceQuery(`${layer}:codes_cultures`, { CQL_FILTER: `code='${code}'`, count: "1" });
    if (!legends.has(url)) legends.set(url, read(url).then(async response => {
      const data = await response.json();
      const crop = data.features?.[0]?.properties?.libelle;
      if (typeof crop !== "string") throw new Error("Crop legend label unavailable");
      return crop;
    }));
    return legends.get(url);
  }

  const results = await Promise.allSettled(years.map(async year => {
    const layer = year === 2025 ? "LANDUSE.AGRICULTURE2025" : `RPG.${year}`;
    const url = franceQuery(`${layer}:parcelles_graphiques`, {
      bbox, srsName: "EPSG:4326", count: "200",
    });
    const data = await (await read(url)).json() as { features: CropParcel[]; numberMatched?: number };
    if (!Array.isArray(data.features) || data.features.length >= 200 || data.numberMatched > data.features.length) {
      throw new Error("Incomplete parcel query");
    }
    return Promise.allSettled(points.map(async ([lon, lat]) => {
      const matches = data.features.filter(({ geometry }) => {
        const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
        return polygons.some(([shell, ...holes]) => inRing(lon, lat, shell) && !holes.some(hole => inRing(lon, lat, hole)));
      });
      const key: unknown = matches.length === 1 ? matches[0].properties?.code_cultu : null;
      return typeof key === "string" && /^[A-Z0-9]{2,4}$/.test(key) ? { year, code: 1, crop: await cropName(year, key) } : null;
    }));
  }));
  return Promise.allSettled(points.map(async (_, index) => historyResult("rpg", franceDocumentation,
    results.map(result => result.status === "fulfilled" ? result.value[index] : result))));
}

export async function franceCropHistory(lat: number, lon: number) {
  const [result] = await francePlotHistories([[lon, lat]]);
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

export async function netherlandsCropHistory(lat: number, lon: number) {
  const documentation = "https://www.pdok.nl/ogc-apis/-/article/basisregistratie-gewaspercelen-brp-";
  const url = "https://api.pdok.nl/rvo/gewaspercelen/ogc/v1/collections/brpgewas/items?" + new URLSearchParams({
    f: "json", bbox: [lon - 0.00001, lat - 0.00001, lon + 0.00001, lat + 0.00001].join(","), limit: "20",
  });
  const data = await (await read(url)).json() as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  if (!Array.isArray(data.features) || data.features.length >= 20) throw new Error("Incomplete Dutch parcel response");
  const fields = data.features.flatMap(({ id, geometry, properties }) => {
    if (properties?.category !== "Bouwland" || properties.status !== "Definitief" ||
      typeof properties.gewas !== "string" || !Number.isInteger(properties.gewascode) || !Number.isInteger(properties.jaar)) return [];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    if (!polygons.some(([shell, ...holes]) => inRing(lon, lat, shell) && !holes.some(hole => inRing(lon, lat, hole)))) return [];
    return [{ id: String(id ?? "brp-point"), acres: null, county: "",
      history: [{ year: Number(properties.jaar), code: Number(properties.gewascode), crop: properties.gewas }] }];
  });
  return { method: "brp" as const, documentation, url, status: fields.length === 1 ? "found" : "outside",
    fields: fields.length === 1 ? fields : [] };
}
