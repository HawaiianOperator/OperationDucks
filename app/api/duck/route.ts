import { explain, readSelection } from "../../worldview";
import { soilAdvice } from "../../soil";
import { rotationOptions } from "../../rotation-options";
import { farmGuide } from "../../duck-farm-guide";
import { nasaAnswer } from "../../duck-nasa";
import { plotHectares, readPlotBoundary, samplePlot, type Point } from "../../plot-geometry";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.question !== "string" || !body.question.trim() || body.question.length > 1000) {
    return Response.json({ error: "Enter a question of up to 1,000 characters." }, { status: 400 });
  }
  const farmNotes = typeof body.farmNotes === "string" ? body.farmNotes.trim().slice(0, 1000) : "";
  const scope = typeof body.scope === "string" ? body.scope.trim().slice(0, 160) : "";
  const rotation = /\b(rotations?|rotate (?:my )?crops?|crop cycles?|crop combinations?|crop sequence|crop history|CSB)\b/i.test(body.question);
  const moisture = /\b(?:soil moisture|soil wetness|SMAP)\b/i.test(body.question);
  const decision = /\b(?:decid\w*|determin\w*|choos\w*|pick\w*|rank\w*|based on|should.*use)\b/i.test(body.question);
  if (rotation && moisture && decision) return Response.json({
    answer: "NASA soil moisture describes field conditions. Duck ranks crop rotations using agricultural evidence such as verified crop history for your field, local planting windows and trials, and your priorities and water constraints.",
  });
  if ((rotation || /\b(?:recommended|this) sequence\b/i.test(body.question)) &&
    /\b(?:harvest|yield|profit)\b/i.test(body.question) &&
    /\b(?:guarantee\w*|definitel\w*|certain\w*|promise\w*|always)\b/i.test(body.question)) return Response.json({
    answer: "No. A crop rotation cannot guarantee a higher harvest. Yield depends on variety, field conditions, weather, and management. Compare measured yields from the field or comparable local trials.",
  });
  const options = /\b(best|options?|suggest\w*|recommend\w*|what\s+(?:can|should|could)\s+i\s+plant)\b/i.test(body.question);
  const plantingOptions =
    /\bwhat\s+(?:(?:can|should|could)\s+i\s+(?:plant|grow)|to\s+(?:plant|grow)|(?:crops?\s+)?(?:grows?|can\s+grow))\b/i.test(body.question) ||
    /\b(?:(?:options?|crops?|vegetables?)\s+(?:to\s+(?:plant|grow)|for\s+(?:planting|growing))|best\s+(?:crops?|vegetables?)\s+(?:here|for this (?:plot|field))|(?:recommend|suggest)\s+(?:some\s+)?crops?)\b/i.test(body.question);
  const explicitThresholds = /\b(?:days|min_c|min_mm)\s*=/i.test(body.question);
  const choiceNumber = body.fieldSelected === true && !scope
    ? Number(body.question.match(/\b(?:rotation option|crop combination|option|choice)\s*#?\s*([1-5])\b/i)?.[1]) || undefined
    : undefined;
  const plotTiming = /\b(?:when\s+(?:can|should|could|do)\s+i\s+(?:plant|sow|seed)(?:\s+(?:here|this field|this plot))?(?=[?.!]|$)|(?:which|what)\s+season\s+(?:can|should|could|do)\s+i\s+plant)\b/i.test(body.question);
  const plotPlantingOptions = body.fieldSelected === true && !scope && !explicitThresholds && (plantingOptions || plotTiming);
  const carryover = /\b(carryover|carry-over|first crop|previous crop|preceding crop)\b/i.test(body.question) &&
    /\b(soil|effect|affect\w*|follow\w*|depend\w*)\b/i.test(body.question);
  const asksForRotation = (rotation && (options || /\b(?:when|seasons?|planting windows?|crop cycles?|crop combinations?)\b/i.test(body.question))) || carryover ||
    /\b(?:plan|design|compare|propose)\b.*\b(?:crop )?rotations?\b/i.test(body.question);
  if (asksForRotation || plotPlantingOptions || choiceNumber) {
    if (scope) return Response.json({ error: "Select a plot on the map to compare crop rotations for that field." }, { status: 400 });
    const [lon, lat] = Array.isArray(body.center) ? body.center : [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return Response.json({ error: "Select a valid plot to compare crop rotations." }, { status: 400 });
    }
    const center: Point = [lon, lat];
    const boundary = readPlotBoundary(body.boundary);
    if (body.boundary !== undefined && !boundary) {
      return Response.json({ error: "Draw a valid field boundary to check the selected area." }, { status: 400 });
    }
    const samples: Point[] = boundary ? samplePlot(center, boundary) : Array.isArray(body.samples)
      ? body.samples.slice(0, 9).filter((item: unknown) => Array.isArray(item) && item.length === 2 &&
        Number.isFinite(item[0]) && Math.abs(item[0]) <= 180 && Number.isFinite(item[1]) && Math.abs(item[1]) <= 90)
      : [];
    const hectares = boundary ? plotHectares(center, boundary) : 0;
    if (boundary && (!samples.length || hectares <= 0)) {
      return Response.json({ error: "Draw a field boundary with a measurable area." }, { status: 400 });
    }
    const location = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const areaSummary = boundary
      ? `Selected area: ${hectares.toLocaleString("en-US", { maximumFractionDigits: 3 })} ha · center ${location} (latitude, longitude).`
      : `Location evaluated: ${location} (latitude, longitude).`;
    return Response.json(await rotationOptions(samples.length ? samples : [center], center, farmNotes, areaSummary, boundary ?? undefined, choiceNumber),
      { headers: { "Cache-Control": "no-store" } });
  }
  const introduction = farmGuide(body.question, farmNotes);
  if (introduction && !(body.fieldSelected && plantingOptions)) return Response.json(introduction);
  try {
    const nasa = await nasaAnswer(body.question, body.center, scope, farmNotes, body.radiusMeters);
    if (nasa) return Response.json(nasa, { status: "error" in nasa ? 400 : 200 });
  } catch {
    return Response.json({ error: "Duck could not complete the NASA lookup. Check the place and try again." }, { status: 502 });
  }
  if (!(typeof body.scope === "string" && body.scope.trim()) && (rotation || /\b(soil pH|soil health|sustainab\w*)\b/i.test(body.question))) {
    return Response.json(await soilAdvice(body.center, rotation));
  }
  if (body.dataset) {
    const selected = readSelection(body.dataset);
    const { place, hectares } = body.dataset;
    if (!selected || typeof place !== "string" || place.length > 200 || typeof hectares !== "number" || !Number.isFinite(hectares) || hectares <= 0) {
      return Response.json({ error: "Choose a valid field and Worldview dataset." }, { status: 400 });
    }
    return Response.json(explain(body.question, { ...selected, place, hectares }));
  }
  const remoteUrl = process.env.DUCK_API_URL?.trim();
  const localUrl = "http://127.0.0.1:8765/ask";
  const payload = JSON.stringify({ question: body.question, scope: body.scope, center: body.center });
  for (const endpoint of [...new Set([remoteUrl, localUrl].filter((url): url is string => Boolean(url)))]) {
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: payload,
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (data && (typeof data.answer === "string" || typeof data.error === "string")) {
        if (typeof data.answer === "string" && data.answer.startsWith("Which dataset or variable should I look up?")) {
          return Response.json(farmGuide(body.question, farmNotes, true) ?? {
            answer: "I can help with starting a farm, finding land, choosing crops, irrigation, and checking field conditions. Tell me what you’re trying to do and what you already know about the site.",
          });
        }
        return Response.json(data, { status: response.status });
      }
    } catch {
      // A failed connection or non-JSON gateway response can be retried using the local worker.
    }
  }
  const guidance = farmGuide(body.question, farmNotes, true);
  if (guidance) return Response.json(guidance);
  return Response.json({ error: "Duck’s model service is unavailable. Try again once the worker is running." }, { status: 503 });
}
