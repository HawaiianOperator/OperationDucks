"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import maplibre, { type GeoJSONSource, type LngLatLike } from "maplibre-gl";
import { PowerData } from "./power-data";
import area from "@turf/area";
import { daylightAt } from "./day-night";
import { ArrowDownToLine, Bookmark, ChevronDown, CircleHelp, Crosshair, Globe2, Layers, MapPin, Minus, Plus, Search, SquareDashed, X } from "lucide-react";

type Point = [number, number];
type Field = { name: string; points: Point[] };
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
  const [mode, setMode] = useState<"rectangle" | "polygon" | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [field, setField] = useState<Field | null>(null);
  const [saved, setSaved] = useState<Field[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [tab, setTab] = useState("Overview");
  const [showLayers, setShowLayers] = useState(true);
  const [showField, setShowField] = useState(true);
  const [zoom, setZoom] = useState(earthZoom);

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
          },
          layers: [
            { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" }, paint: { "raster-saturation": 0.38, "raster-contrast": 0.2 } },
            { id: "streets", type: "raster", source: "streets" },
            { id: "night-shade", type: "fill", source: "daylight", filter: ["==", "kind", "night"], paint: { "fill-color": "#040a19", "fill-opacity": 0.55, "fill-antialias": false } },
            { id: "terminator-glow", filter: ["==", "kind", "boundary"], type: "line", source: "daylight", paint: { "line-color": "#ffad55", "line-width": 7, "line-blur": 5, "line-opacity": 0.65 } },
            { id: "terminator", filter: ["==", "kind", "boundary"], type: "line", source: "daylight", paint: { "line-color": "#ffe3a1", "line-width": 1.5 } },
            { id: "fill", type: "fill", source: "field", paint: { "fill-color": "#bce58c", "fill-opacity": 0.25 } },
            { id: "boundary", type: "line", source: "field", paint: { "line-color": "#dcf7aa", "line-width": 3 } },
            { id: "vertices", type: "circle", source: "field", filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#e5ffb5", "circle-stroke-width": 2, "circle-stroke-color": "#354326" } },
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
    if (!ready || !map.current) return;
    for (const id of ["satellite", "streets"]) {
      map.current.setLayoutProperty(id, "visibility", id === basemap ? "visible" : "none");
    }
  }, [ready, basemap]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource("field") as GeoJSONSource;
    const vertices = mode ? points : field?.points ?? [];
    source.setData({
      type: "FeatureCollection",
      features: [
        ...(vertices.length >= 3 ? [polygon(vertices)] : []),
        ...vertices.map(point => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: point } })),
      ],
    });
  }, [ready, mode, points, field]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mode) return;
    instance.getCanvas().style.cursor = "crosshair";
    const click = (event: maplibre.MapMouseEvent) => {
      const point = event.lngLat.toArray() as Point;
      if (mode === "rectangle" && points.length === 1) {
        const [x, y] = points[0];
        if (x === point[0] || y === point[1]) return;
        finish([[x, y], [point[0], y], point, [x, point[1]]]);
      } else {
        setPoints([...points, point]);
      }
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setMode(null); };
    instance.on("click", click);
    window.addEventListener("keydown", cancel);
    return () => {
      instance.off("click", click);
      instance.getCanvas().style.cursor = "";
      window.removeEventListener("keydown", cancel);
    };
  }, [mode, points, place]);

  function finish(boundary: Point[]) {
    if (area(polygon(boundary)) <= 0) return;
    setField({ name: place.name + " field", points: boundary });
    setMode(null);
    setTab("Overview");
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

  function returnToEarth() {
    setMode(null);
    setSearchOpen(false);
    setGlobe(true);
    setPlace({ name: "Earth", region: "Global view", center: earth });
    setBasemap("streets");
    map.current?.flyTo({ center: earth, zoom: earthZoom, bearing: 0 });
  }

  function visit(location: typeof place) {
    setGlobe(false); setShowField(true);
    setMode(null);
    setPlace(location);
    setSearchOpen(false);
    setQuery("");
    setSearchError("");
    map.current?.flyTo({ center: location.center, zoom: 12.8 });
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const input = query.trim();
    if (!input) return;
    const coordinates = input.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordinates) {
      const [, lat, lng] = coordinates.map(Number);
      if (Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
        visit({ name: input, region: "Coordinates", center: [lng, lat] });
        return;
      }
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
    setMode(mode === next ? null : next);
  }

  function save() {
    if (!field || saved.some(item => JSON.stringify(item.points) === JSON.stringify(field.points))) return;
    const next = [...saved, field];
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
  const alreadySaved = field && saved.some(item => JSON.stringify(item.points) === JSON.stringify(field.points));

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
          {query && !searchError && <p>Press Enter to search worldwide.</p>}
        </div>}
      </div>
      <div className="saved-wrap">
        <button className="outline" onClick={() => setSavedOpen(!savedOpen)} aria-expanded={savedOpen}><Bookmark size={16} /> <span>Saved fields</span></button>
        {savedOpen && <div className="popover saved">{saved.length ? saved.map((item, index) => <button key={index} onClick={() => {
          const bounds = new maplibre.LngLatBounds();
          item.points.forEach(point => bounds.extend(point as LngLatLike));
          map.current?.fitBounds(bounds, { padding: 70, maxZoom: 17 });
          setGlobe(false); setShowField(true); setPlace({ name: item.name, region: "Saved field", center: bounds.getCenter().toArray() as Point }); setField(item); setMode(null); setTab("Overview"); setSavedOpen(false);
        }}><MapPin size={15} /> {item.name}</button>) : <p>No saved fields yet.</p>}</div>}
      </div>
    </header>

    <main>
      <div className={globe ? "workspace globe-workspace" : "workspace"}>
        <section className="map-card" aria-label="Field map">
          <div className="map-head"><div className="location"><MapPin size={18} /><div><strong>{place.name}</strong><small>{place.region}</small></div></div>
            <div className="segmented" aria-label="Base map">{["satellite", "streets"].map(id => <button key={id} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{id === "satellite" ? "Satellite" : "Street"}</button>)}</div>
          </div>
          <div className={globe ? "map-frame globe-frame" : "map-frame"}>
            <div className="map" ref={container} />
            {mapError && <p className="map-error" role="alert">{mapError}</p>}
            {imageryDelayed && <p className="map-error" role="status">Satellite imagery is taking longer than expected.</p>}
            <div className="map-tools">
              <div><button title="Full Earth view" aria-label="Full Earth view" onClick={returnToEarth}><Globe2 size={18} /></button></div>
              <div><button title="Zoom in" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={19} /></button><button title="Zoom out" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus size={19} /></button></div>
              <div><button title="Reset view" aria-label="Reset view" onClick={() => map.current?.flyTo({ center: place.center, zoom: globe ? earthZoom : 12.8, bearing: 0 })}><Crosshair size={18} /></button></div>
            </div>
            {mode && <div className="draw-note" role="status"><span>{mode === "polygon" ? "Click to add corners." : points.length ? "Click the opposite corner." : "Click the first corner."}</span>{mode === "polygon" && <button disabled={points.length < 3} onClick={() => finish(points)}>Finish</button>}<button aria-label="Cancel drawing" onClick={() => setMode(null)}><X size={15} /></button></div>}
          </div>
          <div className="map-foot"><span><Crosshair size={13} /> {Math.abs(center[1]).toFixed(4)}° {center[1] < 0 ? "S" : "N"} · {Math.abs(center[0]).toFixed(4)}° {center[0] < 0 ? "W" : "E"}</span><span>{globe && <><span className="status-divider">●</span> DAY / NIGHT <span className="status-divider">·</span> </>}ZOOM {zoom.toFixed(1)} <span className="status-divider">·</span> {basemap === "satellite" ? "WORLD IMAGERY" : "STREET MAP"}</span></div>
        </section>

        {globe ? <section className="places" aria-label="Places to explore"><span>Explore a growing region</span>{examples.map(item => <button className="outline" key={item.name} onClick={() => visit(item)}><MapPin size={15} />{item.name}</button>)}</section> : <aside className="hud" aria-label="Field details">
          <button className="outline field-toggle" aria-expanded={showField} onClick={() => setShowField(!showField)}><SquareDashed size={16} /> Field tools <ChevronDown size={15} className={showField ? "" : "closed"} /></button>
          {showField && <div className="hud-content">
          <section className="side-card details">
            <div className="tabs">{["Overview", "Data"].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
            {tab === "Overview" ? <div className="detail-body">
              <div className="section-icon"><SquareDashed size={23} /></div>
              <h2>{field?.name ?? "Field selection"}</h2>
              {field ? <><p><strong>{hectares.toLocaleString(undefined, { maximumFractionDigits: 3 })} ha</strong> · {field.points.length} corners</p><div className="actions"><button className="outline" disabled={!!alreadySaved} onClick={save}><Bookmark size={15} /> {alreadySaved ? "Saved" : "Save field"}</button><button className="outline" onClick={exportField} title="Export GeoJSON" aria-label="Export GeoJSON"><ArrowDownToLine size={17} /></button><button className="outline" title="Clear selection" aria-label="Clear selection" onClick={() => { setField(null); setMode(null); }}><X size={17} /></button></div></> : <p>Draw a boundary on the map to see its area and save the field.</p>}
              <button className="primary" disabled={!ready} aria-pressed={mode === "rectangle"} onClick={() => draw("rectangle")}><SquareDashed size={16} /> {mode === "rectangle" ? "Cancel rectangle" : "Draw rectangle"}</button>
              <button className="secondary" disabled={!ready} aria-pressed={mode === "polygon"} onClick={() => draw("polygon")}>{mode === "polygon" ? "Cancel polygon" : "Draw polygon"}</button>
            </div> : <div className="detail-body"><div className="section-icon"><Layers size={22} /></div><h2>Field data</h2>{field ? <PowerData points={field.points} /> : <p>Draw a field boundary to see NASA POWER data.</p>}</div>}
          </section>
          <section className="side-card source-panel">
            <button className="layer-heading" aria-expanded={showLayers} onClick={() => setShowLayers(!showLayers)}><Layers size={17} /> Data sources <ChevronDown size={16} className={showLayers ? "" : "closed"} /></button>
            {showLayers && <ul className="source-list">{vegetation.map(([name, description]) => <li key={name}><span><strong>{name}</strong><small>{description}</small></span><span className="pending" title="Not connected" aria-label="Not connected" /></li>)}</ul>}
          </section>
          <p className="help"><CircleHelp size={15} /> Coordinates use latitude, longitude.</p>
        </div>}</aside>}
      </div>
    </main>
    </div>
  </>;
}
