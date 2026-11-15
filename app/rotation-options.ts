import { cropAreaByYear, cropHistorySource, plotCropHistories } from "./plot-crop-history";
import { soilProfile } from "./soil";
import { scotlandCapability, scotlandCapabilitySource, worldCover, worldCoverArea, worldCoverSource } from "./agricultural-land-context";
import { beauceSowing, easternWheatbeltSowing, plantingState, plantingWindow, worldCerealCalendar, worldCerealCalendarSource } from "./crop-planting-calendar";
import type { Point } from "./plot-geometry";
import { indiaSeasonalRiceSource } from "./india-rice-history";

const alfalfa = "https://extension.umn.edu/agriculture/crop-production/corn/managing-the-rotation-from-alfalfa-to-corn";
const smallGrains = "https://extension.umn.edu/agriculture/crop-production/small-grains/small-grain-crop-rotations";

// Keep named crop classes. A land-cover or orchard transition needs a separate review.
const supported = new Set([
  "corn", "soybeans", "alfalfa", "oats", "barley", "spring barley", "winter barley", "spring oats", "spring wheat", "winter wheat",
  "dry beans", "peas", "sunflower", "cotton", "tomatoes", "rice", "sorghum", "safflower", "sugarbeets", "canola", "potatoes", "onions",
]);

type Cycle = { crops: string[]; sites: number; year: number };
const wheatSoybeanClass = "dbl crop winwht/soybeans";
const cropAliases = new Map([
  ["maize", "corn"], ["soybean", "soybeans"], ["soya", "soybeans"], ["soja", "soybeans"], ["lucerne", "alfalfa"],
  ["blé tendre d’hiver", "winter wheat"], ["blé tendre d'hiver", "winter wheat"], ["blé tendre de printemps", "spring wheat"],
  ["orge de printemps", "spring barley"], ["orge d’hiver", "winter barley"], ["orge d'hiver", "winter barley"], ["maïs grain", "corn"], ["maïs", "corn"],
  ["colza d’hiver", "canola"], ["colza d'hiver", "canola"], ["tournesol", "sunflower"],
]);
const cropKey = (name: string) => {
  const key = name.toLowerCase().trim();
  if (/^pois (?:de printemps|d[’']hiver)(?:\b|$)/.test(key)) return "peas";
  if (/^aardappelen\b/.test(key)) return "potatoes";
  if (/^uien\b/.test(key)) return "onions";
  return cropAliases.get(key) ?? key;
};

function combinationTradeoffs(crops: string[], sameSeason = false, recurring = false) {
  const [first, next] = crops.map(cropKey);
  const cereal = (crop: string) => /wheat|barley|oats/.test(crop);
  const legume = /alfalfa|soybeans|peas|dry beans/;
  const pairs = crops.slice(1).map((crop, index) => [cropKey(crops[index]), cropKey(crop)]);
  if (recurring) pairs.push([cropKey(crops.at(-1)!), first]);
  const risks = [];
  const outcomes = [];
  if (sameSeason) {
    risks.push("A late first harvest or limited soil moisture can delay the second sowing and shorten its growing season");
    outcomes.push("Two harvests in one year may be possible when the second crop has enough time and water to mature");
  }
  if (pairs.some(([a, b]) => (cereal(a) || a === "corn") && /wheat|barley/.test(b))) {
    risks.push("Cereal or corn residue can carry Fusarium into the following wheat or barley crop");
  }
  if (pairs.some(([a, b]) => legume.test(a) && (cereal(b) || b === "corn"))) {
    outcomes.push("A legume can contribute nitrogen to the following grain crop. Check the locally recommended nitrogen credit");
  }
  if (crops.some(crop => cropKey(crop) === "canola")) {
    risks.push("Check the interval between susceptible broadleaf crops and the field’s history of Sclerotinia and clubroot");
  }
  if (first === "alfalfa" && next === "corn") {
    risks.push("Confirm that the alfalfa is fully terminated and check remaining soil moisture before planting corn");
  }
  if (!outcomes.length) outcomes.push("Switching crop families or planting dates can spread fieldwork and help disrupt some pest and weed cycles");
  risks.push("Check drainage, soil pH, available water, local frost dates, herbicide carryover, and market or seed availability");
  return { risks: risks.join(". ") + ".", outcomes: outcomes.join(". ") + "." };
}

function farmerCropHistory(notes: string) {
  const rows = new Map<number, { crop: string; code: number; year: number }>();
  for (const match of notes.matchAll(/^(20\d{2})\s*:\s*([a-z][a-z -]*)\s*$/gim)) {
    const year = Number(match[1]);
    if (year > new Date().getUTCFullYear() || rows.has(year)) return [];
    rows.set(year, { year, crop: match[2].trim(), code: 1 });
  }
  return [...rows.values()].sort((a, b) => a.year - b.year);
}

function findCycles(rows: { crop: string; code: number | null; year: number }[]) {
  const last = rows.filter(row => row.code !== null).at(-1);
  if (!last) return new Map<string, Cycle>();
  const latest = cropKey(last.crop);
  const cycles = new Map<string, Cycle>();
  for (let start = 0; start < rows.length - 2; start++) {
    if (cropKey(rows[start].crop) !== latest) continue;
    const crops = [rows[start].crop.trim()];
    const seen = new Set([latest]);
    for (let end = start + 1; end <= Math.min(start + 4, rows.length - 1); end++) {
      const row = rows[end];
      const crop = cropKey(row.crop);
      if (row.code === null || row.year !== rows[end - 1].year + 1 || !supported.has(crop)) break;
      if (crop === latest && crops.length > 1) {
        cycles.set(crops.map(cropKey).join("|"), { crops, sites: 1, year: row.year });
      }
      if (seen.has(crop)) break;
      seen.add(crop);
      crops.push(row.crop.trim());
    }
  }
  return cycles;
}

export async function rotationOptions(points: Point[], center = points[0], notes = "", areaSummary = "", boundary?: Point[], focusChoice?: number) {
  const hasBoundary = !!boundary;
  const [lon, lat] = hasBoundary ? points[Math.floor(points.length / 2)] : center;
  if ((boundary ?? points).every(([, y]) => y <= -60)) return {
    answer: ["This selection is in the Antarctic region. Outdoor farm rotation and sowing guidance are unavailable here.", areaSummary].filter(Boolean).join("\n\n"),
    sources: [{ title: "British Antarctic Survey · Antarctic land and vegetation", url: "https://www.bas.ac.uk/about/where-we-work/antarctica/" }],
  };
  const [results, soil, capability, areaCover, annualArea] = await Promise.all([
    plotCropHistories(points),
    soilProfile(lat, lon).catch(() => null),
    scotlandCapability(points),
    boundary ? worldCoverArea(boundary, center).catch(() => null) : null,
    boundary && boundary.length <= 128 ? cropAreaByYear(boundary).catch(() => null) : null,
  ]);
  const histories = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const sources = [...new Map(histories.filter(history => history.status !== "outside").map(history => [history.documentation, {
    title: cropHistorySource[history.method],
    url: history.documentation,
  }])).values()];
  if (histories.some(history => history.method === "indiaRice" && history.status === "found")) {
    sources.push({ title: "India paddy rice · seasonal 10 m maps, 2018–2022", url: indiaSeasonalRiceSource });
  }
  sources.push(
    { title: "Check planting windows · FAO Crop Calendar", url: "https://cropcalendar.apps.fao.org/" },
    { title: "Check regional crop suitability · FAO GAEZ", url: "https://www.fao.org/gaez/en" },
    { title: "Check regional irrigation calendars · FAO AQUASTAT", url: "https://www.fao.org/aquastat/en/databases/crop-calendar/index.html" },
    { title: "Compare published rotation trials · Rothamsted Research", url: "https://www.era.rothamsted.ac.uk/info/default/RLTEdatavailable" },
  );
  if (!histories.some(history => history.status === "found")) {
    sources.push({ title: "Regional crop and irrigation maps · ESA WorldCereal",
      url: "https://esa-worldcereal.org/en/products/global-maps" });
    if (lat >= -34 && lat <= 6 && lon >= -74 && lon <= -34) {
      sources.push({ title: "Brazil crop and land-use maps · MapBiomas", url: "https://brasil.mapbiomas.org/iniciativas-e-produtos/cobertura-e-uso-da-terra/agricultura/uso-agricola/" });
    }
  }
  const samples = results.flatMap((result, index) => {
    if (result.status !== "fulfilled" || result.value.fields.length !== 1 || !result.value.fields[0].history.length) return [];
    return [{ ...result.value, point: points[index] }];
  });
  const landCover = samples.length || areaCover ? new Map<string, number>() : await worldCover(points);
  const latest = new Map<string, number>();
  const kenyaSeasons = new Map<string, Map<string, number>>();
  const transitions = new Map<string, { first: string; next: string; year: number; sites: number; point: Point }>();
  const cycles = new Map<string, Cycle>();
  const cyclePoints = new Map<string, [number, number]>();
  const wheatSoybeanSites = [];
  for (const sample of samples) {
    const rows = sample.fields[0].history.filter(row => row.code !== null);
    if (sample.method === "kenya") {
      for (const row of sample.fields[0].history) {
        const classes = kenyaSeasons.get(row.season) ?? new Map<string, number>();
        classes.set(row.crop, (classes.get(row.crop) ?? 0) + 1);
        kenyaSeasons.set(row.season, classes);
      }
    }
    const current = rows.at(-1);
    if ("incompleteYears" in sample && sample.incompleteYears.some(year => year > (current?.year ?? 0))) continue;
    if (current) latest.set(current.crop, (latest.get(current.crop) ?? 0) + 1);
    if (sample.method === "kenya" || sample.method === "indiaRice" || sample.method === "worldcereal") continue;
    const previous = rows.at(-2);
    if (current && (sample.method === "cdl" || sample.method === "csb") && cropKey(current.crop) === wheatSoybeanClass) {
      wheatSoybeanSites.push({ point: sample.point, year: current.year,
        recurring: previous?.year === current.year - 1 && cropKey(previous.crop) === wheatSoybeanClass });
    }
    for (const [key, cycle] of findCycles(rows)) {
      const prior = cycles.get(key);
      if (!prior || prior.year <= cycle.year) cyclePoints.set(key, sample.point);
      cycles.set(key, { ...cycle, sites: (prior?.sites ?? 0) + 1, year: Math.max(prior?.year ?? 0, cycle.year) });
    }
    const seenTransitions = new Set<string>();
    for (let i = rows.length - 1; i > 0; i--) {
      const first = rows[i - 1];
      const next = rows[i];
      const firstCrop = cropKey(first.crop);
      const nextCrop = cropKey(next.crop);
      if (next.year !== first.year + 1 || firstCrop === nextCrop ||
        !supported.has(firstCrop) || !supported.has(nextCrop)) continue;
      const key = firstCrop + ":" + nextCrop;
      if (seenTransitions.has(key)) continue;
      seenTransitions.add(key);
      const prior = transitions.get(key);
      transitions.set(key, prior && prior.year > next.year ? { ...prior, sites: prior.sites + 1 } :
        { first: first.crop, next: next.crop, year: next.year, sites: (prior?.sites ?? 0) + 1, point: sample.point });
    }
  }
  const farmerHistory = farmerCropHistory(notes);
  const lastFarmerCrop = farmerHistory.at(-1);
  const farmerCycle = [...findCycles(farmerHistory).values()].sort((a, b) => b.year - a.year || a.crops.length - b.crops.length)[0];
  const candidates = [...transitions.values()].filter(item => !lastFarmerCrop || cropKey(item.first) === cropKey(lastFarmerCrop.crop))
    .sort((a, b) => b.sites - a.sites || b.year - a.year);
  const perennial = /citrus|almonds|walnuts|pistachios|orchard|grapes|tree crops|peaches|apples|pears|olives|cherries/i;
  const orchardSites = [...latest].reduce((total, [crop, count]) => total + (perennial.test(crop) ? count : 0), 0);
  const mostlyOrchard = orchardSites > samples.length / 2;
  const roughGrazing = [...capability].reduce((total, [code, count]) => total + (Math.floor(code) === 6 ? count : 0), 0);
  const improvedGrassland = [...capability].reduce((total, [code, count]) => total + (Math.floor(code) === 5 ? count : 0), 0);
  const barleyOats = capability.get(3.2) ?? 0;
  const localOptions = roughGrazing > points.length / 2
    ? "The selected area is mainly mapped as rough grazing. Assess the existing grazing land. If you have an arable field inside the radius, outline that field separately before choosing crops."
    : improvedGrassland > points.length / 2
      ? "The selected area is mainly mapped as land suitable for improved grassland. Compare locally adapted pasture options for the intended grazing or forage use."
      : barleyOats > points.length / 2
        ? "Barley and oats are candidates to assess here. Most sampled points fall in Scottish land capability class 3.2, which also supports grass leys. Confirm drainage, soil pH, and the planting window on the individual field."
        : null;
  const cropSites = [...latest].reduce((total, [crop, count]) =>
    total + (supported.has(cropKey(crop)) ? count : 0), 0);
  const establishedCropland = lastFarmerCrop ? supported.has(cropKey(lastFarmerCrop.crop)) : cropSites > points.length / 2;
  const best = farmerCycle ?? (!establishedCropland ? undefined : [...cycles.values()]
    .filter(cycle => cycle.sites > points.length / 2 &&
      (!lastFarmerCrop || cropKey(cycle.crops[0]) === cropKey(lastFarmerCrop.crop)))
    .sort((a, b) => b.sites - a.sites || b.year - a.year ||
    a.crops.length - b.crops.length || a.crops.join("|").localeCompare(b.crops.join("|")))[0]);
  const localCycle = !best && !lastFarmerCrop ? [...cycles.entries()]
    .sort(([, a], [, b]) => b.sites - a.sites || b.year - a.year)[0] : undefined;
  const doubleCrop = !lastFarmerCrop ? wheatSoybeanSites.sort((a, b) => Number(b.recurring) - Number(a.recurring) || b.year - a.year)[0] : undefined;
  const lines = best ? [
    `Best-supported crop cycle: ${[...best.crops.slice(1), best.crops[0]].join(" → ")}.`,
    `If your most recent crop was ${best.crops[0]}, the next crop in this cycle is ${best.crops[1]}. ${farmerCycle
      ? `Your farm records showed this sequence returning to its starting crop in ${best.year}.`
      : `Crop records showed this sequence returning to its starting crop at ${best.sites} of ${samples.length} mapped sample locations, most recently in ${best.year}.`} Check the planting window and available water before using the cycle.`,
  ] : [localOptions ?? (mostlyOrchard
    ? "Most sampled locations are mapped as perennial crops. Confirm which trees or vines are in place before evaluating alley cover crops or replacement planting."
    : !establishedCropland
      ? "The available history doesn’t establish an annual rotation across this selection. Draw around one cultivated field or enter its crop history under Add farm details."
      : "There isn’t enough mapped crop history to recommend a recurring crop cycle for this area.")];
  if (areaSummary) lines.push(areaSummary);
  if (annualArea) {
    lines.push("USDA mapped crop and land-cover shares across the selected boundary by year.", ...annualArea.records);
    sources.push(annualArea.source);
  }
  if (areaCover) {
    lines.push(`ESA WorldCover 2021 · share of mapped area inside the boundary: ${areaCover.classes}. ` +
      `${areaCover.cells.toLocaleString("en-US")} mapped cells${areaCover.missing ? ` and ${areaCover.missing.toLocaleString("en-US")} unclassified cells` : ""}. ` +
      "This map shows land cover in 2021. Crop identities and rotation history require separate records.");
    sources.push({ title: "ESA WorldCover · 2021 land-cover map", url: worldCoverSource });
  }
  if (capability.size) {
    const mappedPoints = [...capability.values()].reduce((sum, count) => sum + count, 0);
    const classes = [...capability].sort(([a], [b]) => a - b).map(([code, count]) => `class ${code} (${count})`).join(", ");
    lines.push(`Scotland’s Land Capability for Agriculture mapped ${mappedPoints} of ${points.length} points. ${classes}.`);
    if (roughGrazing) lines.push(`Class 6 indicates rough grazing at ${roughGrazing} sampled points.`);
    sources.push({ title: "Scotland’s Land Capability for Agriculture", url: scotlandCapabilitySource },
      { title: "Scottish Crop Map · 2019 snapshot", url: "https://www.gov.scot/publications/scottish-crop-map-2019/pages/2/" });
  }
  if (landCover.size) {
    const mappedPoints = [...landCover.values()].reduce((sum, count) => sum + count, 0);
    const classes = [...landCover].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type} (${count})`).join(", ");
    lines.push(`ESA WorldCover land cover in 2021 at ${mappedPoints} of ${points.length} points: ${classes}. These classes describe land cover. Crop sequences require annual crop records.`);
    sources.push({ title: "ESA WorldCover · land cover classes", url: worldCoverSource });
  } else if (!samples.length && !capability.size && !areaCover) {
    lines.push("No land-cover or land-capability class was available at the queried points.");
  }
  if (hasBoundary) {
    lines.push(`Crop-history coverage: ${samples.length} of ${points.length} points inside the boundary returned crop inventory records.`);
    const classCoverage = cropSites + wheatSoybeanSites.length;
    lines.push(`Supported rotation crop labels: ${classCoverage} of ${points.length} points had a usable latest crop class. This selection may include other crops or land cover.`);
    if (best && !farmerCycle) {
      const percent = (100 * best.sites / points.length).toLocaleString("en-US", { maximumFractionDigits: 1 });
      lines.push(`Cycle support: ${percent}% (${best.sites} of ${points.length} sampled points). Points can share the same underlying record, and this count describes mapped history only.`);
    } else if (farmerCycle) {
      lines.push("Cycle support comes from the farm history supplied for this selection.");
    } else {
      lines.push("A recurring crop cycle could not be established for the whole selection.");
    }
  } else {
    lines.push("Draw or select a field boundary to assess confidence across the area.");
    lines.push(`Crop inventories returned history at ${samples.length} of ${points.length} queried locations.`);
  }
  if (latest.size) lines.push("Latest mapped classes: " +
    [...latest].map(([crop, count]) => `${crop} (${count})`).join(", ") + ".");
  if (kenyaSeasons.size) {
    lines.push("Kenya · mapped crop groups by rainy season. Dominant crops may share a field with other crops.");
    for (const [season, classes] of kenyaSeasons) {
      lines.push(`${season} · ${[...classes].map(([crop, count]) => `${crop} (${count})`).join(", ")}.`);
    }
  }
  if (results.some(result => result.status === "rejected") || histories.some(history =>
    "incompleteYears" in history && history.incompleteYears.length)) {
    lines.push("Some years could not be retrieved from the crop inventory. Try again for fuller coverage.");
  }
  const topsoil = soil?.samples.find(sample => sample.depth === "0-5")?.ph;
  if (topsoil != null) {
    lines.push(`ISRIC SoilGrids estimates topsoil pH ${topsoil.toFixed(1)} at 0–5 cm ${hasBoundary ? "at one point inside the selection" : "at the queried location"}. Check a field soil test against the pH needs of each candidate crop.`);
    sources.push({ title: "ISRIC SoilGrids modeled soil pH", url: soil.source });
  }
  if (notes) {
    lines.push(`Farmer notes: ${notes}`);
    if (/\b(?:water shortage|limited water|no irrigation|rainfed|rain-fed|conserve water|drought)\b/i.test(notes)) {
      lines.push("Water is a stated priority. Compare each candidate’s water needs during establishment and the timing of peak use. For a cover crop, track how much moisture remains for the following cash crop.");
    }
  }
  const addPlantingWindows = async (crops: string[], point: [number, number], doubleCrop = false) => {
    const state = await plantingState(point);
    for (const crop of new Set(crops)) {
      const key = cropKey(crop);
      const window = plantingWindow(key, state, point[1] === lat && point[0] === lon && capability.size > 0, doubleCrop) ??
        beauceSowing(point, key) ?? easternWheatbeltSowing(point, key);
      if (window) {
        lines.push(`${crop} · ${window.guidance}`);
        if (!sources.some(source => source.url === window.source.url)) sources.push(window.source);
        continue;
      }
      const seasons = doubleCrop ? [] : await worldCerealCalendar(point, key);
      if (seasons.length) {
        lines.push(`${crop} · historical WorldCereal zone calendar. Confirm the local sowing window before choosing a date.`, ...seasons);
        if (!sources.some(source => source.url === worldCerealCalendarSource.url)) sources.push(worldCerealCalendarSource);
      } else {
        lines.push(`${crop} · A verified local planting window is unavailable. Check the regional crop calendar or local extension for the variety and growing season.`);
      }
    }
  };
  type Choice = { crops: string[]; point: Point; why: string; recurring?: boolean; doubleCrop?: boolean };
  const choices: Choice[] = [];
  for (const cycle of [best, ...(localCycle ? [localCycle[1]] : [])]) {
    if (!cycle) continue;
    const point: Point = cycle === farmerCycle ? [lon, lat] : cyclePoints.get(cycle.crops.map(cropKey).join("|")) ?? [lon, lat];
    choices.push({ crops: [...cycle.crops.slice(1), cycle.crops[0]], point, recurring: true,
      why: cycle === farmerCycle ? `The supplied farm history shows the cycle returning to its starting crop in ${cycle.year}.` :
        `The crop inventory shows a repeat at ${cycle.sites} of ${points.length} points, most recently in ${cycle.year}.` });
  }
  const otherCycles = [...cycles.entries()].sort(([, a], [, b]) => b.sites - a.sites || b.year - a.year);
  for (const [key, cycle] of otherCycles) {
    if (choices.length >= (doubleCrop ? 4 : 5)) break;
    if (cycle === best || cycle === localCycle?.[1] ||
      (lastFarmerCrop && cropKey(cycle.crops[0]) !== cropKey(lastFarmerCrop.crop))) continue;
    choices.push({ crops: [...cycle.crops.slice(1), cycle.crops[0]], point: cyclePoints.get(key) ?? [lon, lat],
      recurring: true, why: `Historical repeat at ${cycle.sites} of ${points.length} sampled points, most recently in ${cycle.year}.` });
  }
  if (doubleCrop) {
    const [x, y] = doubleCrop.point;
    lines.push(`${doubleCrop.recurring ? "Recurring double crop" : "Mapped double crop"} at ${wheatSoybeanSites.length} of ${points.length} queried points · winter wheat → soybeans in the same harvest year. ` +
      `Example point: ${y.toFixed(5)}, ${x.toFixed(5)} (latitude, longitude). ` +
      (doubleCrop.recurring ? `The same sequence was mapped in ${doubleCrop.year - 1} and ${doubleCrop.year} at this point.` :
        `The inventory mapped this sequence in ${doubleCrop.year}. A consecutive repeat is unverified.`) +
      " Outline the cultivated field around this point to check its own history.");
    choices.push({ crops: ["Winter wheat", "Soybeans"], point: doubleCrop.point, doubleCrop: true,
      why: `The two crops were mapped in the same harvest year at ${wheatSoybeanSites.length} of ${points.length} sampled points, most recently in ${doubleCrop.year}.` });
  }
  if (localCycle) {
    const [key, cycle] = localCycle;
    const point = cyclePoints.get(key)!;
    lines.push(`Historical cycle at ${cycle.sites} of ${points.length} queried points · ${[...cycle.crops, cycle.crops[0]].join(" → ")}. ` +
      `The most recent mapped recurrence ended in ${cycle.year}. Example point: ${point[1].toFixed(5)}, ${point[0].toFixed(5)} (latitude, longitude).`);
  }
  if (!best && !localCycle && barleyOats > points.length / 2) {
    await addPlantingWindows(["Spring barley", "Spring oats"], [lon, lat]);
  }
  const sampledCropland = (landCover.get("cropland") ?? 0) > points.length / 2;
  if (!best && !localCycle && !doubleCrop && !establishedCropland && barleyOats <= points.length / 2 &&
    (areaCover ? areaCover.cropland > 0.5 : sampledCropland)) {
    const seasons = await worldCerealCalendar([lon, lat]);
    if (seasons.length) {
      lines.push("Regional crop seasons to investigate · WorldCereal’s historical zone calendar. Confirm the crop, variety, water supply, and sowing date locally before planting.", ...seasons);
      sources.push(worldCerealCalendarSource);
    } else {
      const localSowing = easternWheatbeltSowing([lon, lat]);
      if (localSowing) {
        lines.push(`Regional crop to investigate · ${localSowing.guidance}`);
        sources.push(localSowing.source);
      }
    }
  }
  if (establishedCropland) for (const { first, next, year, point, sites } of candidates) {
    if (choices.length >= 5) break;
    const covered = choices.some(choice => {
      const keys = choice.crops.map(cropKey);
      if (choice.recurring) keys.push(keys[0]);
      return keys.some((key, index) => key === cropKey(first) && keys[index + 1] === cropKey(next));
    });
    if (!covered) choices.push({ crops: [first, next], point,
      why: `Mapped in consecutive years at ${sites} of ${points.length} sampled points, most recently ${year - 1}–${year}. A recurring cycle remains unverified.` });
  }
  const lastTwo = farmerHistory.slice(-2);
  if (choices.length < 5 && lastTwo.length === 2 && lastTwo[1].year === lastTwo[0].year + 1 &&
      cropKey(lastTwo[0].crop) !== cropKey(lastTwo[1].crop)) {
    const crops = lastTwo.map(row => row.crop);
    const keys = crops.map(cropKey).join("|");
    if (!choices.some(choice => choice.recurring || choice.crops.map(cropKey).join("|") === keys)) {
      choices.push({ crops, point: [lon, lat],
        why: `The farmer supplied this sequence for ${lastTwo[0].year}–${lastTwo[1].year}. A recurring cycle remains unverified.` });
    }
  }
  if (!choices.length && establishedCropland) {
    if (samples.length) lines.push("The sampled histories showed no consecutive-year change between supported annual crops.");
    if ([...latest.keys()].some(crop => /wetlands|water|forest|developed/i.test(crop))) {
      lines.push("Wetland, water, forest, and developed classes describe land cover. Draw around a single cultivated field to check its own history.");
    }
    if ([...latest.keys()].some(crop => /citrus|almonds|walnuts|pistachios|orchard|grapes|tree crops/i.test(crop))) {
      lines.push("Orchard crops can occupy a field for years. Confirm which trees are present before evaluating an alley cover crop or a replacement planting.");
    } else if (![...latest.keys()].some(crop => /wetlands|water|forest|developed/i.test(crop))) {
      lines.push("For confirmed cropland, compare a cereal or grass cover for erosion control with a locally adapted legume cover for nitrogen contribution. Both can use water before the next crop. Compare growing windows, termination options, and the following crop’s water needs before trying a small strip.");
      sources.push({ title: "SARE cover crop selection and trade-offs", url: "https://www.sare.org/publications/cover-crop-book/selecting-cover-crop-species-and-mixes/" });
    }
  }
  lines.push(choices.length
    ? `Crop combinations to assess · showing ${choices.length} of up to 5. Ranked by historical evidence for the selection. Yield and profit have not been verified for these options.`
    : "Crop combinations to assess · no field-level combination has enough records. Enter the crops previously grown in Add farm details to supplement the inventory.");
  if (focusChoice && focusChoice > choices.length) lines.push(`Option ${focusChoice} is unavailable for this selection.`);
  for (const [index, choice] of choices.entries()) {
    if (focusChoice && focusChoice <= choices.length && index + 1 !== focusChoice) continue;
    const { risks, outcomes } = combinationTradeoffs(choice.crops, choice.doubleCrop, choice.recurring);
    lines.push(`${index + 1}. ${choice.crops.join(" → ")}`, `Why this option · ${choice.why}`);
    await addPlantingWindows(choice.crops, choice.point, choice.doubleCrop);
    const flyRisk = choice.doubleCrop && sources.some(source => source.url.includes("management-strategies-for-hessian-fly"))
      ? " Clemson advises against repeating the pairing where Hessian fly is a concern." : "";
    lines.push(`Risks · ${risks}${flyRisk}`, `Possible outcomes · ${outcomes}`);
  }
  if (choices.length) {
    sources.push({ title: "UMN Extension · rotation effects", url: smallGrains });
    if (choices.some(choice => choice.crops.map(cropKey).includes("alfalfa"))) {
      sources.push({ title: "UMN Extension · alfalfa before corn", url: alfalfa });
    }
  }
  return { answer: lines.join("\n\n"), sources };
}

