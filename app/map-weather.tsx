"use client";

import { useEffect, useState } from "react";
import type { Map as MapInstance, RasterTileSource } from "maplibre-gl";
import { Cloud, CloudRain, Wind } from "lucide-react";
import { watchFeed } from "./watch-feed";

type Frame = { time: number; path: string };
const radarSource = "weather-radar";
const cloudSource = "weather-cloud";

function useRaster(map: MapInstance | null, id: string, tiles: string | undefined, zoom: number, opacity: number) {
  const enabled = !!tiles;
  useEffect(() => {
    if (!map || !enabled) return;
    return () => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, id, enabled]);
  useEffect(() => {
    if (!map || !tiles) return;
    const source = map.getSource<RasterTileSource>(id);
    if (source) source.setTiles([tiles]);
    else {
      map.addSource(id, { type: "raster", tiles: [tiles], tileSize: 256, maxzoom: zoom });
      map.addLayer({ id, type: "raster", source: id, paint: {
        "raster-opacity": opacity, "raster-fade-duration": 0,
      } }, id === cloudSource && map.getLayer(radarSource) ? radarSource : "fill");
    }
  }, [map, id, tiles, zoom, opacity]);
}

export function MapWeather({ map, wind, toggleWind, drawing }: {
  map: MapInstance | null; wind: boolean; toggleWind: () => void; drawing: boolean;
}) {
  const [rain, setRain] = useState(false);
  const [clouds, setClouds] = useState(false);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [picked, setPicked] = useState<number>();
  const [playing, setPlaying] = useState(false);
  const [radarError, setRadarError] = useState(false);
  const [cloudDate, setCloudDate] = useState<string>();
  const [cloudError, setCloudError] = useState(false);
  useEffect(() => {
    if (!rain) return;
    return watchFeed(async signal => {
      try {
        const response = await fetch("https://api.rainviewer.com/public/weather-maps.json", { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Radar metadata unavailable");
        const data = await response.json();
        const next: Frame[] = Array.isArray(data.radar?.past) ? data.radar.past.filter((frame: Frame) =>
          Number.isSafeInteger(frame?.time) && typeof frame.path === "string" && /^\/v2\/radar\/\d+$/.test(frame.path)) : [];
        if (!next.length) throw new Error("No published radar frames");
        if (!signal.aborted) {
          setFrames(next.sort((a, b) => a.time - b.time));
          setRadarError(false);
        }
      } catch {
        if (!signal.aborted) setRadarError(true);
      }
    }, 60000);
  }, [rain]);
  useEffect(() => {
    if (!rain || !playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setPicked(previous => frames[(frames.findIndex(frame => frame.time === previous) + 1) % frames.length].time);
    }, 900);
    return () => window.clearInterval(timer);
  }, [rain, playing, frames]);
  useEffect(() => {
    if (!clouds) return;
    return watchFeed(async signal => {
      try {
        const response = await fetch("/api/worldview", { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Cloud imagery unavailable");
        const { cloudDate: date } = await response.json();
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("No published cloud date");
        if (!signal.aborted) { setCloudDate(date); setCloudError(false); }
      } catch {
        if (!signal.aborted) setCloudError(true);
      }
    }, 300000);
  }, [clouds]);
  const index = frames.findIndex(frame => frame.time === picked);
  const visibleIndex = index < 0 ? frames.length - 1 : index;
  const frame = frames[visibleIndex];
  const radarTiles = rain && frame ? `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_0.png` : undefined;
  const cloudTiles = clouds && cloudDate
    ? `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_Cloud_Fraction_Day&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}&TIME=${cloudDate}`
    : undefined;
  useRaster(map, cloudSource, cloudTiles, 6, 0.55);
  useRaster(map, radarSource, radarTiles, 7, 0.8);

  if (drawing) return null;
  return <div className="map-weather" aria-label="Weather overlays">
    {rain && <div className="weather-frame">
      <div>{frame ? `Radar frame ${new Date(frame.time * 1000).toISOString().slice(11, 16)} UTC · ${index < 0 ? "Latest" : "History"}` :
        radarError ? "Radar unavailable" : "Loading radar…"}
        {radarError && frame && " · Refresh failed"}</div>
      {frames.length > 1 && <div className="weather-timeline">
        <button type="button" onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={0} max={frames.length - 1} value={visibleIndex} aria-label="Radar frame"
          onChange={event => { setPlaying(false); setPicked(frames[Number(event.target.value)].time); }} />
        <button type="button" onClick={() => { setPlaying(false); setPicked(undefined); }}>Latest</button>
      </div>}
      <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">Weather data by RainViewer</a>
    </div>}
    {clouds && <div className="weather-frame">
      <a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noreferrer">NASA MODIS daytime cloud fraction</a>
      <div>{cloudDate ? `${cloudDate} UTC · Daily imagery${cloudError ? " · Refresh failed" : ""}` :
        cloudError ? "Cloud imagery unavailable" : "Loading cloud imagery…"}</div>
    </div>}
    <div className="weather-buttons">
      <button type="button" aria-pressed={rain} onClick={() => { setRain(!rain); setPlaying(false); setPicked(undefined); }}><CloudRain size={15} /> Radar</button>
      <button type="button" aria-pressed={clouds} onClick={() => setClouds(!clouds)}><Cloud size={15} /> Clouds</button>
      <button type="button" aria-pressed={wind} onClick={toggleWind}><Wind size={15} /> Wind</button>
    </div>
  </div>;
}
