import { fromUrl } from "geotiff";
import { longitudeOffset, type Point } from "./plot-geometry";

const worldCoverClasses = new Map([
  [10, "tree cover"], [20, "shrubland"], [30, "grassland"], [40, "cropland"],
  [50, "built-up land"], [60, "bare or sparse vegetation"], [70, "snow and ice"],
  [80, "permanent water"], [90, "herbaceous wetland"], [95, "mangroves"], [100, "moss and lichen"],
]);
export const worldCoverSource = "https://esa-worldcover.org/en/data-access";
export const scotlandCapabilitySource = "https://soils.environment.gov.scot/maps/capability-maps/national-scale-land-capability-for-agriculture/";

async function openTile(west: number, south: number, signal: AbortSignal) {
  const lon = longitudeOffset(west, 0);
  const tile = `${south < 0 ? "S" : "N"}${String(Math.abs(south)).padStart(2, "0")}${lon < 0 ? "W" : "E"}${String(Math.abs(lon)).padStart(3, "0")}`;
  const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`;
  const raster = await fromUrl(url, { allowFullFile: false }, signal);
  return raster.getImage();
}

export async function worldCover(points: Point[]) {
  const tiles = new Map<string, ReturnType<typeof openTile>>();
  const signal = AbortSignal.timeout(10000);
  const classes = await Promise.all(points.map(async ([lon, lat]) => {
    if (lat < -60 || lat >= 84) return null;
    const south = Math.floor(lat / 3) * 3;
    const west = Math.floor((lon === 180 ? -180 : lon) / 3) * 3;
    const tile = `${west},${south}`;
    if (!tiles.has(tile)) tiles.set(tile, openTile(west, south, signal));
    try {
      const image = await tiles.get(tile);
      const [x, y] = image.getOrigin();
      const [dx, dy] = image.getResolution();
      const col = Math.floor(((lon === 180 ? -180 : lon) - x) / dx);
      const row = Math.floor((lat - y) / dy);
      if (col < 0 || row < 0 || col >= image.getWidth() || row >= image.getHeight()) return null;
      const value = await image.readRasters({ window: [col, row, col + 1, row + 1], samples: [0], interleave: true, signal });
      return worldCoverClasses.get(value[0]) ?? null;
    } catch {
      return null;
    }
  }));
  const counts = new Map<string, number>();
  for (const value of classes) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export async function worldCoverArea(boundary: Point[], center: Point) {
  const ring = boundary.map(([lon, lat]): Point => [center[0] + longitudeOffset(lon, center[0]), lat]);
  const west = Math.min(...ring.map(([x]) => x));
  const east = Math.max(...ring.map(([x]) => x));
  const south = Math.min(...ring.map(([, y]) => y));
  const north = Math.max(...ring.map(([, y]) => y));
  const cellsPerDegree = 12000;
  if (south < -60 || north >= 84 || (east - west) * (north - south) * cellsPerDegree ** 2 > 1_000_000) return null;
  const tiles: Point[] = [];
  for (let x = Math.floor(west / 3) * 3; x < east; x += 3) {
    for (let y = Math.floor(south / 3) * 3; y < north; y += 3) {
      if (tiles.length === 4) return null;
      tiles.push([x, y]);
    }
  }
  const signal = AbortSignal.timeout(10000);
  const results = await Promise.allSettled(tiles.map(async ([tileWest, tileSouth]) => {
    const image = await openTile(tileWest, tileSouth, signal);
    const [, y] = image.getOrigin();
    const [dx, dy] = image.getResolution();
    const left = Math.max(0, Math.floor((west - tileWest) / dx));
    const right = Math.min(image.getWidth(), Math.ceil((east - tileWest) / dx));
    const top = Math.max(0, Math.floor((north - y) / dy));
    const bottom = Math.min(image.getHeight(), Math.ceil((south - y) / dy));
    const width = right - left;
    if (width <= 0 || bottom <= top) return { counts: new Map<number, number>(), cells: 0, missing: 0 };
    const values = await image.readRasters({ window: [left, top, right, bottom], samples: [0], interleave: true, signal });
    const counts = new Map<number, number>();
    let cells = 0;
    let missing = 0;
    for (let row = top; row < bottom; row++) {
      const lat = y + (row + 0.5) * dy;
      const intersections = ring.flatMap(([lon, a], i) => {
        const [nextLon, b] = ring[(i + 1) % ring.length];
        return (a > lat) !== (b > lat) ? [lon + (nextLon - lon) * (lat - a) / (b - a)] : [];
      }).sort((a, b) => a - b);
      const areaWeight = Math.cos(lat * Math.PI / 180);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const start = Math.max(left, Math.ceil((intersections[i] - tileWest) / dx - 0.5));
        const end = Math.min(right, Math.ceil((intersections[i + 1] - tileWest) / dx - 0.5));
        for (let col = start; col < end; col++) {
          const code = values[(row - top) * width + col - left];
          if (worldCoverClasses.has(code)) {
            cells++;
            counts.set(code, (counts.get(code) ?? 0) + areaWeight);
          } else {
            missing++;
          }
        }
      }
    }
    return { counts, cells, missing };
  }));
  const totals = new Map<number, number>();
  let cells = 0;
  let missing = 0;
  for (const result of results) {
    if (result.status === "rejected") return null;
    cells += result.value.cells;
    missing += result.value.missing;
    for (const [code, count] of result.value.counts) totals.set(code, (totals.get(code) ?? 0) + count);
  }
  if (!cells) return null;
  const mapped = [...totals.values()].reduce((sum, count) => sum + count, 0);
  return { cells, missing, cropland: (totals.get(40) ?? 0) / mapped,
    classes: [...totals].sort(([, a], [, b]) => b - a).slice(0, 4)
      .map(([code, count]) => `${worldCoverClasses.get(code)} ${(100 * count / mapped).toFixed(1)}%`).join(", ") };
}

export async function scotlandCapability(points: Point[]) {
  const classes = await Promise.all(points.map(async ([lon, lat]) => {
    if (lat < 54.5 || lat > 61 || lon < -9 || lon > -0.5) return null;
    const url = "https://services8.arcgis.com/GUWZHTCSOJuIKNzF/ArcGIS/rest/services/Hutton_LCA_Hybrid_FL_WebMerc/FeatureServer/1/query?" +
      new URLSearchParams({
        f: "json", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
        outFields: "LCCODE", returnGeometry: "false",
      });
    try {
      const res = await fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      const code = data.features?.length === 1 ? data.features[0].attributes?.LCCODE : null;
      return typeof code === "number" && Number.isFinite(code) ? code : null;
    } catch {
      return null;
    }
  }));
  const counts = new Map<number, number>();
  for (const code of classes) if (code !== null) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}
