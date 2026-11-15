const geostationary = [
  ["GOES-18", -137.2, 51850],
  ["GOES-19", -75.2, 60133],
  ["Meteosat-12", 0, null],
  ["Meteosat-9", 45.5, null],
  ["FY-2H", 79, null],
  ["FY-2G", 99.2, null],
  ["FY-4B", 105, 48808],
  ["GEO-KOMPSAT-2A", 128.2, 43823],
  ["Himawari-9", 140.7, null],
] as const;



export const spacecraftPoints: GeoJSON.FeatureCollection<GeoJSON.Point, Spacecraft> = {
  type: "FeatureCollection",
  features: geostationary.map(([name, longitude, norad]) => ({
    type: "Feature",
    id: name,
    properties: { key: name, name, norad },
    geometry: { type: "Point", coordinates: [longitude, 0] },
  })),
};
export const satelliteGroups = {
  nominal: { label: "Nominal weather satellites", feeds: [] },
  active: { label: "All public active satellites", feeds: ["active"] },
  comms: { label: "Starlink / communications", feeds: ["starlink", "oneweb", "iridium-NEXT", "intelsat", "ses", "globalstar", "orbcomm", "other-comm"] },
  military: { label: "Public military orbital entries", feeds: ["military"] },
  navigation: { label: "GPS / navigation", feeds: ["gnss"] },
  earth: { label: "Earth observation / weather", feeds: ["resource", "weather", "planet", "spire"] },
  science: { label: "Stations / science", feeds: ["stations", "science", "education", "engineering"] },
  small: { label: "CubeSats / amateur radio", feeds: ["cubesat", "amateur"] },
  launches: { label: "Recent launches and associated objects", feeds: ["last-30-days"] },
  debris: { label: "Cataloged debris clouds", feeds: ["fengyun-1c-debris", "cosmos-2251-debris", "iridium-33-debris"] },
};

export type SatelliteCategory = keyof typeof satelliteGroups;
export type Spacecraft = { key: string; name: string; norad: number | null; epoch?: string; period?: number; height?: number };
export type SatellitePoints = GeoJSON.FeatureCollection<GeoJSON.Point, Spacecraft>;
