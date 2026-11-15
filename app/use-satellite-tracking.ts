"use client";

import { useEffect, useState } from "react";
import { spacecraftPoints, type SatelliteCategory, type SatellitePoints } from "./spacecraft";

const empty: SatellitePoints = { type: "FeatureCollection", features: [] };
type Tracking = { points: SatellitePoints; at: string; failed: string[]; stale: string[] };
export function useSatelliteTracking(category: SatelliteCategory, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ category: SatelliteCategory; data: Tracking }>(null);
  const [error, setError] = useState<SatelliteCategory>(null);
  useEffect(() => {
    if (!enabled || category === "nominal") return;
    const controller = new AbortController();
    let updating = false;
    async function refresh() {
      if (updating) return;
      updating = true;
      try {
        const response = await fetch(`/api/satellites?category=${category}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Orbital feed unavailable");
        const data: Tracking = await response.json();
        if (!controller.signal.aborted) {
          setSnapshot({ category, data });
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted) setError(category);
      } finally {
        updating = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [category, enabled]);
  const data = snapshot?.category === category ? snapshot.data : null;
  return {
    points: category === "nominal" ? spacecraftPoints : data?.points ?? empty,
    at: data?.at,
    failed: data?.failed ?? [],
    stale: data?.stale ?? [],
    unavailable: error === category,
  };
}
