"""Refresh public agriculture discovery results for Duck."""

import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
import io
import json
import math
import re
from pathlib import Path
from statistics import mean
import time
from collections import defaultdict
import urllib.parse
import urllib.request


ARCHIVE = "https://entrepot.recherche.data.gouv.fr/api/search?"
ZENODO = "https://zenodo.org/api/records?"
DATACITE = "https://api.datacite.org/dois?"
FIGSHARE = "https://api.figshare.com/v2/articles/search"
PROVIDERS = ("Dataverse", "Zenodo", "Figshare", "DataCite")
QUERIES = {
    "Brazil": 'Brazil AND (soybean OR maize) AND ("crop rotation" OR yield)',
    "Kenya": 'Kenya AND maize AND ("crop rotation" OR yield)',
    "India": 'India AND (rice OR wheat) AND ("crop rotation" OR yield)',
    "Western Australia": '"Western Australia" AND (wheat OR canola) AND ("crop rotation" OR yield)',
    "France": '(France OR Kerbernez) AND (forage OR wheat) AND ("crop rotation" OR yield)',
    "Europe": '"EuroCrops" OR "crop parcel" AND "crop type"',
    "Global": '"crop rotation" AND ("field trial" OR "crop type" OR "crop yield")',
}
FIGSHARE_TERMS = {
    "Brazil": "Brazil soybean crop rotation",
    "Kenya": "Kenya maize crop type",
    "India": "paddy rice India",
    "Western Australia": "Western Australia paddock crop",
    "France": "France wheat crop rotation",
    "Europe": "EuroCrops parcel crop",
    "Global": "crop rotation field trial yield",
}
OUTPUT = Path(__file__).resolve().parent / ".duck-model" / "agriculture-discovery.json"
PLOTS = {
    "South Carolina": (-79.93489, 33.56829, 1566),
    "Brazil": (-55.886, -13.044, 350),
    "France": (1.493, 48.278, 350),
    "Kenya": (35.207, 0.570, 350),
    "India": (75.756, 30.888, 350),
    "Western Australia": (118.564, -31.698, 350),
}


def search(provider, region):
    query = QUERIES[region]
    headers = {"Accept": "application/json"}
    body = None
    if provider == "Dataverse":
        url = ARCHIVE + urllib.parse.urlencode({"q": query, "type": "dataset", "per_page": 5})
    elif provider == "Zenodo":
        url = ZENODO + urllib.parse.urlencode({"q": f"({query}) AND access_right:open", "type": "dataset", "size": 5})
    elif provider == "Figshare":
        url = FIGSHARE
        headers["Content-Type"] = "application/json"
        body = json.dumps({"search_for": FIGSHARE_TERMS[region], "item_type": 3, "limit": 5}).encode()
    else:
        url = DATACITE + urllib.parse.urlencode({
            "query": f"({query}) AND types.resourceTypeGeneral:Dataset", "page[size]": 5,
        })
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.load(response)
    if provider == "Zenodo":
        return [
            {"title": item["metadata"]["title"], "url": f"https://zenodo.org/records/{item['id']}",
             "id": str(item["id"]), "doi": item["metadata"].get("doi")}
            for item in payload["hits"]["hits"]
        ]
    if provider == "Figshare":
        return [{"title": item["title"], "url": item["url_public_html"], "id": str(item["id"]), "doi": item.get("doi")}
                for item in payload]
    if provider == "DataCite":
        return [{"title": item["attributes"]["titles"][0]["title"], "url": f"https://doi.org/{item['id']}",
                 "id": item["id"], "doi": item["id"]}
                for item in payload["data"] if item["attributes"].get("titles")]
    return [
        {"title": item["name"], "url": item["url"], "id": item["global_id"], "doi": item["global_id"]}
        for item in payload["data"]["items"]
    ]


def check_yields(file_id, previous):
    url = f"https://entrepot.recherche.data.gouv.fr/api/access/datafile/{file_id}"
    with urllib.request.urlopen(url, timeout=12) as response:
        contents = response.read(2_000_001)
    if len(contents) > 2_000_000:
        raise ValueError("Unexpected yield-table size")
    fingerprint = hashlib.sha256(contents).hexdigest()
    if previous.get("sha256") == fingerprint and "evaluation" in previous:
        return {key: value for key, value in previous.items() if key != "error"}
    table = csv.DictReader(io.StringIO(contents.decode("utf-8-sig")), delimiter="\t")
    if not {"rotation", "date", "crop", "avg_DM_yield"}.issubset(table.fieldnames or []):
        raise ValueError("Unexpected yield-table schema")
    rows = []
    for row in table:
        year = dt.date.fromisoformat(row["date"])
        value = float(row["avg_DM_yield"])
        if not row["rotation"] or not row["crop"] or not math.isfinite(value) or value < 0:
            raise ValueError("Missing or invalid crop, rotation or yield")
        group = (row["crop"], year.month) if file_id == 348295 else (row["crop"],)
        rows.append((year.year, group, row["rotation"], value))
    years = sorted({year for year, *_ in rows})
    if len(years) <= 5:
        raise ValueError("Insufficient years for the chronological split")
    split = years[-5]
    baseline, rotation = defaultdict(list), defaultdict(list)
    for year, group, treatment, value in rows:
        if year < split:
            baseline[group].append(value)
            rotation[group, treatment].append(value)
    test = [(group, treatment, value) for year, group, treatment, value in rows if year >= split]
    errors = [(abs(value - mean(baseline[group])), abs(value - mean(rotation[group, treatment])), value)
              for group, treatment, value in test if (group, treatment) in rotation]
    return {"url": url, "sha256": fingerprint, "yield_rows": len(rows), "evaluation": {
        "site": "Kerbernez", "test_years": years[-5:], "held_out": len(test), "scored": len(errors),
        "baseline_mae": mean(base for base, _, _ in errors) if errors else None,
        "rotation_mae": mean(error for _, error, _ in errors) if errors else None,
        "within_10_percent": sum(error <= value * 0.10 for _, error, value in errors),
    }}


def check_plot(plot):
    lon, lat, radius = plot
    boundary = []
    for index in range(32):
        angle = index * math.tau / 32
        boundary.append([lon + radius * math.cos(angle) / (111195 * math.cos(math.radians(lat))),
                         lat + radius * math.sin(angle) / 111195])
    request = urllib.request.Request("http://127.0.0.1:3000/api/duck",
        data=json.dumps({"question": "Show crop combinations", "fieldSelected": True,
                         "center": [lon, lat], "boundary": boundary}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=35) as response:
        answer = json.load(response)["answer"]
    counts = {}
    for key, label in (("crop_history", "Crop-history coverage"), ("usable_crop_labels", "Supported rotation crop labels")):
        match = re.search(rf"^{label}: (\d+) of (\d+) points", answer, re.M)
        if not match:
            raise ValueError(f"Duck did not report {label.lower()}")
        counts[key] = {"matched": int(match[1]), "sampled": int(match[2])}
    support = re.search(r"^(?:Cycle support: [\d.]+% \(|Historical cycle at )(\d+) of (\d+)", answer, re.M)
    counts["recurring_rotation_support"] = {
        "matched": int(support[1]) if support else 0, "sampled": counts["crop_history"]["sampled"],
    }
    evidence = [line for line in answer.splitlines() if line.startswith((
        "Crop-history coverage:", "Supported rotation crop labels:", "Cycle support:", "Historical cycle at", "Some years"))]
    return {"evidence": evidence, **counts}


def summarize_fields(fields):
    checked = [item for item in fields.values() if "recurring_rotation_support" in item and "error" not in item]
    summary = {"checked_fields": len(checked), "total_fields": len(PLOTS)}
    for key in ("crop_history", "usable_crop_labels", "recurring_rotation_support"):
        matched = sum(item[key]["matched"] for item in checked)
        sampled = sum(item[key]["sampled"] for item in checked)
        summary[key] = {"matched": matched, "sampled": sampled, "percent": round(100 * matched / sampled, 1) if sampled else None}
    return summary


def refresh(previous, scan_plots):
    checked = dt.datetime.now(dt.timezone.utc).isoformat()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        sources = {name: pool.submit(check_yields, file_id, previous.get("verified_sources", {}).get(name, {})) for name, file_id in
                   {"Kerbernez maize": 348298, "Kerbernez grassland": 348295}.items()}
        jobs = {(region, provider): pool.submit(search, provider, region)
                for region in QUERIES for provider in PROVIDERS}
        regions = {}
        for (region, provider), job in jobs.items():
            regions.setdefault(region, {})
            try:
                regions[region][provider] = {"checked_at": checked, "candidates": job.result()}
            except (OSError, ValueError, KeyError) as exc:
                cached = previous.get("regions", {}).get(region, {}).get(provider, {"candidates": []})
                regions[region][provider] = {**cached, "error": str(exc)}
        verified_sources = {}
        for name, job in sources.items():
            try:
                verified_sources[name] = job.result()
            except (OSError, ValueError, KeyError) as exc:
                verified_sources[name] = {**previous.get("verified_sources", {}).get(name, {}), "error": str(exc)}
        field_coverage = previous.get("field_coverage", {})
        if scan_plots:
            for region, job in [(region, pool.submit(check_plot, plot)) for region, plot in PLOTS.items()]:
                try:
                    field_coverage[region] = {"checked_at": checked, **job.result()}
                except (OSError, ValueError, KeyError) as exc:
                    field_coverage[region] = {**field_coverage.get(region, {}), "error": str(exc)}
    candidate_pool = {}
    for region, providers in regions.items():
        for provider, item in providers.items():
            for candidate in item["candidates"]:
                doi = (candidate.get("doi") or "").lower().removeprefix("doi:").removeprefix("https://doi.org/")
                key = doi if doi.startswith("10.") else candidate["url"]
                entry = candidate_pool.setdefault(key, {**candidate, "regions": [], "repositories": []})
                if region not in entry["regions"]:
                    entry["regions"].append(region)
                if provider not in entry["repositories"]:
                    entry["repositories"].append(provider)
    report = {"checked_at": checked, "regions": regions, "candidate_pool": list(candidate_pool.values()),
              "verified_sources": verified_sources, "field_coverage": field_coverage,
              "field_coverage_summary": summarize_fields(field_coverage)}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".next.tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"{checked} " + ", ".join(
        f"{region}: " + "/".join(f"{provider}={'error' if 'error' in item else len(item['candidates'])}"
                                for provider, item in results.items())
        for region, results in regions.items()
    ), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--minutes", type=int, default=720)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.minutes < 1:
        parser.error("--minutes must be positive")
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        previous = {}
    start = time.monotonic()
    for minute in range(1 if args.once else args.minutes):
        time.sleep(max(0, start + 60 * minute - time.monotonic()))
        previous = refresh(previous, scan_plots=minute % 10 == 0)


if __name__ == "__main__":
    main()
