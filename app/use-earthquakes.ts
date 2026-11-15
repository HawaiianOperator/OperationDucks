"use client";

import { useEffect } from "react";
import maplibre, { type GeoJSONSource } from "maplibre-gl";

const feed = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
const layer = "usgs-earthquakes";

export function useEarthquakes(instance: maplibre.Map | null, enabled: boolean) {
  useEffect(() => {
    if (!instance || !enabled) return;
    instance.addSource(layer, { type: "geojson", data: feed });
    instance.addLayer({ id: layer, source: layer, type: "circle", paint: {
      "circle-radius": ["interpolate", ["linear"], ["number", ["get", "mag"], 4.5], 4.5, 5, 8, 12],
      "circle-color": "#fd844e", "circle-stroke-color": "#202632", "circle-stroke-width": 1.5,
    } });
    const popup = new maplibre.Popup();
    const select = (event: maplibre.MapLayerMouseEvent) => {
      const point = event.features?.[0];
      if (point?.geometry.type !== "Point") return;
      const { mag, place, time, url } = point.properties;
      const content = document.createElement("div");
      content.style.color = "#101820";
      content.textContent = `M${mag} · ${place} · ${new Date(time).toISOString()}`;
      if (typeof url === "string" && url.startsWith("https://earthquake.usgs.gov/")) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "View USGS earthquake record";
        content.append(document.createElement("br"), link);
      }
      popup.setLngLat(event.lngLat).setDOMContent(content).addTo(instance);
    };
    instance.on("click", layer, select);
    const timer = window.setInterval(() => (instance.getSource(layer) as GeoJSONSource)?.setData(feed), 60000);
    return () => {
      window.clearInterval(timer);
      popup.remove();
      instance.off("click", layer, select);
      if (instance.getLayer(layer)) instance.removeLayer(layer);
      if (instance.getSource(layer)) instance.removeSource(layer);
    };
  }, [instance, enabled]);
}
