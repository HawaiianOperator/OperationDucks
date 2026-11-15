const southCarolinaWheat = {
  title: "Clemson Extension · wheat planting and Hessian fly",
  url: "https://lgpress.clemson.edu/publication/management-strategies-for-hessian-fly-in-wheat/",
};
const southCarolinaSoybeans = {
  title: "Clemson Extension · soybean planting systems",
  url: "https://www.clemson.edu/extension/agronomy/_files/soybean-production-guide.pdf",
};
const minnesotaCorn = {
  title: "University of Minnesota Extension · corn planting trials",
  url: "https://blog-crop-news.extension.umn.edu/2022/04/strategies-for-successful-corn-planting.html",
};
const minnesotaSoybeans = {
  title: "University of Minnesota Extension · soybean planting timing",
  url: "https://blog-crop-news.extension.umn.edu/2025/04/strategic-farming-lets-talk-crops.html",
};
const scotlandCereals = {
  title: "Scottish Government · seasonal cereal sowing",
  url: "https://www.gov.scot/publications/cereal-oilseed-rape-harvest-final-estimates-2024/pages/glossary/",
};
const westernAustraliaGuide = {
  title: "Western Australia DPIRD · 2026 crop sowing guide",
  url: "https://www.dpird.wa.gov.au/siteassets/documents/agriculture/grains/dpird-2026-wa-crop-sowing-guide-full-version.pdf",
};

export function easternWheatbeltSowing([lon, lat]: Point, crop?: string) {
  if (lat < -31.9 || lat > -31.1 || lon < 117.8 || lon > 118.8 ||
      (crop && !["spring wheat", "wheat"].includes(crop))) return null;
  return { source: westernAustraliaGuide,
    guidance: "Wheat · Australian autumn. Trial yields around Merredin generally peaked with late-April to early-May sowing. Check the local guide for the variety and soil conditions." };
}

export function beauceSowing([lon, lat]: Point, crop: string) {
  if (lon < 1.35 || lon > 1.9 || lat < 48 || lat > 48.45) return null;
  switch (crop) {
    case "winter wheat": return {
      source: { title: "ARVALIS · winter wheat in Centre–Île-de-France",
        url: "https://www.arvalis.fr/sites/default/files/medias/pdf/2025-09/Choisir_et_decider-Cereales1-Varietes-et-interventions-automne-Ble-Tendre-hiver-Centre_Ile-de-France_Limousin2025-2026.pdf" },
      guidance: "Autumn · use the regional ARVALIS sowing table for the chosen winter wheat variety.",
    };
    case "winter barley": return {
      source: { title: "ARVALIS · winter barley in Centre–Île-de-France",
        url: "https://www.arvalis.fr/sites/default/files/medias/pdf/2025-08/Guide_preco_Choisir1_OH_2025_Centre_Idf_Auvergne_Limousin_DEF_26082025.pdf" },
      guidance: "Autumn · use the regional winter barley sowing guide for the chosen variety, soil and frost exposure.",
    };
    case "canola": return {
      source: { title: "Terres Inovia · Centre and western France rapeseed establishment",
        url: "https://www.terresinovia.fr/fr/informations-techniques/colza/colza-etre-pret-semer-tot" },
      guidance: "Late summer · in this region, prepare by early August for a suitable sowing opportunity. Check seedbed moisture and establishment risk.",
    };
    default: return null;
  }
}

export const worldCerealCalendarSource = {
  title: "ESA WorldCereal · crop calendars and agroecological zones",
  url: "https://essd.copernicus.org/articles/15/5491/2023/#Ch2.S2",
};

type Zone = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, number | null>>;
let zones: Promise<Zone[]> | undefined;

function contains([x, y]: Point, ring: GeoJSON.Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > y) !== (d > y) && x < a + (c - a) * (y - b) / (d - b)) inside = !inside;
  }
  return inside;
}

const monthDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const growingSeasons = [
  { key: "maize-main", label: "Maize (main season)", crops: ["corn"] },
  { key: "maize-second", label: "Maize (second season)", crops: ["corn"] },
  { key: "wintercereals", label: "Winter cereals", crops: ["winter wheat", "winter barley"] },
  { key: "springcereals", label: "Spring cereals", crops: ["spring wheat", "spring barley"] },
];

export async function worldCerealCalendar(point: Point, crop?: string) {
  zones ??= readFile(join(process.cwd(), "resources", "data", "ESA", "worldcereal-agroecological-zones.geojson"), "utf8")
    .then(contents => JSON.parse(contents).features as Zone[]).catch(() => { zones = undefined; return []; });
  const matches = (await zones).filter(({ geometry }) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some(([shell, ...holes]) => contains(point, shell) && !holes.some(hole => contains(point, hole)));
  });
  if (matches.length !== 1) return [];
  const { properties } = matches[0];
  return growingSeasons.flatMap(({ key, label, crops }) => {
    if (crop && !crops.includes(crop)) return [];
    const start = properties[`tc-${key}_sos`];
    const end = properties[`tc-${key}_eos`];
    if (!(start >= 1 && start <= 365 && end >= 1 && end <= 365)) return [];
    return [`${label} · regional crop season ${monthDay.format(Date.UTC(2021, 0, start))}–${monthDay.format(Date.UTC(2021, 0, end))}${end < start ? " (ends the following year)" : ""}.`];
  });
}

export async function plantingState([lon, lat]: [number, number]) {
  const nearSupportedState = (lat >= 32 && lat <= 36 && lon >= -84 && lon <= -78) ||
    (lat >= 43 && lat <= 50 && lon >= -98 && lon <= -89);
  if (!nearSupportedState) return null;

  const query = new URLSearchParams({ x: String(lon), y: String(lat), benchmark: "Public_AR_Current",
    vintage: "Current_Current", layers: "States", format: "json" });
  try {
    const response = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${query}`,
      { signal: AbortSignal.timeout(4500), next: { revalidate: 86400 } });
    if (!response.ok) return null;
    const state = (await response.json()).result?.geographies?.States?.[0]?.STUSAB;
    return state === "SC" || state === "MN" ? state : null;
  } catch {
    return null;
  }
}

export function plantingWindow(crop: string, state: Awaited<ReturnType<typeof plantingState>>, scotland: boolean, doubleCrop = false) {
  if (state === "SC" && crop === "winter wheat") return { source: southCarolinaWheat,
    guidance: "Fall · November 1–December 1 is Clemson’s South Carolina wheat planting window." };
  if (state === "SC" && crop === "soybeans") return { source: southCarolinaSoybeans, guidance: doubleCrop
    ? "Summer · sow after harvesting the winter wheat. Confirm the actual harvest date and choose a soybean maturity group for the remaining season."
    : "Late spring to early summer · Clemson reports May 1–June 10 for its highest-yielding full-season maturity group V or VI plantings." };
  if (state === "MN" && crop === "corn") return { source: minnesotaCorn,
    guidance: "Spring · Minnesota trials found April 25–May 12 favorable when soil conditions were suitable." };
  if (state === "MN" && crop === "soybeans") return { source: minnesotaSoybeans,
    guidance: "Spring · Minnesota trials found the highest yields for late-April to early-May planting." };
  if (scotland && crop === "spring barley") return { source: scotlandCereals,
    guidance: "Spring · Scottish Government guidance gives March as the usual sowing period." };
  if (scotland && crop === "spring oats") return { source: scotlandCereals,
    guidance: "Spring · most Scottish oats are spring-sown. Confirm the local sowing date and variety." };
  return null;
}
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Point } from "./plot-geometry";

