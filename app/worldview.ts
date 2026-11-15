export const layers = {
  smap: { name: "SMAP root-zone soil moisture", id: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", zoom: 6, format: "png", product: "SPL4SMAU" },
  terra: { name: "MODIS Terra true color", id: "MODIS_Terra_CorrectedReflectance_TrueColor", zoom: 9, format: "jpeg", product: "MOD09" },
  aqua: { name: "MODIS Aqua true color", id: "MODIS_Aqua_CorrectedReflectance_TrueColor", zoom: 9, format: "jpeg", product: "MYD09" },
  noaa20: { name: "VIIRS NOAA-20 true color", id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", zoom: 9, format: "jpeg", product: "VJ109_NRT" },
  noaa21: { name: "VIIRS NOAA-21 true color", id: "VIIRS_NOAA21_CorrectedReflectance_TrueColor", zoom: 9, format: "jpeg", product: "VJ209_NRT" },
  pace: { name: "PACE OCI true color", id: "OCI_PACE_True_Color", zoom: 7, format: "jpeg", product: "PACE_OCI_L1B_SCI" },
  rain: { name: "IMERG precipitation rate", id: "IMERG_Precipitation_Rate", zoom: 6, format: "png", product: "GPM_3IMERGHHE" },
  heat: { name: "MODIS daytime land surface temperature", id: "MODIS_Terra_Land_Surface_Temp_Day", zoom: 7, format: "png", product: "MOD11A1" },
  emit: { name: "EMIT hyperspectral reflectance", product: "EMITL2ARFL" },
  aviris: { name: "AVIRIS-NG airborne hyperspectral reflectance", product: "AVIRIS-NG_L2_Reflectance_2110" },
} as const;

export type LayerKey = keyof typeof layers;
export type Bounds = [west: number, south: number, east: number, north: number];
export type Selection = { layer: LayerKey; date: string; bounds: Bounds };
export type DatasetContext = Selection & { place: string; hectares: number };

export function imageryLayer(layer: LayerKey) {
  const info = layers[layer];
  return "id" in info ? info : null;
}

export function tileUrl(layer: LayerKey, date: string) {
  const info = imageryLayer(layer);
  if (!info) return null;
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${info.id}/default/${date}/GoogleMapsCompatible_Level${info.zoom}/{z}/{y}/{x}.${info.format}`;
}

export function worldviewUrl({ layer, date, bounds }: Selection) {
  const [w, s, e, n] = bounds;
  const x = Math.max((e - w) * 0.12, 0.035), y = Math.max((n - s) * 0.12, 0.035);
  const query = new URLSearchParams({
    v: [w - x, Math.max(-90, s - y), e + x, Math.min(90, n + y)].join(","),
    l: layer === "smap" ? `${layers.smap.id},Coastlines_15m,${layers.terra.id}` : `Coastlines_15m,${imageryLayer(layer)?.id ?? layers.terra.id}`,
    lg: "true", t: date,
  });
  return "https://worldview.earthdata.nasa.gov/?" + query;
}

export function catalogUrl({ layer, date, bounds }: Selection) {
  const [west, south, east, north] = bounds;
  const longitude = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  const start = new Date(date);
  if (!imageryLayer(layer)) start.setUTCDate(start.getUTCDate() - 364);
  const query = new URLSearchParams({
    short_name: layers[layer].product,
    temporal: `${start.toISOString().slice(0, 10)}T00:00:00Z,${date}T23:59:59Z`,
    bounding_box: [longitude(west), south, longitude(east), north].join(","),
    page_size: "6", sort_key: "-start_date",
  });
  return "https://cmr.earthdata.nasa.gov/search/granules.json?" + query;
}

export function readSelection(input: unknown): Selection | null {
  if (!input || typeof input !== "object") return null;
  const { layer, date, bounds } = input as Partial<Selection>;
  if (!layer || !Object.hasOwn(layers, layer) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(date);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
  const [w, s, e, n] = bounds;
  if (w < -180 || w >= 180 || e <= w || e > w + 360 || s < -90 || n > 90 || s >= n) return null;
  return { layer, date, bounds };
}

export function explain(question: string, context: DatasetContext) {
  const { layer, place, hectares, date } = context;
  if (!imageryLayer(layer)) {
    const resolution = layer === "emit"
      ? "EMIT is an instrument on the International Space Station. Its Level 2A reflectance data have nominal 60 m pixels and include uncertainty information. Coverage varies by overpass."
      : "AVIRIS-NG is an airborne instrument. Spatial resolution and availability vary by flight line and campaign.";
    return {
      answer: `${layers[layer].name} · ${place} · ${hectares.toLocaleString("en-US", { maximumFractionDigits: 3 })} ha\n\n${resolution}\n\nHyperspectral reflectance measures how much light the surface reflects in many narrow wavelength bands. Crop and soil analysis requires extracting spectra inside the field, screening clouds and bad pixels, and validating the interpretation against field observations. A catalog match gives the acquisition and file location. It cannot establish a crop condition or a field-average reflectance reading.\n\nThe catalog searches the 365 days ending ${date} UTC.`,
      sources: [{ title: "NASA Earthdata matches for this field", url: catalogUrl(context) },
        ...(layer === "emit" ? [{ title: "NASA AppEEARS spectral extraction", url: "https://appeears.earthdatacloud.nasa.gov/" }] : [])],
    };
  }
  if (layer === "rain" || layer === "heat") {
    const explanation = layer === "rain"
      ? "IMERG combines observations from multiple satellites to estimate precipitation. This layer displays a daily average precipitation rate in millimetres per hour. Compare it with local rain gauges when making field decisions."
      : "MODIS estimates daytime land surface temperature under clear skies. It represents the temperature of the visible surface, which can differ substantially from air temperature. Cloud cover can leave gaps.";
    return {
      answer: `${layers[layer].name} · ${place} · ${date} UTC\n\n${explanation}`,
      sources: [{ title: "NASA Worldview for this field and date", url: worldviewUrl(context) },
        { title: "Related NASA Earthdata science files", url: catalogUrl(context) }],
    };
  }
  const smap = layer === "smap";
  const measurement = smap
    ? "SMAP estimates the average volume of water per volume of soil in the top 100 cm. For example, 0.25 m³/m³ means about 25% of the soil volume is water. Worldview shows a daily 12:00 UTC visualization on a nominal 9 km grid."
    : "This true-color image combines visible bands into a natural-looking view. Clouds and shadows can hide or change the appearance of the ground. Brightness and color alone cannot establish soil moisture, crop health, or yield.";
  const practical = smap
    ? "Compare the same grid cell across several dates to see regional wetting or drying. Check field probes, soil texture, and crop rooting depth before making irrigation or planting decisions."
    : layer === "pace"
      ? "PACE OCI is primarily an ocean-color instrument. Use this image for broad coastal, water, and cloud context. For crop analysis, use a field-scale reflectance or vegetation product."
      : "Compare dates for cloud cover, smoke, broad inundation patterns, or visible landscape changes. For crop vigor, use a validated vegetation index with cloud and quality masks.";
  const resolution = smap
    ? "A 9 km SMAP cell often contains many fields, soil types, and irrigation conditions. A mapped farm boundary gives you its area; the underlying moisture is a regional estimate."
    : "A drawn boundary gives the field area. The imagery is a satellite browse layer, and zooming in does not improve its native spatial resolution.";
  const questionText = question.toLowerCase();
  const coverage = "A matching catalog footprint means a file overlaps the bounding box. The selected field may still include cloudy, masked, or missing pixels. Check the image and the science file’s quality flags before interpreting a reading.";
  const detail = /\b(irrigat\w*|plant\w*|dry|wet|drought|use|decision|action)\b/.test(questionText) ? [practical, measurement, resolution]
    : /\b(resolution|accur\w*|trust|pixel|field|area)\b/.test(questionText) ? [resolution, measurement, practical]
    : /\b(missing|coverage|available|blank|clouds?|quality)\b/.test(questionText) ? [coverage, measurement, practical]
    : [measurement, practical, resolution];
  return {
    answer: `${layers[layer].name} · ${place} · ${hectares.toLocaleString("en-US", { maximumFractionDigits: 3 })} ha · ${date} UTC\n\n${detail.join("\n\n")}`,
    sources: [{ title: "NASA Worldview for this field and date", url: worldviewUrl(context) },
      { title: "NASA Earthdata science-file catalog", url: catalogUrl(context) }],
  };
}
