import { fromArrayBuffer } from "geotiff";
import { csbSource } from "./crop-sequence";
import { cropHistorySource, plotCropHistory } from "./plot-crop-history";

export const soilSource = "https://isric.org/explore/soilgrids";
const depths = ["0-5", "5-15", "15-30"];

export async function soilProfile(lat: number, lon: number) {
  const radius = 0.001;
  const bounds = [Math.max(-180, lon - radius), Math.max(-90, lat - radius),
    Math.min(180, lon + radius), Math.min(90, lat + radius)];
  const samples = await Promise.all(depths.map(async depth => {
    const url = "https://maps.isric.org/mapserv?" + new URLSearchParams({
      map: "/map/phh2o.map", SERVICE: "WCS", VERSION: "1.0.0", REQUEST: "GetCoverage",
      COVERAGE: `phh2o_${depth}cm_mean`, CRS: "EPSG:4326", BBOX: bounds.join(","),
      WIDTH: "1", HEIGHT: "1", FORMAT: "GEOTIFF_INT16",
    });
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("image/tiff")) throw new Error("Soil sample unavailable");
      const tiff = await fromArrayBuffer(await response.arrayBuffer());
      const image = await tiff.getImage();
      const values = await image.readRasters({ samples: [0], interleave: true });
      const raw = values[0];
      return { depth, ph: raw >= 0 && raw <= 140 && raw !== image.getGDALNoData() ? raw / 10 : null };
    } catch {
      return { depth, ph: null };
    }
  }));
  return { samples, lat, lon, source: soilSource };
}

export async function soilAdvice(center: unknown, rotation: boolean) {
  const [lon, lat] = Array.isArray(center) ? center : [];
  const valid = Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
  const [soil, sequence] = valid ? await Promise.all([
    soilProfile(lat, lon),
    rotation ? plotCropHistory(lat, lon).catch(() => null) : null,
  ]) : [null, null];
  const readings = soil?.samples.flatMap(({ depth, ph }) => ph === null ? [] : [`${depth} cm: pH ${ph.toFixed(1)}`]) ?? [];
  const summary = readings.length
    ? `ISRIC SoilGrids modeled pH in water at ${lat.toFixed(4)}, ${lon.toFixed(4)} on a nominal 250 m grid. ${readings.join(" · ")}.`
    : "No modeled soil pH was available for this point.";
  const mapped = sequence?.fields.map(field =>
    `${cropHistorySource[sequence.method]}: ${field.history.map(row => `${row.year} ${row.crop}`).join(", ")}.`) ?? [];
  const cropHistory = mapped.length
    ? [...mapped, "Confirm the crop sequence for the full plot using farm records."]
    : [sequence?.status === "outside" ? "The connected crop inventories have no coverage at this location."
      : sequence?.status === "empty" ? "The connected sources have no mapped crop history at this point."
      : "Crop history could not be retrieved for this point."];
  return {
    answer: [summary,
      ...(rotation ? cropHistory : []),
      "Use a lab soil test and your next crop’s target range before choosing amendments. Keep the sampling depth and method consistent so you can compare results over time.",
      ...(rotation ? ["To compare rotations, bring the last three to five seasons of crop and variety history, your candidate crops, irrigation and drainage, and any recurring pest, disease or resistance issues. Use field records to confirm satellite crop classifications. Compare planting windows, water demand, and the effect of each crop on the following season."] : []),
      "For a long-term plan, track soil pH and organic matter, months with living cover, irrigation water used, yield and input costs. Consider crop-family diversity, cover crops suited to water availability, and reduced disturbance where your soil and equipment allow. Record a baseline and compare the same indicators each season.",
    ].join("\n\n"),
    sources: [
      { title: "ISRIC SoilGrids", url: soilSource },
      { title: "Soil pH and laboratory testing", url: "https://www.udel.edu/academics/colleges/canr/cooperative-extension/fact-sheets/measurement-management-pH/" },
      { title: "USDA soil health principles", url: "https://www.farmers.gov/conservation/soil-health" },
      ...(rotation ? [
        { title: sequence ? cropHistorySource[sequence.method] : "USDA Crop Sequence Boundaries",
          url: sequence?.documentation ?? csbSource },
        ...(sequence?.status === "found" && sequence.url !== sequence.documentation ? [{ title: "Crop records for the selected point", url: sequence.url }] : []),
        { title: "ESA WorldCereal · global 2021 crop maps", url: "https://esa-worldcereal.org/en/products/global-maps" },
      ] : []),
    ],
  };
}
