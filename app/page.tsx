"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import maplibre, { type GeoJSONSource, type LngLatLike } from "maplibre-gl";
import { PowerData } from "./power-data";
import { Duck } from "./duck";
import { FieldSummary } from "./field-summary";
import { FarmRisks } from "./farm-risks";
import { Tutorial } from "./tutorial";
import { WorldviewPanel } from "./worldview-panel";
import { imageryLayer, readSelection, tileUrl, type Bounds, type LayerKey } from "./worldview";
import { satelliteGroups, spacecraftPoints, type SatelliteCategory } from "./spacecraft";
import { useSatelliteTracking } from "./use-satellite-tracking";
import { SatelliteData } from "./satellite-data";
import { useEarthquakes } from "./use-earthquakes";
import { watchFeed } from "./watch-feed";
import { MapWeather } from "./map-weather";
import { parseMapCoordinates } from "./map-coordinates";
import area from "@turf/area";
import { daylightAt } from "./day-night";
import { Activity, ArrowDownToLine, Bookmark, ChevronDown, CircleHelp, Crosshair, Globe2, Layers, MapPin, Minus, Plus, Search, SquareDashed, Triangle, X } from "lucide-react";

type Point = [number, number];
type Field = { name: string; points: Point[]; radiusMeters?: number; circleCenter?: Point };
const plotKey = (plot: Field) => JSON.stringify(plot.points);
function plotBounds(plot: Field) {
  const bounds = new maplibre.LngLatBounds();
  plot.points.forEach(point => bounds.extend(point as LngLatLike));
  return bounds;
}
function circleBoundary(center: Point, radius: number): Point[] {
  const lat = center[1] * Math.PI / 180;
  const lon = center[0] * Math.PI / 180;
  const angular = radius / 6371008.8;
  return Array.from({ length: 64 }, (_, index) => {
    const bearing = 2 * Math.PI * index / 64;
    const y = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
    const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
      Math.cos(angular) - Math.sin(lat) * Math.sin(y));
    return [x * 180 / Math.PI, y * 180 / Math.PI];
  });
}
const earth: Point = [-98, 36];
const earthZoom = 0.55;
const home: Point = [-120.2222, 36.8271];
const examples: { name: string; region: string; center: Point }[] = [
  { name: "Central Valley", region: "California, United States", center: home },
  { name: "Po Valley", region: "Italy", center: [10.005, 44.927] },
  { name: "Nile Delta", region: "Egypt", center: [30.985, 31.107] },
];
const polygon = (points: Point[]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "Polygon" as const, coordinates: [[...points, points[0]]] },
});
const vegetation = [
  ["NASA POWER", "Temperature and rainfall"],
  ["SMAP", "Soil moisture"],
  ["GPM", "Precipitation"],
  ["Landsat", "Vegetation health"],
  ["ECOSTRESS", "Surface temperature"],
  ["MODIS", "Historical observations"],
];

function DuckMark({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M24 6a5 5 0 0 1 5 5l3 2-5 2v3c0 5-5 9-12 9C7 27 2 23 1 16c4 3 7 3 10 1 4-2 7-2 8-2v-4a5 5 0 0 1 5-5Z"/><circle cx="25" cy="10" r="1" fill="var(--console)"/></svg>;
}

export default function Home() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibre.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(true);
  const [imageryDelayed, setImageryDelayed] = useState(false);
  const [mapError, setMapError] = useState("");
  const [basemap, setBasemap] = useState("streets");
  const [place, setPlace] = useState({ name: "Earth", region: "Global view", center: earth });
  const [globe, setGlobe] = useState(true);
  const [center, setCenter] = useState(earth);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [mode, setMode] = useState<"triangle" | "radius" | "polygon" | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [field, setField] = useState<Field | null>(null);
  const [plots, setPlots] = useState<Field[]>([]);
  const [includedPlots, setIncludedPlots] = useState<string[]>([]);
  const [drawError, setDrawError] = useState("");
  const [saved, setSaved] = useState<Field[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [tab, setTab] = useState("Overview");
  const [showLayers, setShowLayers] = useState(true);
  const [showField, setShowField] = useState(true);
  const [zoom, setZoom] = useState(earthZoom);
  const [showSpacecraft, setShowSpacecraft] = useState(true);
  const [showEarthquakes, setShowEarthquakes] = useState(false);
  const [satelliteCategory, setSatelliteCategory] = useState<SatelliteCategory>("nominal");
  const [satelliteSearch, setSatelliteSearch] = useState("");
  const tracking = useSatelliteTracking(satelliteCategory, showSpacecraft);
  const [selectedSatellite, setSelectedSatellite] = useState<string | null>(null);
  const [tutorialReplay, setTutorialReplay] = useState(0);
  const [inspected, setInspected] = useState<{ point: Point; place: typeof place } | null>(null);
  const [fieldPlace, setFieldPlace] = useState<typeof place | null>(null);
  const [worldviewLayer, setWorldviewLayer] = useState<LayerKey>("smap");
  const [pinnedDate, setWorldviewDate] = useState("");
  const [utcDay, setUtcDay] = useState("");
  const [imageryDates, setImageryDates] = useState<Partial<Record<LayerKey, string>>>({});
  const [imageryChecked, setImageryChecked] = useState(0);
  const [imageryUnavailable, setImageryUnavailable] = useState(false);
  const worldviewDate = pinnedDate || (imageryLayer(worldviewLayer) ? imageryDates[worldviewLayer] ?? "" : utcDay);
  const [showWorldview, setShowWorldview] = useState(false);
  const [askWorldview, setAskWorldview] = useState(false);
  const [spectralFootprints, setSpectralFootprints] = useState<GeoJSON.Feature<GeoJSON.Polygon>[]>([]);
  const [showWind, setShowWind] = useState(false);
  const [wind, setWind] = useState<{ key: string; speed?: number; direction?: number; gust?: number; time?: string; url?: string; stale?: boolean }>();
  const windLon = Math.round(center[0] * 100) / 100;
  const windLat = Math.round(center[1] * 100) / 100;
  const windKey = `${windLat}:${windLon}`;
  const currentWind = wind?.key === windKey ? wind : null;

  useEarthquakes(ready ? map.current : null, showEarthquakes && !mode);

  useEffect(() => {
    if (pinnedDate) return;
    return watchFeed(async signal => {
      setUtcDay(new Date().toISOString().slice(0, 10));
      if (!imageryLayer(worldviewLayer)) return;
      try {
        const response = await fetch("/api/worldview", { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Imagery dates unavailable");
        const { dates } = await response.json();
        if (signal.aborted) return;
        setImageryDates(previous => ({ ...previous, ...dates }));
        setImageryUnavailable(!dates[worldviewLayer]);
        if (dates[worldviewLayer]) setImageryChecked(Math.floor(Date.now() / 300000));
      } catch {
        if (!signal.aborted) setImageryUnavailable(true);
      }
    }, 300000);
  }, [pinnedDate, worldviewLayer]);

  useEffect(() => {
    if (!ready || !map.current) return;
    for (const layer of ["spacecraft", "spacecraft-hit"]) {
      map.current.setLayoutProperty(layer, "visibility", showSpacecraft ? "visible" : "none");
    }
  }, [ready, showSpacecraft]);

  useEffect(() => {
    if (!ready) return;
    (map.current?.getSource("spacecraft") as GeoJSONSource | undefined)?.setData(tracking.points);
  }, [ready, tracking.points]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("fieldshift-fields");
      if (stored) setSaved(JSON.parse(stored));
    } catch {}
    let instance: maplibre.Map;
    try {
      instance = new maplibre.Map({
        container: container.current!,
        center: earth,
        zoom: earthZoom,
        minZoom: -1,
        maxPitch: 0,
        attributionControl: { compact: true },
        style: {
          version: 8,
          projection: { type: "globe" },
          sources: {
            satellite: { type: "raster", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri and contributors" },
            streets: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
            daylight: { type: "geojson", data: daylightAt(new Date()).geometry },
            field: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            spacecraft: { type: "geojson", data: spacecraftPoints, promoteId: "key" },
            "hyperspectral": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          },
          layers: [
            { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" }, paint: { "raster-saturation": 0.38, "raster-contrast": 0.2 } },
            { id: "streets", type: "raster", source: "streets" },
            { id: "night-shade", type: "fill", source: "daylight", filter: ["==", "kind", "night"], paint: { "fill-color": "#040a19", "fill-opacity": 0.55, "fill-antialias": false } },
            { id: "terminator-glow", filter: ["==", "kind", "boundary"], type: "line", source: "daylight", paint: { "line-color": "#ffad55", "line-width": 7, "line-blur": 5, "line-opacity": 0.65 } },
            { id: "terminator", filter: ["==", "kind", "boundary"], type: "line", source: "daylight", paint: { "line-color": "#ffe3a1", "line-width": 1.5 } },
            { id: "hyperspectral-fill", type: "fill", source: "hyperspectral", paint: { "fill-color": "#62e8e4", "fill-opacity": 0.15 } },
            { id: "hyperspectral-outline", type: "line", source: "hyperspectral", paint: { "line-color": "#62e8e4", "line-width": 2 } },
            { id: "fill", type: "fill", source: "field", paint: { "fill-color": "#bce58c", "fill-opacity": 0.25 } },
            { id: "boundary", type: "line", source: "field", paint: {
              "line-color": ["case", ["==", ["get", "active"], false], "#90b8a1", "#dcf7aa"],
              "line-width": ["case", ["==", ["get", "active"], false], 2, 3],
            } },
            { id: "vertices", type: "circle", source: "field", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#e5ffb5", "circle-stroke-width": 2, "circle-stroke-color": "#354326" } },
            { id: "spacecraft-hit", type: "circle", source: "spacecraft", paint: { "circle-radius": 15, "circle-opacity": 0 } },
            { id: "spacecraft", type: "circle", source: "spacecraft", paint: {
              "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 9, 6],
              "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#f7d368", "#c0abff"],
              "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 2],
              "circle-stroke-color": ["case", ["boolean", ["feature-state", "selected"], false], "#fff1b5", "#211442"],
            } },
          ],
        },
      });
    } catch {
      setMapError("The map needs WebGL to display.");
      return;
    }
    map.current = instance;
    instance.once("load", () => setReady(true));
    const startedAt = performance.now();
    let revealTimer: number | undefined;
    const startupTimeout = window.setTimeout(() => {
      setImageryDelayed(true);
      setStarting(false);
    }, 12000);
    instance.once("idle", () => {
      window.clearTimeout(startupTimeout);
      setImageryDelayed(false);
      revealTimer = window.setTimeout(() => setStarting(false), Math.max(0, 900 - (performance.now() - startedAt)));
    });
    instance.on("moveend", () => {
      setCenter(instance.getCenter().wrap().toArray() as Point);
      setZoom(instance.getZoom());
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current!);
    return () => { window.clearTimeout(startupTimeout); window.clearTimeout(revealTimer); observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !showSpacecraft || mode) return;
    const layer = "spacecraft-hit";
    const enter = () => { instance.getCanvas().style.cursor = "pointer"; };
    const leave = () => { instance.getCanvas().style.cursor = ""; };
    const select = (event: maplibre.MapLayerMouseEvent) => {
      // Prefer a direct hit on a dot when the larger tap targets overlap.
      const hit = instance.queryRenderedFeatures(event.point, { layers: ["spacecraft"] })[0] ?? event.features?.[0];
      if (typeof hit?.id === "string") setSelectedSatellite(hit.id);
    };
    instance.on("mouseenter", layer, enter);
    instance.on("mouseleave", layer, leave);
    instance.on("click", layer, select);
    return () => {
      instance.off("mouseenter", layer, enter);
      instance.off("mouseleave", layer, leave);
      instance.off("click", layer, select);
      if (instance.getCanvas().style.cursor === "pointer") leave();
    };
  }, [ready, showSpacecraft, mode]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !selectedSatellite) return;
    const feature = { source: "spacecraft", id: selectedSatellite };
    instance.setFeatureState(feature, { selected: true });
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !mode) setSelectedSatellite(null); };
    window.addEventListener("keydown", close);
    return () => {
      if (instance.getSource("spacecraft")) instance.removeFeatureState(feature, "selected");
      window.removeEventListener("keydown", close);
    };
  }, [ready, selectedSatellite, mode]);

  useEffect(() => {
    if (!ready || !map.current) return;
    for (const id of ["satellite", "streets"]) {
      map.current.setLayoutProperty(id, "visibility", id === basemap ? "visible" : "none");
    }
  }, [ready, basemap]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !showWorldview || !worldviewDate) return;
    const imagery = imageryLayer(worldviewLayer);
    const tile = tileUrl(worldviewLayer, worldviewDate);
    if (!imagery || !tile) return;
    const id = "nasa-worldview";
    instance.addSource(id, {
      type: "raster", tiles: [pinnedDate ? tile : `${tile}?refresh=${imageryChecked}`], tileSize: 256,
      maxzoom: imagery.zoom, attribution: "Imagery © NASA GIBS",
    });
    instance.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.68 } }, "fill");
    return () => {
      if (instance.getLayer(id)) instance.removeLayer(id);
      if (instance.getSource(id)) instance.removeSource(id);
    };
  }, [ready, showWorldview, worldviewLayer, worldviewDate, pinnedDate, imageryChecked]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("hyperspectral") as GeoJSONSource;
    source.setData({ type: "FeatureCollection", features: showWorldview && !imageryLayer(worldviewLayer) ? spectralFootprints : [] });
  }, [ready, showWorldview, worldviewLayer, spectralFootprints]);

  useEffect(() => {
    if (!showWind) return;
    const params = new URLSearchParams({ kind: "wind", lat: String(windLat), lon: String(windLon) });
    return watchFeed(async signal => {
      try {
        const response = await fetch("/api/farm-risks?" + params, { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Wind unavailable");
        const data = await response.json();
        if (!signal.aborted) setWind({ ...data, key: windKey });
      } catch {
        if (!signal.aborted) setWind(previous => previous?.key === windKey
          ? { ...previous, stale: true } : { key: windKey });
      }
    }, 300000);
  }, [showWind, windLat, windLon, windKey]);

  useEffect(() => {
    if (!ready || !showWind || currentWind?.direction === undefined || !map.current) return;
    const indicator = document.createElement("div");
    indicator.className = "wind-marker";
    indicator.setAttribute("aria-hidden", "true");
    const arrow = document.createElement("span");
    arrow.textContent = "↑";
    indicator.append(arrow);
    // The reported compass bearing is where wind comes from. The arrow points downwind.
    const marker = new maplibre.Marker({ element: indicator, rotation: currentWind.direction + 180, rotationAlignment: "map" })
      .setLngLat([windLon, windLat]).addTo(map.current);
    return () => { marker.remove(); };
  }, [ready, showWind, currentWind?.direction, windLon, windLat]);

  function selectFilter(value: string) {
    setShowWind(value === "wind");
    setShowWorldview(value !== "wind" && value !== "none");
    if (value !== "wind" && value !== "none") setWorldviewLayer(value as LayerKey);
  }

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("field") as GeoJSONSource;
    const vertices = mode ? points : field?.points ?? [];
    const activeKey = field && plotKey(field);
    source.setData({
      type: "FeatureCollection",
      features: [
        ...plots.map(plot => ({ ...polygon(plot.points), properties: { key: plotKey(plot), active: plotKey(plot) === activeKey } })),
        ...(mode && vertices.length >= 3 ? [polygon(vertices)] : []),
        ...vertices.map(point => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: point } })),
      ],
    });
  }, [ready, mode, points, field, plots]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mode) return;
    instance.getCanvas().style.cursor = "crosshair";
    const click = (event: maplibre.MapMouseEvent) => {
      const point = event.lngLat.wrap().toArray() as Point;
      if (points.some(([lng, lat]) => lng === point[0] && lat === point[1])) return;
      if (mode === "triangle" && points.length === 2) {
        finish([...points, point]);
      } else if (mode === "radius" && points.length === 1) {
        const origin = points[0];
        const radius = new maplibre.LngLat(...origin).distanceTo(new maplibre.LngLat(...point));
        finish(circleBoundary(origin, radius), radius, origin);
      } else {
        setPoints([...points, point]);
      }
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") { setMode(null); setShowField(true); } };
    instance.on("click", click);
    window.addEventListener("keydown", cancel);
    return () => {
      instance.off("click", click);
      instance.getCanvas().style.cursor = "";
      window.removeEventListener("keydown", cancel);
    };
  }, [mode, points, place, plots.length]);

  function finish(boundary: Point[], radiusMeters?: number, circleCenter?: Point) {
    if (area(polygon(boundary)) < 1) {
      setDrawError("The corners must enclose a plot. Choose a corner farther from the line.");
      return;
    }
    const plot = { name: `Plot ${plots.length + 1}`, points: boundary, radiusMeters, circleCenter };
    openPlot(plot, false);
  }

  function openPlot(plot: Field, zoomTo = true) {
    const key = plotKey(plot);
    const bounds = plotBounds(plot);
    const location = { name: plot.name, region: "Selected plot", center: bounds.getCenter().wrap().toArray() as Point };
    setPlots(items => items.some(item => plotKey(item) === key) ? items : [...items, plot]);
    setIncludedPlots(items => items.includes(key) ? items : [...items, key]);
    setField(plot);
    setPlace(location);
    setFieldPlace(location);
    setGlobe(false);
    setInspected(null);
    setShowField(true);
    setMode(null);
    setTab("Overview");
    setAskWorldview(false);
    setDrawError("");
    const instance = map.current;
    instance?.setProjection({ type: "mercator" });
    instance?.setMinZoom(1);
    if (zoomTo) instance?.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 0 });
  }

  function renamePlot(plot: Field, name: string) {
    const key = plotKey(plot);
    const changed = { ...plot, name };
    setField(changed);
    setPlots(items => items.map(item => plotKey(item) === key ? changed : item));
  }

  function removePlot(plot: Field) {
    const key = plotKey(plot);
    setPlots(items => items.filter(item => plotKey(item) !== key));
    setIncludedPlots(items => items.filter(item => item !== key));
    setField(null);
    setMode(null);
  }

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const source = instance.getSource("daylight") as GeoJSONSource;
    for (const layer of ["night-shade", "terminator", "terminator-glow"]) {
      instance.setLayoutProperty(layer, "visibility", globe ? "visible" : "none");
    }
    if (!globe) return;
    const update = () => source.setData(daylightAt(new Date()).geometry);
    update();
    const timer = window.setInterval(update, 10000);
    return () => window.clearInterval(timer);
  }, [ready, globe]);

  function returnToEarth(target: Point = earth) {
    setMode(null);
    setSearchOpen(false);
    setGlobe(true);
    setShowField(true);
    setPlace({ name: "Earth", region: "Global view", center: earth });
    setBasemap("streets");
    const instance = map.current;
    instance?.setMinZoom(earthZoom);
    instance?.setProjection({ type: "globe" });
    instance?.jumpTo({ center: target, zoom: earthZoom, bearing: 0 });
  }

  function visit(location: typeof place) {
    setGlobe(false); setShowField(true);
    setMode(null);
    setPlace(location);
    setSearchOpen(false);
    setQuery("");
    setSearchError("");
    const instance = map.current;
    instance?.setProjection({ type: "mercator" });
    instance?.setMinZoom(1);
    instance?.jumpTo({ center: location.center, zoom: 12.8, bearing: 0 });
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const input = query.trim();
    if (!input) return;
    const coordinates = parseMapCoordinates(input);
    if (coordinates === "invalid") {
      setSearchError("Enter valid latitude and longitude in decimal degrees or degrees, minutes and seconds. The map supports latitudes up to 85.05° north or south.");
      return;
    }
    if (coordinates) {
      visit({ name: input, region: "Coordinates", center: coordinates });
      return;
    }
    const match = examples.find(location => location.name.toLowerCase().includes(input.toLowerCase()));
    if (match) { visit(match); return; }
    setSearchError("Searching…");
    try {
      const response = await fetch("https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(input));
      if (!response.ok) throw new Error();
      const { features } = await response.json();
      if (!features?.length) { setSearchError("No places found."); return; }
      const { geometry, properties } = features[0];
      visit({ name: properties.name ?? input, region: [properties.state, properties.country].filter(Boolean).join(", "), center: geometry.coordinates });
    } catch { setSearchError("Search is unavailable. Try entering latitude, longitude."); }
  }

  function draw(next: typeof mode) {
    setPoints([]);
    setDrawError("");
    setMode(mode === next ? null : next);
    setShowField(true);
  }

  function save() {
    if (!field || !field.name.trim()) return;
    const next = [...saved.filter(item => plotKey(item) !== plotKey(field)), field];
    localStorage.setItem("fieldshift-fields", JSON.stringify(next));
    setSaved(next);
  }

  function exportField() {
    if (!field) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...polygon(field.points), properties: { name: field.name } }, null, 2)], { type: "application/geo+json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "operation-ducks-field.geojson";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const hectares = field ? area(polygon(field.points)) / 10000 : 0;
  const alreadySaved = field && saved.some(item => plotKey(item) === plotKey(field) && item.name === field.name);
  const duckPlots = plots.map(plot => {
    const plotCenter = plot.circleCenter ?? plotBounds(plot).getCenter().wrap().toArray() as Point;
    return { key: plotKey(plot), name: plot.name.trim() || "Unnamed plot", center: plotCenter,
      boundary: plot.points, radiusMeters: plot.radiusMeters };
  });
  const riskField = fieldPlace === place ? field : null;
  const fieldCenter = riskField?.points.length ? new maplibre.LngLatBounds(riskField.points[0], riskField.points[0]) : null;
  if (fieldCenter) riskField?.points.forEach(point => fieldCenter.extend(point));
  const summaryPoint = riskField?.circleCenter ?? (fieldCenter ? fieldCenter.getCenter().wrap().toArray() as Point : null);
  const riskSelection = inspected?.place === place ? inspected.point
    : summaryPoint ?? (globe ? null : place.center);
  const riskPlace = inspected?.place === place ? "Inspected map center" : riskField?.name ?? place.name;
  const satellite = tracking.points.features.find(feature => feature.id === selectedSatellite);
  const satelliteResults = tracking.points.features.filter(({ properties }) =>
    `${properties.name} ${properties.norad ?? ""}`.toLowerCase().includes(satelliteSearch.trim().toLowerCase()));
  let worldview = null;
  if (field?.points.length) {
    const firstLongitude = field.points[0][0];
    const bounds = new maplibre.LngLatBounds();
    for (const [lng, lat] of field.points) {
      bounds.extend([firstLongitude + ((lng - firstLongitude + 540) % 360) - 180, lat]);
    }
    const west = ((bounds.getWest() % 360 + 540) % 360) - 180;
    const selection = readSelection({
      layer: worldviewLayer, date: worldviewDate || utcDay || new Date().toISOString().slice(0, 10),
      bounds: [west, bounds.getSouth(), west + bounds.getEast() - bounds.getWest(), bounds.getNorth()] satisfies Bounds,
    });
    if (selection) worldview = { ...selection, date: worldviewDate, place: field.name, hectares };
  }

  return <>
    {starting && !mapError && <div className="startup" role="status">
      <DuckMark size={72} />
      <h1>Operation Ducks</h1>
      <p>Loading map…</p>
      <span className="startup-progress" aria-hidden="true" />
    </div>}
    <div inert={starting && !mapError}>
    <header className="top">
      <a className="logo" href="./"><span><DuckMark size={19} /></span>Operation Ducks</a>
      <div className="search-wrap">
        <form className="search" onSubmit={search}>
          <Search size={17} />
          <input aria-label="Search locations" placeholder="Search a place or coordinates" value={query} onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); setSearchError(""); }} onKeyDown={event => { if (event.key === "Escape") setSearchOpen(false); }} />
          {searchOpen && <button type="button" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={15} /></button>}
        </form>
        {searchOpen && <div className="popover suggestions">
          {searchError && <p role="status">{searchError}</p>}
          {examples.filter(item => (item.name + item.region).toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.name} onClick={() => visit(item)}><MapPin size={15} /><span>{item.name}<small>{item.region}</small></span></button>)}
          {query && !searchError && <p>Press Enter to go to a place or coordinates.</p>}
        </div>}
      </div>
      <div className="top-actions">
      <a className="outline" href="#farm-risks"><span>Farm risks</span></a>
      <button className="outline" onClick={() => setTutorialReplay(value => value + 1)} title="Tutorial" aria-label="Tutorial"><CircleHelp size={16} /> <span>Tutorial</span></button>
      <div className="saved-wrap">
        <button className="outline" onClick={() => setSavedOpen(!savedOpen)} aria-expanded={savedOpen}><Bookmark size={16} /> <span>Saved fields</span></button>
        {savedOpen && <div className="popover saved">{saved.length ? saved.map(item => <button key={plotKey(item)} onClick={() => {
          openPlot(item);
          setSavedOpen(false);
        }}><MapPin size={15} /> {item.name}</button>) : <p>No saved fields yet.</p>}</div>}
      </div>
      </div>
    </header>

    <main>
      <div className={globe ? "workspace globe-workspace" : "workspace"}>
        <section className="map-card" aria-label="Field map">
          <div className="map-head"><div className="location"><MapPin size={18} /><div><strong>{place.name}</strong><small>{place.region}</small></div></div>
            <div className="segmented" aria-label="Base map">{["satellite", "streets"].map(id => <button key={id} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{id === "satellite" ? "Satellite" : "Street"}</button>)}</div>
            <select className="map-filter" aria-label="Map filter" value={showWind ? "wind" : showWorldview ? worldviewLayer : "none"} onChange={event => selectFilter(event.target.value)}>
              <option value="none">Map filters</option>
              <option value="smap">Soil moisture · SMAP</option>
              <option value="wind">Current wind</option>
              <option value="rain">Precipitation · IMERG</option>
              <option value="heat">Surface heat · MODIS</option>
              <option value="emit">Hyperspectral · EMIT</option>
              <option value="aviris">Hyperspectral · AVIRIS-NG</option>
              <option value="terra">True color · MODIS Terra</option>
              <option value="aqua">True color · MODIS Aqua</option>
              <option value="noaa20">True color · VIIRS NOAA-20</option>
              <option value="noaa21">True color · VIIRS NOAA-21</option>
              <option value="pace">True color · PACE OCI</option>
            </select>
          </div>
          <div className={globe ? "map-frame globe-frame" : "map-frame"}>
            <div className="map" ref={container} />
            <MapWeather map={ready ? map.current : null} wind={showWind} drawing={!!mode} toggleWind={() => {
              if (!showWind) setShowWorldview(false);
              setShowWind(value => !value);
            }} />
            {mapError && <p className="map-error" role="alert">{mapError}</p>}
            {imageryDelayed && <p className="map-error" role="status">Satellite imagery is taking longer than expected.</p>}
            {showWind && <div className="map-filter-status" role="status">
              {!currentWind ? "Loading current wind…" : currentWind.direction === undefined ? "Wind data unavailable." :
                <><strong>Wind forecast at map center</strong><br />{currentWind.speed} km/h from {currentWind.direction}°
                  {currentWind.gust !== undefined && ` · gusts ${currentWind.gust} km/h`}
                  <small>{currentWind.time?.replace("T", " ").replace(/Z$/, "")} UTC · <a href={currentWind.url} target="_blank" rel="noreferrer">MET Norway</a>{currentWind.stale && " · Refresh failed"}</small></>}
            </div>}
            {showWorldview && !imageryLayer(worldviewLayer) && <div className="map-filter-status" role="status">
              {!field ? "Draw or open a field to find hyperspectral acquisitions."
                : spectralFootprints.length ? `${spectralFootprints.length} acquisition footprints · see NASA data below`
                : "Inspect the NASA data panel for footprint availability."}
              <br /><a href="#worldview">Inspect NASA data</a>
            </div>}
            {showWorldview && !!imageryLayer(worldviewLayer) && <div className="map-filter-status" role="status">
              {imageryLayer(worldviewLayer)?.name} · {worldviewDate ? `${worldviewDate} UTC` : imageryUnavailable ? "Latest imagery date unavailable" : "Checking latest imagery…"}
              {pinnedDate ? <> · Historical <button className="outline" onClick={() => setWorldviewDate("")}>Follow latest</button></>
                : worldviewDate && (imageryUnavailable ? " · Refresh failed" : " · Latest published")}
              <br /><a href="#worldview">Inspect NASA data</a>
            </div>}
            <div className="map-tools">
              <div><button title="USGS earthquakes, magnitude 4.5+ in the past 24 hours" aria-label="USGS earthquakes" aria-pressed={showEarthquakes}
                onClick={() => setShowEarthquakes(value => !value)}><Activity size={18} /></button></div>
              <div><button title="Draw triangle" aria-label="Draw triangle on map" disabled={!ready} aria-pressed={mode === "triangle"}
                onClick={() => draw("triangle")}><Triangle size={17} /></button>
              <button title="Draw radius" aria-label="Draw radius on map" disabled={!ready} aria-pressed={mode === "radius"}
                onClick={() => draw("radius")}><Crosshair size={17} /></button></div>
              <div><button title="Space tracking" aria-label="Space tracking" aria-pressed={showSpacecraft}
                onClick={() => { setShowSpacecraft(!showSpacecraft); setSelectedSatellite(null); }}><Layers size={18} /></button></div>
              <div><button title="Full Earth view" aria-label="Full Earth view" onClick={() => returnToEarth()}><Globe2 size={18} /></button></div>
              <div><button title="Zoom in" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={19} /></button><button title="Zoom out" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus size={19} /></button></div>
              <div><button title="Reset view" aria-label="Reset view" onClick={() => globe ? returnToEarth() : map.current?.jumpTo({ center: place.center, zoom: 12.8, bearing: 0 })}><Crosshair size={18} /></button></div>
            </div>
            {mode && <div className="draw-note" role="status"><span>{drawError ||
              (mode === "triangle" ? `Select corner ${points.length + 1} of 3.` : mode === "radius"
                ? points.length ? "Select the edge to set the radius." : "Select the center of the plot."
                : "Click to add corners.")}</span>{mode === "polygon" && <button disabled={points.length < 3} onClick={() => finish(points)}>Finish</button>}<button aria-label="Cancel drawing" onClick={() => { setMode(null); setShowField(true); }}><X size={15} /></button></div>}
            {showSpacecraft && satellite && !mode && <section className="side-card satellite-detail" aria-label="Selected satellite">
              <div className="satellite-detail-heading">
                <h2><Layers size={16} aria-hidden="true" /> {satellite.properties.name}</h2>
                <button className="outline" aria-label="Close satellite details" onClick={() => setSelectedSatellite(null)}><X size={15} /></button>
              </div>
              <dl>
                {satellite.properties.epoch ? <>
                  <div><dt>Altitude</dt><dd>{satellite.properties.height.toFixed(0)} km</dd></div>
                  <div><dt>Orbital period</dt><dd>{satellite.properties.period.toFixed(1)} min</dd></div>
                  <div><dt>Element epoch (UTC)</dt><dd>{satellite.properties.epoch}</dd></div>
                </> : <div><dt>Orbit</dt><dd>Geostationary</dd></div>}
                {!satellite.properties.epoch && <div><dt>Nominal longitude</dt><dd>{Math.abs(satellite.geometry.coordinates[0])}°{satellite.geometry.coordinates[0] < 0 ? " W" : satellite.geometry.coordinates[0] > 0 ? " E" : ""}</dd></div>}
                {satellite.properties.norad !== null && <div><dt>NORAD ID</dt><dd>{satellite.properties.norad}</dd></div>}
              </dl>
              <a href="#space-tracking">View public data and downlinks</a>
            </section>}
          </div>
          <div className="map-foot"><span><Crosshair size={13} /> {Math.abs(center[1]).toFixed(4)}° {center[1] < 0 ? "S" : "N"} · {Math.abs(center[0]).toFixed(4)}° {center[0] < 0 ? "W" : "E"}</span><span>{globe && <><span className="status-divider">●</span> DAY / NIGHT <span className="status-divider">·</span> </>}ZOOM {zoom.toFixed(1)} <span className="status-divider">·</span> {basemap === "satellite" ? "WORLD IMAGERY" : "STREET MAP"}</span></div>
        </section>

        {globe && <section className="places" aria-label="Places to explore"><span>Explore a growing region</span>{examples.map(item => <button className="outline" key={item.name} onClick={() => visit(item)}><MapPin size={15} />{item.name}</button>)}</section>}
        <aside className="hud" aria-label="Field details">
          <button className="outline field-toggle" aria-expanded={showField} onClick={() => setShowField(!showField)}><SquareDashed size={16} /> Field tools <ChevronDown size={15} className={showField ? "" : "closed"} /></button>
          {showField && <div className="hud-content">
          <section className="side-card details">
            <div className="tabs">{["Overview", "Data"].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
            {tab === "Overview" ? <div className="detail-body">
              <div className="section-icon"><SquareDashed size={23} /></div>
              <h2>{field?.name ?? "Field selection"}</h2>
              {field ? <><p><strong>{hectares.toLocaleString(undefined, { maximumFractionDigits: 3 })} ha</strong> · {field.radiusMeters ? `${field.radiusMeters.toFixed(0)} m radius` : `${field.points.length} corners`}</p>
                <label className="plot-name">Plot name <input value={field.name} maxLength={80} onChange={event => renamePlot(field, event.target.value)} /></label>
                <div className="actions"><button className="outline" disabled={!!alreadySaved || !field.name.trim()} onClick={save}><Bookmark size={15} /> {alreadySaved ? "Saved" : "Save field"}</button><button className="outline" onClick={exportField} title="Export GeoJSON" aria-label="Export GeoJSON"><ArrowDownToLine size={17} /></button><button className="outline" title="Remove plot from selection" aria-label="Remove plot from selection" onClick={() => removePlot(field)}><X size={17} /></button></div></> : <p>Draw a boundary on the map to see its area and save the field.</p>}
              <button className="primary" disabled={!ready} aria-pressed={mode === "radius"} onClick={() => draw("radius")}><Crosshair size={16} /> Draw radius</button>
              <button className="secondary" disabled={!ready} aria-pressed={mode === "triangle"} onClick={() => draw("triangle")}><Triangle size={16} /> Draw triangle</button>
              <button className="secondary" disabled={!ready} aria-pressed={mode === "polygon"} onClick={() => draw("polygon")}>{mode === "polygon" ? "Cancel polygon" : "Draw polygon"}</button>
              {plots.length > 1 && <div className="plot-list" aria-label="Open a drawn plot">{plots.map(plot =>
                <button className="outline" key={plotKey(plot)} aria-pressed={!!field && plotKey(field) === plotKey(plot)}
                  onClick={() => openPlot(plot)}>{plot.name || "Unnamed plot"}</button>)}</div>}
              {summaryPoint && riskField && !mode && <FieldSummary point={summaryPoint} boundary={riskField.points} radiusMeters={riskField.radiusMeters} />}
            </div> : <div className="detail-body"><div className="section-icon"><Layers size={22} /></div><h2>Field data</h2>{field ? <><PowerData points={field.points} /><a className="outline" href="#worldview">Inspect NASA Worldview</a></> : <p>Draw a field boundary to see NASA POWER data.</p>}</div>}
          </section>
          <section className="side-card source-panel">
            <button className="layer-heading" aria-expanded={showLayers} onClick={() => setShowLayers(!showLayers)}><Layers size={17} /> Data sources <ChevronDown size={16} className={showLayers ? "" : "closed"} /></button>
            {showLayers && <ul className="source-list">{vegetation.map(([name, description]) => <li key={name}><span><strong>{name}</strong><small>{description}</small></span><span className="pending" title="Not connected" aria-label="Not connected" /></li>)}</ul>}
          </section>
          <p className="help"><CircleHelp size={15} /> Coordinates use latitude, longitude.</p>
        </div>}</aside>
      </div>
    </main>
    <div className="risk-workspace"><WorldviewPanel context={worldview} layer={worldviewLayer} date={worldviewDate}
      shown={showWorldview} latest={!pinnedDate} onLayer={setWorldviewLayer} onDate={setWorldviewDate} onFootprints={setSpectralFootprints}
      onToggle={() => {
        if (!showWorldview) container.current?.scrollIntoView({ block: "center" });
        setShowWind(false);
        setShowWorldview(!showWorldview);
      }}
      onAsk={() => {
        setAskWorldview(true);
        document.querySelector<HTMLTextAreaElement>("#duck textarea")?.focus();
      }} /></div>
    <div className="risk-workspace"><FarmRisks place={riskPlace} point={riskSelection}
      onInspect={() => setInspected({ point: [((center[0] % 360 + 540) % 360) - 180, center[1]], place })} /></div>
    <div className="duck-workspace">
      {showSpacecraft && <section className="side-card detail-body" id="space-tracking">
        <h2>Space tracking</h2>
        <label>Satellite group <select value={satelliteCategory} onChange={event => {
          setSatelliteCategory(event.target.value as SatelliteCategory);
          setSelectedSatellite(null);
          setSatelliteSearch("");
        }}>
          {Object.entries(satelliteGroups).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <p><label>Find satellite <input type="search" value={satelliteSearch} onChange={event => setSatelliteSearch(event.target.value)} placeholder="Name or NORAD ID" /></label></p>
        <p role="status">{satelliteCategory === "nominal" ? "Nominal weather satellite positions above the equator."
          : tracking.at ? `${tracking.points.features.length.toLocaleString()} plotted · Predicted positions as of ${new Date(tracking.at).toISOString()}`
            : tracking.unavailable ? "CelesTrak orbital feed is temporarily unavailable." : "Loading CelesTrak orbital elements…"}</p>
        {tracking.at && tracking.unavailable && <p>Refresh failed. Showing the last calculated positions.</p>}
        {!!tracking.failed.length && <p>Unavailable CelesTrak feeds: {tracking.failed.join(", ")}.</p>}
        {!!tracking.stale.length && <p>Using previously retrieved orbital elements for: {tracking.stale.join(", ")}.</p>}
        {satelliteResults.length > 20 && <p>Showing 20 of {satelliteResults.length.toLocaleString()} matches. Search for a specific satellite or select a dot on the map.</p>}
        {satelliteResults.length === 0 && (tracking.at || satelliteCategory === "nominal") && <p>No matching satellites.</p>}
        <ul>{satelliteResults.slice(0, 20).map(({ properties, geometry }) => <li key={properties.key}>
          <button className="outline" aria-pressed={selectedSatellite === properties.key} onClick={() => {
            setSelectedSatellite(properties.key);
            returnToEarth(geometry.coordinates as Point);
          }}>{properties.name}{properties.norad !== null ? ` · ${properties.norad}` : ""}</button>
        </li>)}</ul>
        {satellite && <section aria-label="Public satellite data">
          <h3>{satellite.properties.name}</h3>
          <SatelliteData key={satellite.properties.key} satellite={satellite.properties} />
        </section>}
      </section>}
      <Duck center={summaryPoint ?? riskSelection ?? center} plots={duckPlots} includedPlots={includedPlots}
        onTogglePlot={key => setIncludedPlots(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key])}
        dataset={askWorldview && worldviewDate ? worldview : null} onClearDataset={() => setAskWorldview(false)} />
    </div>
    </div>
    <Tutorial ready={!starting || !!mapError} replay={tutorialReplay} />
  </>;
}
