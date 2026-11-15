"use client";

import { useEffect, useState } from "react";
import type { Spacecraft } from "./spacecraft";

const products: [RegExp, string, string, string][] = [
  [/^GOES/, "NOAA GOES", "ABI imagery, cloud products and GLM lightning", "https://registry.opendata.aws/noaa-goes/"],
  [/^(NOAA[- ]?(20|21)|JPSS|SUOMI|SNPP)/, "NOAA JPSS", "VIIRS imagery, fire detections and atmospheric soundings", "https://www.ncei.noaa.gov/products/joint-polar-satellite-system"],
  [/^SMAP/, "NASA SMAP", "Surface and modeled root-zone soil moisture", "https://nsidc.org/data/smap"],
  [/^GPM/, "NASA GPM", "Microwave and radar observations and IMERG precipitation estimates", "https://gpm.nasa.gov/data"],
  [/^LANDSAT/, "USGS Landsat", "Surface reflectance and temperature products for NDVI and land monitoring", "https://www.usgs.gov/landsat-missions/landsat-data-access"],
  [/^(TERRA|AQUA)(\b|$)/, "NASA MODIS", "Vegetation indices, thermal products and historical imagery", "https://modis.gsfc.nasa.gov/data/"],
  [/^ISS\b/, "NASA ISS / EMIT", "Imaging spectroscopy and surface reflectance", "https://earth.jpl.nasa.gov/emit/data/data-portal/"],
  [/^ISS\b/, "NASA ISS / ECOSTRESS", "Land surface temperature and evapotranspiration", "https://ecostress.jpl.nasa.gov/data"],
  [/^PACE\b/, "NASA PACE", "Ocean color and atmospheric observations", "https://pace.oceansciences.org/data.htm"],
  [/^SENTINEL/, "Copernicus Sentinel", "Mission-specific optical, radar and atmospheric products", "https://dataspace.copernicus.eu/"],
  [/^HIMAWARI/, "JMA Himawari", "Geostationary weather imagery", "https://www.data.jma.go.jp/mscweb/en/himawari89/"],
];

type Radio = { description: string; low: number | null; high: number | null; mode: string | null; status: string };

export function SatelliteData({ satellite }: { satellite: Spacecraft }) {
  const [radio, setRadio] = useState<Radio[] | "error" | null>(null);
  const [requested, setRequested] = useState(false);
  const { name, norad } = satellite;
  useEffect(() => {
    if (!requested || norad === null) return;
    const controller = new AbortController();
    fetch(`/api/satellite-radio?norad=${norad}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("SatNOGS unavailable");
        return response.json();
      })
      .then(data => { if (!controller.signal.aborted) setRadio(data.records); })
      .catch(() => { if (!controller.signal.aborted) setRadio("error"); });
    return () => controller.abort();
  }, [norad, requested]);

  const matches = products.filter(([pattern]) => pattern.test(name));
  return <div className="detail-body">
    <h3>Public data products</h3>
    {matches.length ? <ul>{matches.map(([, label, description, url]) => <li key={label}>
      <a href={url} target="_blank" rel="noreferrer">{label}</a> · {description}
    </li>)}</ul> : <p>No public payload product is linked for this entry.</p>}
    {(norad === 43013 || norad === 37849) && <p>
      NOAA High-Rate Data direct broadcast: 7812 MHz RX, X-band, 15 Mbps. Carries science observations including VIIRS, CrIS, ATMS, and OMPS.
      {" "}<a href="https://www.ospo.noaa.gov/operations/jpss/fts/" target="_blank" rel="noreferrer">NOAA receiver and processing documentation</a>
    </p>}
    {norad !== null && <>
      <a href={`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=json`} target="_blank" rel="noreferrer">Orbital elements (OMM JSON)</a>
      <p><button className="outline" onClick={() => { setRadio(null); setRequested(true); }} disabled={requested}>Look up public downlinks</button></p>
      {requested && <div role="status">
        {radio === null ? "Checking SatNOGS…" : radio === "error" ? "SatNOGS lookup failed. Reopen this satellite to retry."
          : radio.length ? <ul>{radio.map(({ description, low, high, mode, status }, index) => <li key={index}>
            {description} · {((low || high) / 1e6).toFixed(5)}{low && high && low !== high ? `–${(high / 1e6).toFixed(5)}` : ""} MHz RX
            {mode ? ` · ${mode}` : ""}{status ? ` · ${status}` : ""}
          </li>)}</ul> : "SatNOGS returned no downlink records for this NORAD ID."}
        <p>Catalog status describes the transmitter record. Reception depends on the pass, signal, and receiver.</p>
        <p><a href={`https://db.satnogs.org/satellite/${norad}/`} target="_blank" rel="noreferrer">SatNOGS transmitter catalog</a></p>
      </div>}
    </>}
  </div>;
}
