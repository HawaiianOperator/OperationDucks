import area from "@turf/area";

export type Point = [number, number];

export function readPlotBoundary(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4096) return null;
  if (!value.every(point => Array.isArray(point) && point.length === 2 &&
      Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90)) return null;
  return value;
}

const wrapLongitude = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
export const longitudeOffset = (lon: number, reference: number) => wrapLongitude(lon - reference);

export function plotHectares(center: Point, boundary: Point[]) {
  const ring = boundary.map(([lon, lat]) => [center[0] + wrapLongitude(lon - center[0]), lat]);
  return area({ type: "Polygon", coordinates: [[...ring, ring[0]]] }) / 10000;
}

export function samplePlot(center: Point, boundary: Point[]): Point[] {
  const ring = boundary.map(([lon, lat]) => [wrapLongitude(lon - center[0]), lat]);
  const xs = ring.map(point => point[0]);
  const ys = ring.map(point => point[1]);
  const west = Math.min(...xs), east = Math.max(...xs);
  const south = Math.min(...ys), north = Math.max(...ys);
  const positions = [0.2, 0.5, 0.8];
  const samples = positions.flatMap(fx => positions.flatMap(fy => {
    const lon = west + fx * (east - west);
    const lat = south + fy * (north - south);
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = ring[i];
      const [c, d] = ring[j];
      if ((b > lat) !== (d > lat) && lon < a + (c - a) * (lat - b) / (d - b)) inside = !inside;
    }
    const point: Point = [wrapLongitude(lon + center[0]), lat];
    return inside ? [point] : [];
  }));
  if (samples.length) return samples;

  // A narrow diagonal plot can fall between every grid point.
  const levels = [...new Set(ys)].sort((a, b) => a - b);
  const lat = levels[0] + (levels[1] - levels[0]) / 2;
  const intersections = ring.flatMap(([x, y], index) => {
    const [otherX, otherY] = ring[(index + 1) % ring.length];
    return (y > lat) !== (otherY > lat) ? [x + (lat - y) * (otherX - x) / (otherY - y)] : [];
  }).sort((a, b) => a - b);
  if (intersections.length < 2 || intersections[0] === intersections[1]) return [];
  return [[wrapLongitude(center[0] + (intersections[0] + intersections[1]) / 2), lat]];
}

