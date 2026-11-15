"""Resolve publisher requests in memory and serve answers to the local dashboard."""

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import mean
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from duck_router import MODEL_PATH, load, predict

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
PRODUCTS = {
    "smap": ("SMAP soil moisture", ("SPL4SMGP",)),
    "gpm": ("GPM IMERG Early precipitation", ("GPM_3IMERGHHE",)),
    "landsat": ("Harmonized Landsat vegetation reflectance", ("HLSL30",)),
    "ecostress": ("ECOSTRESS surface temperature", ("ECO_L2T_LSTE",)),
    "modis": ("MODIS vegetation and land surface temperature", ("MOD13Q1", "MOD11A1")),
    "emit": ("EMIT hyperspectral reflectance", ("EMITL2ARFL",)),
}
PUBLISHERS = {
    "agriculture": (
        ("FAOSTAT land use", "https://www.fao.org/faostat/en/#data/RL"),
        ("MapSPAM 2020 crop area", "https://doi.org/10.7910/DVN/SWPENT"),
        ("WorldCereal", "https://esa-worldcereal.org/"),
        ("Fields of The World polygons", "https://source.coop/ftw/global-data"),
    ),
    "fire": (("NASA FIRMS web map", "https://firms.modaps.eosdis.nasa.gov/map/"),
             ("NASA FIRMS API", "https://firms.modaps.eosdis.nasa.gov/api/")),
}


def request_json(url):
    with urlopen(Request(url, headers={"User-Agent": "OperationDucks/1.0", "Accept": "application/json"}), timeout=12) as response:
        return json.load(response)


def source(title, url):
    return {"title": title, "url": url}


def coordinate_pair(values):
    if isinstance(values, list) and len(values) == 2:
        lon, lat = values
        if type(lon) in (int, float) and type(lat) in (int, float) and -180 <= lon <= 180 and -90 <= lat <= 90:
            return lon, lat
    raise ValueError("Enter a valid longitude and latitude or select a map location.")


def location(scope, center):
    if scope.casefold() in {"worldwide", "global", "world"}:
        return "worldwide", None, None
    if not scope:
        point = coordinate_pair(center)
        return f"map center ({point[1]:.4f}, {point[0]:.4f})", point, None
    if re.fullmatch(r"\s*[-+\d.]+\s*,\s*[-+\d.]+\s*", scope):
        lat, lon = map(float, scope.split(","))
        return f"{lat:.4f}, {lon:.4f}", coordinate_pair([lon, lat]), None
    results = request_json("https://photon.komoot.io/api/?" + urlencode({"limit": 1, "q": scope}))
    if not results["features"]:
        raise ValueError("No place match. Enter a more specific place or latitude, longitude.")
    feature = results["features"][0]
    props = feature["properties"]
    place = ", ".join(dict.fromkeys(props[k] for k in ("name", "state", "country") if props.get(k))) or scope
    extent = props.get("extent")
    bounds = None
    if extent and len(extent) == 4 and extent[0] <= extent[2]:
        bounds = (extent[0], min(extent[1], extent[3]), extent[2], max(extent[1], extent[3]))
    return place, coordinate_pair(feature["geometry"]["coordinates"]), bounds


def dates(question):
    today = date.today()
    explicit = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", question)
    if explicit:
        start = date.fromisoformat(explicit[0])
        end = date.fromisoformat(explicit[-1])
    else:
        years = re.findall(r"\b(?:19|20)\d{2}\b", question)
        if years:
            start = date(int(years[0]), 1, 1)
            end = min(date(int(years[-1]), 12, 31), today)
        else:
            start, end = today - timedelta(days=29), today
    if start > end or end > today:
        raise ValueError("Enter an observation date or range ending today or earlier.")
    return start, end


def power_url(point, start, end, codes):
    lon, lat = point
    return POWER + "?" + urlencode({"parameters": ",".join(codes), "community": "AG",
                                   "longitude": lon, "latitude": lat, "start": start.strftime("%Y%m%d"),
                                   "end": end.strftime("%Y%m%d"), "format": "JSON", "time-standard": "UTC"})


def weather(place, point, start, end):
    if point is None:
        raise ValueError("NASA POWER needs a point. Choose a place or use the map center.")
    if (end - start).days > 366:
        raise ValueError("Request up to one year per NASA POWER point query.")
    codes = {"T2M": "Air temperature", "PRECTOTCORR": "Corrected precipitation",
             "ALLSKY_SFC_SW_DWN": "Surface solar radiation"}
    lon, lat = point
    url = power_url(point, start, end, codes)
    data = request_json(url)
    missing = data["header"]["fill_value"]
    report = [f"NASA POWER daily grid-cell summary at {place} ({lat:.4f}, {lon:.4f}), {start} to {end} UTC."]
    for code, title in codes.items():
        series = data["properties"]["parameter"][code]
        valid = sorted((day, value) for day, value in series.items() if value is not None and value != missing)
        if not valid:
            report.append(f"{title}: no published values in this window.")
            continue
        unit = data["parameters"][code]["units"]
        last_day = date.fromisoformat(valid[-1][0])
        report.append(f"{title}: mean {mean(value for _, value in valid):.2f} {unit} "
                      f"across {len(valid)} days, last available {last_day}.")
    return {"answer": "\n".join(report), "sources": [source("NASA POWER query", url)]}


def planting(question, scope, center):
    days = re.search(r"\bdays\s*=\s*(\d{1,3})\b", question, re.I)
    temperature = re.search(r"\bmin_c\s*=\s*(-?\d+(?:\.\d+)?)\b", question, re.I)
    rain = re.search(r"\bmin_mm\s*=\s*(\d+(?:\.\d+)?)\b", question, re.I)
    windows = list(dict.fromkeys(re.findall(r"(?<![\d-])\b(\d{2}-\d{2})\b(?![\d-])", question)))
    if not (days and temperature and rain and len(windows) <= 4):
        return {"answer": "To screen planting options, give Duck the crop's establishment period and thresholds. "
                "Example syntax: Compare planting days=14 min_c=10 min_mm=25. Enter up to three candidate "
                "places separated by semicolons. Add up to four MM-DD dates to test specific starts. "
                "Use thresholds for your crop and variety. The example numbers only illustrate the input format.",
                "sources": [source("FAO Global Agro-Ecological Zones", "https://www.fao.org/gaez/en")]}
    length, min_temp, min_rain = int(days[1]), float(temperature[1]), float(rain[1])
    if not 1 <= length <= 60 or not -40 <= min_temp <= 50 or not 0 <= min_rain <= 3000:
        raise ValueError("Use 1–60 days, min_c between −40 and 50, and min_mm between 0 and 3000.")
    seasons = ([date.fromisoformat(f"2001-{window}") for window in windows] if windows else
               [date(2001, month, day) for month in range(1, 13) for day in (1, 15)])
    year = date.today().year
    years = range(year - 6, year - 1)
    candidates = [part.strip() for part in scope.split(";")]
    if len(candidates) > 3 or (len(candidates) > 1 and not all(candidates)):
        raise ValueError("Enter up to three candidate places separated by semicolons.")

    def compare(candidate):
        place, point, _ = location(candidate, center)
        if point is None:
            raise ValueError("Planting comparisons require specific locations.")
        start = date(years.start, 1, 1)
        end = date(years[-1], 12, 31) + timedelta(days=length - 1)
        url = power_url(point, start, end, ("T2M_MIN", "PRECTOTCORR"))
        data = request_json(url)
        params = data["properties"]["parameter"]
        fill = data["header"]["fill_value"]
        results = []
        lon, lat = point
        site = f"{place} [query point {lat:.4f}, {lon:.4f}]"
        for season in seasons:
            passed, complete = 0, 0
            for historical_year in years:
                first_day = season.replace(year=historical_year)
                keys = [(first_day + timedelta(days=offset)).strftime("%Y%m%d") for offset in range(length)]
                temps = [params["T2M_MIN"].get(key, fill) for key in keys]
                rains = [params["PRECTOTCORR"].get(key, fill) for key in keys]
                if any(value is None or value == fill for value in temps + rains):
                    continue
                complete += 1
                passed += min(temps) >= min_temp and sum(rains) >= min_rain
            results.append((passed, complete, site, season.strftime("%m-%d")))
        return results, source(f"NASA POWER historical grid cell for {place}", url)

    with ThreadPoolExecutor(max_workers=3) as pool:
        comparisons = list(pool.map(compare, candidates))
    def rank(row):
        return row[1] == len(years), row[0]

    rows = []
    unmatched = []
    for results, _ in comparisons:
        if windows:
            rows.extend(results)
            continue
        qualified = [row for row in results if row[0] > 0]
        rows.extend(sorted(qualified, key=rank, reverse=True)[:2])
        if not qualified:
            if all(row[1] == len(years) for row in results):
                unmatched.append(f"{results[0][2]}: no tested date met both thresholds in any of the five years.")
            else:
                unmatched.append(f"{results[0][2]}: no passing date found among available years. Coverage was incomplete.")
    rows.sort(key=rank, reverse=True)
    lines = [f"Historical establishment screen using planting years {years[0]}–{years[-1]}. "
             f"Each {length}-day window must stay at or above {min_temp:g} °C every night and receive "
             f"at least {min_rain:g} mm total rain."]
    if not windows:
        lines.append("Tested the 1st and 15th of each month. Showing up to two passing dates per location.")
    for passed, complete, place, window in rows:
        coverage = "" if complete == len(years) else " · incomplete coverage"
        lines.append(f"{place}, {window}: passed {passed} of {complete} complete years{coverage}.")
    lines.extend(unmatched)
    lines.append("This ranks the supplied options by historical weather. Field soil, irrigation, seed variety, "
                 "and the upcoming forecast still need to be checked before choosing when to plant.")
    return {"answer": "\n".join(lines), "sources": [item for _, item in comparisons]}


def granules(intent, place, point, bounds, start, end):
    title, products = PRODUCTS[intent]
    lines = [f"{title} for {place}, {start} to {end}. Latest catalog matches by observation start time."]
    sources = []
    for product in products:
        query = {"short_name": product, "page_size": 3, "sort_key": "-start_date",
                 "temporal": f"{start}T00:00:00Z,{end}T23:59:59Z"}
        if bounds:
            query["bounding_box"] = ",".join(map(str, bounds))
        elif point:
            query["point"] = ",".join(map(str, point))
        url = CMR + "?" + urlencode(query)
        rows = request_json(url)["feed"]["entry"]
        observations = [f"{row.get('time_start', 'Time unavailable')} · {row['title']}" for row in rows]
        lines.append(f"{product}: " + ("; ".join(observations) if observations else "no matching records."))
        sources.append(source(f"NASA Earthdata search for {product}", url))
    lines.append("These are scene records. Pixel values and quality flags require reading the science assets.")
    return {"answer": "\n".join(lines), "sources": sources}


def boundaries(place, iso, level):
    code = iso.upper() if iso else "ALL"
    url = f"https://www.geoboundaries.org/api/current/gbOpen/{code}/{level}/"
    try:
        data = request_json(url)
    except HTTPError as error:
        if error.code != 404:
            raise
        data = []
    rows = data if isinstance(data, list) else [data]
    matches = [row for row in rows if row.get("boundaryID")]
    links = [source("geoBoundaries catalog response", url)]
    if len(matches) == 1:
        row = matches[0]
        geometry = row.get("gjDownloadURL", "")
        if urlsplit(geometry).scheme == "https":
            links.append(source(f"{row['boundaryName']} GeoJSON", geometry))
    return {"answer": f"geoBoundaries lists {len(matches)} {level} releases for {place}. "
            "A release may contain multiple administrative units.", "sources": links}


def ask(model, body):
    question = body.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > 1000:
        raise ValueError("Enter a question of up to 1,000 characters.")
    intent, score = predict(model, question)
    if intent == "unknown" or score < 0.65:
        return {"answer": "Which dataset or variable should I look up? Try soil moisture, Landsat NDVI, "
                "NASA POWER rainfall, MODIS, FIRMS, or administrative boundaries."}
    if intent in PUBLISHERS:
        return {"answer": "These publisher pages provide access to the requested data. "
                "On-demand observations and statistics for this source are not available in Duck yet.",
                "sources": [source(*item) for item in PUBLISHERS[intent]]}
    scope = body.get("scope", "")
    if not isinstance(scope, str) or len(scope) > 160:
        raise ValueError("Enter a place name of up to 160 characters.")
    scope = scope.strip()
    if intent == "planting":
        return planting(question, scope, body.get("center"))
    if intent == "boundaries":
        level = re.search(r"\badm([0-5])\b", question, re.I)
        tier = level[1] if level else ("2" if re.search(r"\b(count(?:y|ies)|districts?)\b", question, re.I)
                                      else "1" if re.search(r"\b(states?|provinces?)\b", question, re.I) else "0")
        if re.fullmatch(r"[A-Za-z]{3}", scope) and scope.casefold() != "all":
            return boundaries(scope.upper(), scope, f"ADM{tier}")
        if scope.casefold() in {"worldwide", "global", "world"}:
            return boundaries("worldwide", None, f"ADM{tier}")
        raise ValueError("For administrative boundaries, enter Worldwide or a three-letter ISO country code in Place.")
    place, point, bounds = location(scope, body.get("center"))
    start, end = dates(question)
    if intent == "power":
        return weather(place, point, start, end)
    return granules(intent, place, point, bounds, start, end)


def load_chat(adapter_path):
    import torch
    from peft import PeftConfig, PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        raise RuntimeError("Duck chat requires a CUDA-enabled Python environment.")
    config = PeftConfig.from_pretrained(adapter_path)
    report = json.loads((adapter_path.parent / "training-report.json").read_text(encoding="utf-8"))
    if report["base_model"] != config.base_model_name_or_path:
        raise ValueError("The adapter and training report name different base models.")
    tokenizer = AutoTokenizer.from_pretrained(adapter_path)
    base = AutoModelForCausalLM.from_pretrained(config.base_model_name_or_path,
                                               revision=report.get("base_revision"))
    model = PeftModel.from_pretrained(base.to("cuda", dtype=torch.bfloat16), adapter_path).eval()
    lock = Lock()

    def reply(question):
        rotation = re.search(r"\b(?:rotations?|crop sequences?|crop cycles?)\b", question, re.I)
        moisture = re.search(r"\b(?:soil moisture|soil wetness|SMAP)\b", question, re.I)
        outcome = re.search(r"\b(?:harvest|yield|profit)\b", question, re.I)
        certainty = re.search(r"\b(?:guarantee\w*|definitel\w*|certain\w*|promise\w*|always)\b", question, re.I)
        rotation_decision = re.search(r"\b(?:decid\w*|determin\w*|choos\w*|pick\w*|rank\w*|based on|should.*use)\b", question, re.I)
        if rotation and moisture and rotation_decision:
            return {"answer": "NASA soil moisture helps describe field conditions, such as how wet the root zone is. "
                    "Duck uses agricultural evidence to rank crop rotations, including verified crop history "
                    "on the selected field, local planting windows and trials, and your priorities and water constraints."}
        if rotation and outcome and certainty:
            return {"answer": "No. A crop rotation cannot guarantee a higher harvest. Yield depends on crop variety, "
                    "field conditions, weather, and management. Compare measured yields from your own field or "
                    "local trials with similar soil and management before estimating a benefit."}
        prompt = tokenizer.apply_chat_template([
            {"role": "system", "content": "You are Duck, an agricultural decision-support assistant. "
             "Answer plainly. Ask for missing farm details. Never invent a crop, date, or measurement for a plot."},
            {"role": "user", "content": question},
        ], tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False).to("cuda")
        with lock, torch.inference_mode():
            output = model.generate(**inputs, max_new_tokens=140, do_sample=False,
                                    pad_token_id=tokenizer.eos_token_id)
        answer = tokenizer.decode(output[0, inputs.input_ids.shape[1]:], skip_special_tokens=True).strip()
        return {"answer": answer, "model": config.base_model_name_or_path, "adapter": adapter_path.parent.name,
                "response_type": "generated"}

    return reply


def serve(model, port=8765, chat=None):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path != "/ask":
                self.send_error(404)
                return
            status = 200
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= 8192:
                    raise ValueError("Request size is invalid.")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("Expected a JSON object.")
                greeting = isinstance(body.get("question"), str) and re.fullmatch(
                    r"\s*(?:hello|hi|hey)(?: duck)?[!.?\s]*", body["question"], re.I)
                if chat and (body.get("mode") == "chat" or greeting):
                    question = body.get("question")
                    if not isinstance(question, str) or not question.strip() or len(question) > 1000:
                        raise ValueError("Enter a question of up to 1,000 characters.")
                    result = chat(question)
                else:
                    result = ask(model, body)
            except ValueError as error:
                status, result = 400, {"error": str(error)}
            except (URLError, TimeoutError, KeyError, TypeError):
                status, result = 502, {"error": "The publisher could not return data for this query. Check the place and dates, then retry."}
            payload = json.dumps(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--chat-adapter", type=Path)
    args = parser.parse_args()
    if not MODEL_PATH.is_file():
        parser.error("Train Duck.ipynb and copy the exported router.pt here.")
    chat = load_chat(args.chat_adapter.resolve()) if args.chat_adapter else None
    with serve(load(), args.port, chat) as server:
        print(f"Duck is listening on http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()
