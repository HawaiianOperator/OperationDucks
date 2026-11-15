const layer = "https://services3.arcgis.com/g6eV2CrSSwCZj8Mc/arcgis/rest/services/NASS_Crop_Sequence_Boundaries_2024/FeatureServer/0";
export const csbSource = "https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/";
const years = Array.from({ length: 8 }, (_, index) => 2017 + index);
type CropField = { name: string; domain?: { codedValues?: { code: number; name: string }[] } };
type Attributes = { CSBID: string; CSBACRES: number; CNTY: string } & Record<`CDL${number}`, number | null>;

async function read(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("USDA CSB is unavailable");
  const data = await response.json();
  if (data.error) throw new Error("USDA CSB query failed");
  return data;
}

export async function cropSequence(lat: number, lon: number) {
  const query = new URLSearchParams({
    f: "json", where: "1=1", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint",
    inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "false",
    outFields: ["CSBID", "CSBACRES", "CNTY", ...years.map(year => `CDL${year}`)].join(","),
  });
  const url = layer + "/query?" + query;
  const source = { url, documentation: csbSource };
  // The public ArcGIS layer contains Minnesota records. Its extent overlaps nearby states.
  if (lat < 43.4 || lat > 49.5 || lon < -97.3 || lon > -90.2) return { ...source, status: "outside", fields: [] };
  const data = await read(url);
  if (!Array.isArray(data.features)) throw new Error("Unexpected USDA CSB response");
  if (data.features.length === 0) return { ...source, status: "empty", fields: [] };
  const metadata = await read(layer + "?f=json");
  const labels = new Map((metadata.fields as CropField[]).map(field => [
    field.name, new Map(field.domain?.codedValues?.map(item => [item.code, item.name])),
  ]));
  const fields = (data.features as { attributes: Attributes }[]).map(({ attributes }) => ({
    id: attributes.CSBID, acres: attributes.CSBACRES, county: attributes.CNTY,
    history: years.map(year => {
      const key = `CDL${year}` as const;
      const code = attributes[key] ?? null;
      return { year, code, crop: code === null ? "Unavailable" : labels.get(key)?.get(code) ?? `CDL code ${code}` };
    }),
  }));
  return { ...source, status: "found", fields };
}
