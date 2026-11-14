import { Body, GeoVector, RotateVector, Rotation_EQJ_EQD, SiderealTime, SphereFromVector } from "astronomy-engine";
import type { FeatureCollection, LineString, Polygon } from "geojson";

const radians = Math.PI / 180;

function overhead(body: Body, date: Date): [number, number] {
  const position = GeoVector(body, date, true);
  const equatorial = SphereFromVector(RotateVector(Rotation_EQJ_EQD(date), position));
  const longitude = equatorial.lon - 15 * SiderealTime(date);
  return [((longitude + 540) % 360) - 180, equatorial.lat];
}

export function daylightAt(date: Date) {
  const sun = overhead(Body.Sun, date);

  const declination = sun[1] * radians;
  const nightPole = declination >= 0 ? -89.999 : 89.999;
  const boundary: number[][] = [];
  for (let longitude = -180; longitude <= 180; longitude++) {
    const cosine = Math.cos((longitude - sun[0]) * radians);
    const latitude = Math.atan(-cosine / (Math.tan(declination) || 1e-10)) / radians;
    boundary.push([longitude, Math.max(-89.999, Math.min(89.999, latitude))]);
  }
  const ring = [...boundary, [180, nightPole], [0, nightPole], [-180, nightPole], boundary[0]];
  if (nightPole < 0) ring.reverse();
  const geometry: FeatureCollection<LineString | Polygon> = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "boundary" }, geometry: { type: "LineString", coordinates: boundary } },
      { type: "Feature", properties: { kind: "night" }, geometry: { type: "Polygon", coordinates: [ring] } },
    ],
  };
  return { geometry };
}
