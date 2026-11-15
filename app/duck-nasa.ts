type Point = [number, number];
const collections = [
  { id: "ECO_L2T_LSTE", version: "003", name: "ECOSTRESS land surface temperature", matches: /\b(?:ecostress|eco_l2t_lste)\b/i },
  { id: "MOD13Q1", version: "061", name: "MODIS Terra vegetation indices", matches: /\b(?:mod13q1|historical vegetation)\b/i },
  { id: "MOD11A2", version: "061", name: "MODIS Terra eight-day land surface temperature", matches: /\b(?:mod11a2|historical surface temperature)\b/i },
  { id: "GPM_3IMERGDF", version: "07", name: "GPM IMERG Final daily precipitation", matches: /\b(?:gpm_3imergdf|imerg final)\b/i },
];
const iso = (day: Date) => day.toISOString().slice(0, 10);
const coords = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 &&
  Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

async function read(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  return response.json();
}

export function nasaSpatialFilter([lon, lat]: Point, radius: unknown): Record<string, string> {
  return typeof radius === "number" && Number.isFinite(radius) && radius >= 10 && radius <= 6000000 && Math.abs(lat) < 90
    ? { circle: `${lon},${lat},${radius}` } : { point: `${lon},${lat}` };
}

export async function nasaRadiusRecords(point: Point, radius: number) {
  const spatial = nasaSpatialFilter(point, radius);
  return Promise.all([...collections, { id: "SPL4SMGP", version: "008", name: "SMAP root-zone soil moisture" }]
    .map(async ({ id, version, name }) => {
      const url = "https://cmr.earthdata.nasa.gov/search/granules.json?" + new URLSearchParams({
        short_name: id, version, ...spatial, page_size: "1", sort_key: "-start_date",
      });
      try {
        const result = await read(url);
        if (!Array.isArray(result.feed?.entry)) throw new Error("Unexpected NASA catalog response");
        const record = result.feed.entry[0];
        return { title: name, url, value: record
          ? `Latest catalog match · ${record.time_start} · ${record.title}`
          : "No matching observation records." };
      } catch {
        return { title: name, url, value: "NASA catalog temporarily unavailable." };
      }
    }));
}

export async function nasaAnswer(question: string, center: unknown, scope: string, context: string, radius?: unknown) {
  const smap = /\b(?:smap|spl4smgp|soil moisture|root[- ]zone (?:moisture|wetness)|wet (?:is|was) the soil)\b/i.test(question);
  const power = /\b(?:nasa\s+power|t2m)\b/i.test(question);
  const collection = collections.find(item => item.matches.test(question));
  if (!smap && !power && !collection) return null;
  if (/\b(?:compare|planting window)\b/i.test(question) && /\b(?:planting|sow|seed)\b/i.test(question)) return null;
  if (/^(?:global|worldwide|world)$/i.test(scope)) return null;
  let point = center;
  let place = scope;
  if (scope) {
    const pair = scope.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (pair) point = [Number(pair[2]), Number(pair[1])];
    else {
      const lookup = await read("https://photon.komoot.io/api/?" + new URLSearchParams({ q: scope, limit: "1" }));
      point = lookup.features?.[0]?.geometry?.coordinates;
      place = lookup.features?.[0]?.properties?.name ?? scope;
    }
  }
  if (!coords(point)) return { error: "Select a place on the map or enter its name so I can check NASA’s records." };
  const [longitude, latitude] = point;
  const spatial = nasaSpatialFilter(point, scope ? undefined : radius);
  const location = `${place ? place + " · " : ""}${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`;
  const today = new Date();
  const dates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const year = !dates.length ? question.match(/\b(?:19|20)\d{2}\b/)?.[0] : undefined;
  const end = dates.at(-1) ?? (year && year < iso(today).slice(0, 4) ? `${year}-12-31` : iso(today));
  const lookbackDays = collection?.id === "GPM_3IMERGDF" ? 364 : 29;
  const start = dates[0] ?? (year ? `${year}-01-01` : iso(new Date(today.getTime() - lookbackDays * 86400000)));
  if ([start, end].some(day => !Number.isFinite(Date.parse(day)) || iso(new Date(day)) !== day) ||
      start > end || end > iso(today) || Date.parse(end) - Date.parse(start) > 366 * 86400000) {
    return { error: "Use a valid date or a range of up to one year, ending today or earlier." };
  }
  const sources: { title: string; url: string }[] = [];
  const lines = [`NASA records for ${location} · ${start} through ${end} UTC.`];
  if (collection) {
    const url = "https://cmr.earthdata.nasa.gov/search/granules.json?" + new URLSearchParams({
      short_name: collection.id, version: collection.version, ...spatial,
      page_size: "3", sort_key: "-start_date", temporal: `${start}T00:00:00Z,${end}T23:59:59Z`,
    });
    const result = await read(url);
    const entries = result.feed?.entry ?? [];
    lines.push(`${collection.name} · ${collection.id} v${collection.version}.`);
    lines.push(...(entries.length ? entries.map(row => `${row.time_start} · ${row.title}`) : ["No matching catalog records for this point and date range."]));
    lines.push("These are observation records. A measurement for the field requires extracting and quality-checking the science pixels.");
    return { answer: lines.join("\n\n"), sources: [{ title: "NASA Earthdata matched records", url }] };
  }
  const codes = smap ? ["GWETROOT"] : [
    ...(/\b(?:rain\w*|precipitation)\b/i.test(question) ? ["PRECTOTCORR"] : []),
    ...(/\b(?:t2m|temperature|heat|warm|cold)\b/i.test(question) ? ["T2M"] : []),
    ...(/\b(?:solar|sunlight|radiation)\b/i.test(question) ? ["ALLSKY_SFC_SW_DWN"] : []),
  ];
  if (!codes.length) codes.push("T2M", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN");
  const powerUrl = "https://power.larc.nasa.gov/api/temporal/daily/point?" + new URLSearchParams({
    community: "AG", longitude: String(longitude), latitude: String(latitude), parameters: codes.join(","),
    start: start.replaceAll("-", ""), end: end.replaceAll("-", ""), format: "JSON", "time-standard": "UTC",
  });
  const cmrUrl = "https://cmr.earthdata.nasa.gov/search/granules.json?" + new URLSearchParams({
    short_name: "SPL4SMGP", version: "008", ...spatial, page_size: "1",
    sort_key: "-start_date", temporal: `${start}T00:00:00Z,${end}T23:59:59Z`,
  });
  const [daily, cmr] = await Promise.allSettled([read(powerUrl), smap ? read(cmrUrl) : Promise.resolve(null)]);
  sources.push({ title: "NASA POWER daily source records", url: powerUrl });
  if (daily.status === "fulfilled") {
    const data = daily.value;
    for (const code of codes) {
      const entries = Object.entries(data.properties?.parameter?.[code] ?? {})
        .filter((entry): entry is [string, number] => /^\d{8}$/.test(entry[0]) && Number.isFinite(entry[1]) &&
          entry[1] !== data.header?.fill_value && entry[1] !== -999).sort(([a], [b]) => a.localeCompare(b));
      const title = { GWETROOT: "NASA POWER modeled root-zone wetness", PRECTOTCORR: "Corrected precipitation",
        T2M: "Air temperature", ALLSKY_SFC_SW_DWN: "Surface solar radiation" }[code];
      if (!entries.length) { lines.push(`${title} has no published values in this window.`); continue; }
      const [day, latest] = entries.at(-1);
      const unit = code === "GWETROOT" ? "on a 0–1 wetness scale" : data.parameters?.[code]?.units ?? "";
      const sum = entries.reduce((total, [, value]) => total + value, 0);
      const dayIso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
      lines.push(`${title}: ${latest.toFixed(2)} ${unit} on ${dayIso} UTC (latest available).`);
      if (entries.length > 1 && code !== "GWETROOT") lines.push(code === "PRECTOTCORR"
        ? `Total across ${entries.length} published days: ${sum.toFixed(2)} mm.`
        : `Mean across ${entries.length} published days: ${(sum / entries.length).toFixed(2)} ${unit}.`);
    }
  } else lines.push("NASA POWER could not return daily values for this request.");
  if (smap) {
    sources.push({ title: "NASA Earthdata SMAP observation records", url: cmrUrl });
    const observation = cmr.status === "fulfilled" ? cmr.value?.feed?.entry?.[0] : null;
    lines.push(observation ? `Latest SMAP SPL4SMGP catalog record: ${observation.time_start} · ${observation.title}.`
      : cmr.status === "rejected" ? "NASA Earthdata could not return matching SMAP records." : "NASA Earthdata returned no matching SMAP records.");
    lines.push("The wetness number comes from the NASA POWER model. A SMAP catalog match gives an observation time and file ID. Reading a volumetric SMAP value requires extracting the corresponding science pixel.");
  }
  if (context) lines.push(`Your farm notes: ${context}. Use them alongside the gridded estimates, especially if irrigation or drainage varies across the field.`);
  return { answer: lines.join("\n\n"), sources };
}
