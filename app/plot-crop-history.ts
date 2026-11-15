import { cropSequence } from "./crop-sequence";
import { canadaCropHistory, franceCropHistory, francePlotHistories, netherlandsCropHistory } from "./international-crop-history";
import { kenyaCropHistory } from "./kenya-crop-history";
import { indiaRiceHistory } from "./india-rice-history";
import { worldCerealCropHistory } from "./worldcereal-crop-history";

const service = "https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer";
const cdlSource = "https://www.nass.usda.gov/Research_and_Science/Cropland/Release/";
const cdlPolygonSource = "https://www.nass.usda.gov/Research_and_Science/Cropland/metadata/meta.php";

export const cropHistorySource = {
  csb: "USDA Crop Sequence Boundaries", cdl: "USDA Cropland Data Layer",
  aci: "Canada Annual Crop Inventory", rpg: "France Registre Parcellaire Graphique",
  brp: "Netherlands RVO · BRP crop parcels",
  mapbiomas: "MapBiomas Brazil · Collection 7.1 (through 2021)",
  kenya: "Copernicus4GEOGLAM Kenya · seasonal crop maps",
  indiaRice: "Paddy rice maps · reference-year composites and seasonal rasters",
  worldcereal: "ESA WorldCereal · 2021 winter cereal group",
};

const inFranceInventoryRegion = ([lon, lat]: [number, number]) => lat >= 41 && lat <= 52 && lon >= -6 && lon <= 10;
const nearNetherlands = ([lon, lat]: [number, number]) => lat >= 50.7 && lat <= 53.6 && lon >= 3.3 && lon <= 7.3;

export async function plotCropHistories(points: [number, number][]) {
  if (points.length > 1 && points.every(point => inFranceInventoryRegion(point) && !nearNetherlands(point) &&
    Math.abs(point[0] - points[0][0]) < 0.025 && Math.abs(point[1] - points[0][1]) < 0.025)) {
    const histories = await francePlotHistories(points);
    if (histories.some(result => result.status === "fulfilled" && !result.value.incompleteYears.length)) return histories;
  }
  return Promise.allSettled(points.map(([lon, lat]) => plotCropHistory(lat, lon)));
}

function probablyInCanada(lat: number, lon: number) {
  return lat >= 41 && lat <= 84 && lon >= -141 && lon <= -52;
}

async function read(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("USDA Cropland Data Layer is unavailable");
  const data = await response.json();
  if (data.error) throw new Error("USDA Cropland Data Layer query failed");
  return data;
}

const mapBiomasSource = "https://ic.imagery1.arcgis.com/arcgis/rest/services/MapBiomas/ImageServer";
const mapBiomasNames = new Map([[39, "Soybeans"], [40, "Rice"], [41, "Other temporary crops"], [62, "Cotton"]]);

async function brazilCropHistory(lat: number, lon: number) {
  const url = mapBiomasSource + "/identify?" + new URLSearchParams({
    f: "json", geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", returnCatalogItems: "true", returnPixelValues: "true", returnGeometry: "false",
  });
  const data = await read(url);
  const values: unknown = data.properties?.Values;
  const rasters: unknown = data.catalogItems?.features;
  const result = { method: "mapbiomas" as const, documentation: mapBiomasSource, url };
  if (!data.catalogItems && (data.value === "NoData" || data.value === null)) {
    return { ...result, status: "outside", fields: [] };
  }
  if (!Array.isArray(values) || !Array.isArray(rasters) || values.length !== rasters.length) {
    throw new Error("Unexpected MapBiomas sample response");
  }
  const rows = new Map<number, { year: number; code: number; crop: string }>();
  for (const [index, raster] of rasters.entries()) {
    const { Year, Category, ProductName } = raster?.attributes ?? {};
    const code = Number(values[index]);
    if (Category !== 1 || ProductName !== "Collection 7.1" || !Number.isInteger(Year) ||
      Year < 1985 || Year > 2021 || !Number.isInteger(code) || code <= 0) continue;
    rows.set(Year, { year: Year, code, crop: mapBiomasNames.get(code) ?? `MapBiomas class ${code}` });
  }
  const history = [...rows.values()].sort((a, b) => a.year - b.year).slice(-12);
  return { ...result, status: history.length ? "found" : "outside",
    fields: history.length ? [{ id: "mapbiomas-pixel", acres: null, county: "", history }] : [] };
}

export async function plotCropHistory(lat: number, lon: number) {
  if (nearNetherlands([lon, lat])) {
    const dutch = await netherlandsCropHistory(lat, lon);
    if (dutch.status === "found" || !inFranceInventoryRegion([lon, lat])) return dutch;
  }
  if (inFranceInventoryRegion([lon, lat])) return franceCropHistory(lat, lon);
  if (lat >= -34.8 && lat <= 7.9 && lon >= -74.9 && lon <= -33.06) return brazilCropHistory(lat, lon);
  if (lat >= -4.8 && lat <= 1.4 && lon >= 33.8 && lon <= 40.3) return kenyaCropHistory(lat, lon);
  if (lat >= 20.12 && lat <= 35.5 && lon >= 68.18 && lon <= 84.63) return indiaRiceHistory(lat, lon);
  if (lat >= -44 && lat <= -10 && lon >= 112 && lon <= 154) return worldCerealCropHistory(lat, lon);
  const csb = await cropSequence(lat, lon).catch(() => null);
  if (csb?.status === "found" && csb.fields.length === 1) return { ...csb, method: "csb" as const };
  if (lat < 24 || lat > 50 || lon < -125 || lon > -66) {
    if (probablyInCanada(lat, lon)) return canadaCropHistory(lat, lon);
    return { status: "outside", method: "cdl" as const, fields: [], url: cdlSource, documentation: cdlSource };
  }

  const query = new URLSearchParams({
    f: "json",
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", returnCatalogItems: "true", returnGeometry: "false", returnPixelValues: "true",
  });
  const url = service + "/identify?" + query;
  const data = await read(url);
  const values: unknown = data.properties?.Values;
  const rasters: unknown = data.catalogItems?.features;
  if (!Array.isArray(values) || !Array.isArray(rasters) || values.length !== rasters.length) {
    throw new Error("Unexpected USDA crop pixel response");
  }
  const years = new Map<number, { code: number; resolution: number }>();
  for (let index = 0; index < rasters.length; index++) {
    const { Year, Category, LowPS } = rasters[index]?.attributes ?? {};
    const code = Number(values[index]);
    const current = years.get(Year);
    if (Category === 1 && Number.isInteger(Year) && Year >= 2008 && Number.isInteger(code) && code > 0 &&
        Number.isFinite(LowPS) && (!current || LowPS < current.resolution)) {
      years.set(Year, { code, resolution: LowPS });
    }
  }
  if (!years.size) {
    if (csb?.status === "found") return { ...csb, method: "csb" as const };
    if (probablyInCanada(lat, lon)) return canadaCropHistory(lat, lon);
    return { status: "empty", method: "cdl" as const, fields: [], url, documentation: cdlSource };
  }
  const names = await cropNames();
  const history = [...years.entries()].sort(([a], [b]) => a - b).slice(-8)
    .map(([year, { code }]) => ({ year, code, crop: names.get(code) ?? `CDL code ${code}` }));
  return { status: "found", method: "cdl" as const, url, documentation: cdlSource,
    fields: [{ id: "center-pixel", acres: null, county: "", history }] };
}

async function cropNames() {
  const legend = await read(service + "/rasterAttributeTable?f=json");
  return new Map((legend.features as { attributes: { Value: number; Class_Names: string } }[])
    .map(({ attributes }) => [attributes.Value, attributes.Class_Names]));
}

export async function cropAreaByYear(boundary: [number, number][]) {
  if (!boundary.every(([lon, lat]) => lon >= -125 && lon <= -66 && lat >= 24 && lat <= 50)) return null;
  // Esri expects an exterior ring in clockwise order.
  const winding = boundary.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = boundary[(i + 1) % boundary.length];
    return sum + (nextX - x) * (nextY + y);
  }, 0);
  const ring = winding > 0 ? boundary : [...boundary].reverse();
  const geometry = JSON.stringify({ rings: [[...ring, ring[0]]], spatialReference: { wkid: 4326 } });
  const years = [2023, 2024, 2025];
  const [names, results] = await Promise.all([
    cropNames(),
    Promise.allSettled(years.map(async year => {
      const resolution = year >= 2024 ? 10 : 30;
      const data = await read(service + "/computeHistograms?" + new URLSearchParams({
        f: "json", geometry, geometryType: "esriGeometryPolygon",
        mosaicRule: JSON.stringify({ mosaicMethod: "esriMosaicAttribute", where: `Category = 1 AND Year = ${year}`,
          sortField: "LowPS", sortValue: "0" }),
        pixelSize: JSON.stringify({ x: resolution, y: resolution, spatialReference: { wkid: 3857 } }),
      }));
      const histogram = data.histograms?.[0];
      const counts: unknown = histogram?.counts;
      const firstCode = histogram?.min + 0.5;
      if (!Array.isArray(counts) || !Number.isInteger(firstCode) || histogram.max - histogram.min !== counts.length ||
          !counts.every(count => Number.isSafeInteger(count) && count >= 0)) return null;
      return { year, counts, firstCode };
    })),
  ]);
  const records = results.flatMap(result => {
    if (result.status !== "fulfilled" || !result.value) return [];
    const { year, counts, firstCode } = result.value;
    const classes = counts.flatMap((count, index) => {
      const code = index + firstCode;
      return code > 0 && count > 0 ? [{ crop: names.get(code) ?? `CDL code ${code}`, count }] : [];
    }).sort((a, b) => b.count - a.count);
    const total = classes.reduce((sum, item) => sum + item.count, 0);
    if (!total) return [];
    const leadingClasses = classes.slice(0, 4);
    const doubleCrop = classes.find(({ crop }) => crop.toLowerCase().trim() === "dbl crop winwht/soybeans");
    if (doubleCrop && !leadingClasses.includes(doubleCrop)) leadingClasses.push(doubleCrop);
    const summary = leadingClasses.map(({ crop, count }) => `${crop} ${(100 * count / total).toFixed(1)}%`).join(", ");
    return [`${year} · ${summary} (${total.toLocaleString("en-US")} mapped cells).`];
  });
  return records.length ? { records, source: { title: "USDA Cropland Data Layer · annual class maps", url: cdlPolygonSource } } : null;
}
