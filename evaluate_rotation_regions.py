"""Compare crop history, field size, and geographic training coverage."""

from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math

from evaluate_rotation_confidence import ANNUAL_CROPS
from train_rotation import OUTPUT, SOURCE, get

STATES = {"19": "Iowa", "27": "Minnesota", "38": "North Dakota", "46": "South Dakota"}
YEARS = tuple(range(2017, 2025))


def region_rows(state):
    where = f"STATEFIPS='{state}'"
    count = get("/query", where=where, returnCountOnly="true")["count"]
    page_size = min(count, 500)
    rows = {}
    for offset in sorted({i * (count - page_size) // 3 for i in range(4)}):
        page = get("/query", where=where, orderByFields="OBJECTID ASC", resultOffset=offset,
                   resultRecordCount=page_size, returnGeometry="false",
                   outFields="CSBID,CNTYFIPS,CSBACRES," + ",".join(f"CDL{year}" for year in YEARS))
        for feature in page["features"]:
            row = feature["attributes"]
            if not row["CSBID"] or not row["CNTYFIPS"]:
                continue
            key = (state, row["CSBID"])
            entry = (state + row["CNTYFIPS"][-3:], row["CSBACRES"],
                     tuple(row[f"CDL{year}"] for year in YEARS))
            if key in rows and rows[key] != entry:
                raise ValueError(f"Conflicting duplicate field: {key}")
            rows[key] = entry
    return rows


def split_county(county):
    return int(hashlib.sha256(("regional:" + county).encode()).hexdigest()[:8], 16) % 10


def examples(rows, crops):
    splits = {"training": [], "validation": [], "test": []}
    for (state, _), (county, acres, history) in rows.items():
        bucket = split_county(county)
        if bucket < 2:
            split, targets = "test", [7]
        elif bucket < 4:
            split, targets = "validation", [6]
        else:
            split, targets = "training", range(3, 7)
        for index in targets:
            if all(code in crops for code in history[index - 3:index + 1]):
                size = int(math.log2(acres) // 2) if isinstance(acres, (int, float)) and acres > 0 else None
                splits[split].append((state, county, history[:index], size, history[index]))
    if not all(splits.values()):
        raise ValueError("An evaluation split has no eligible annual-crop examples.")
    return splits


def fit(rows, width):
    counts = defaultdict(Counter)
    overall = Counter()
    for _, _, history, size, target in rows:
        overall[target] += 1
        for length in range(1, min(width, len(history)) + 1):
            sequence = history[-length:]
            counts[(sequence, None)][target] += 1
            if size is not None:
                counts[(sequence, size)][target] += 1
    return counts, overall


def predict(history, size, width, use_size, counts, overall):
    for length in range(min(width, len(history)), 0, -1):
        sequence = history[-length:]
        keys = [(sequence, size), (sequence, None)] if use_size and size is not None else [(sequence, None)]
        for key in keys:
            counts_for_key = counts.get(key)
            if counts_for_key and counts_for_key.total() >= 10:
                return counts_for_key.most_common(1)[0][0]
    return overall.most_common(1)[0][0]


def score(rows, model, width, use_size):
    outcomes = defaultdict(Counter)
    for state, _, history, size, target in rows:
        match = predict(history, size, width, use_size, *model) == target
        for key in ("overall", STATES[state]):
            outcomes[key]["scored"] += 1
            outcomes[key]["correct"] += int(match)
    return {group: {**result, "accuracy": result["correct"] / result["scored"]}
            for group, result in outcomes.items()}


def main():
    metadata = get()
    domain = next(field["domain"]["codedValues"] for field in metadata["fields"] if field["name"] == "CDL2024")
    crops = {item["code"] for item in domain if item["name"].casefold().strip() in ANNUAL_CROPS}
    with ThreadPoolExecutor(max_workers=4) as executor:
        rows = {key: value for group in executor.map(region_rows, STATES) for key, value in group.items()}
    splits = examples(rows, crops)
    training, validation, test = (splits[key] for key in ("training", "validation", "test"))
    models = {
        "minnesota_three_year": fit([row for row in training if row[0] == "27"], 3),
        "regional": fit(training, 6),
    }
    candidate_widths = (3, 4, 5, 6)
    validation_scores = {width: score(validation, models["regional"], width, False)["overall"]["accuracy"]
                         for width in candidate_widths}
    width = max(candidate_widths, key=validation_scores.get)
    report = {
        "source": SOURCE, "cohort_field_counts": dict(Counter(STATES[state] for state, _ in rows)),
        "source_fingerprint": hashlib.sha256(json.dumps(sorted(rows.items())).encode()).hexdigest(),
        "target_years": {"training": [2020, 2021, 2022, 2023], "validation": 2023, "test": 2024},
        "county_counts": {key: len({row[1] for row in value}) for key, value in splits.items()},
        "eligible_examples": {key: len(value) for key, value in splits.items()},
        "validation_by_maximum_history": validation_scores, "chosen_maximum_history": width,
        "test_results": {
            "minnesota_three_year": score(test, models["minnesota_three_year"], 3, False),
            "regional_three_year": score(test, models["regional"], 3, False),
            "regional_selected_history": score(test, models["regional"], width, False),
            "regional_selected_history_and_field_size": score(test, models["regional"], width, True),
        },
        "limitations": [
            "The 2024 boundary and acreage are retrospective inputs derived from the eight-year release.",
            "The test measures next mapped crop on annual-crop records only. This is a development benchmark.",
        ],
    }
    folder = OUTPUT / "experiments"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "regional-history-2024.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
