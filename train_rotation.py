"""Train a Minnesota CSB next-crop classifier. Keeps source rows in memory."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import urlopen

import torch
from torch import nn

SOURCE = "https://services3.arcgis.com/g6eV2CrSSwCZj8Mc/arcgis/rest/services/NASS_Crop_Sequence_Boundaries_2024/FeatureServer/0"
OUTPUT = Path(__file__).with_name(".duck-model") / "rotation"


def get(path="", **params):
    with urlopen(SOURCE + path + "?" + urlencode({"f": "json", **params}), timeout=25) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(f"CSB query failed: {result['error'].get('message')}")
    return result


def curate():
    metadata = get()
    crop_fields = {int(field["name"][3:]): field for field in metadata["fields"]
                   if field["name"].startswith("CDL") and field["name"][3:].isdigit()}
    years = sorted(crop_fields)[-8:]
    if len(years) != 8 or years != list(range(years[0], years[0] + 8)):
        raise ValueError("Expected eight consecutive CSB crop years.")
    domain = crop_fields[years[-1]]["domain"]["codedValues"]
    labels = {item["code"]: item["name"] for item in domain
              if item["code"] > 0 and item["name"].casefold() not in {"background", "no data"}}
    count = get("/query", where="STATEFIPS='27'", returnCountOnly="true")["count"]
    if count < 5600:
        raise ValueError(f"Only {count} Minnesota records are available.")
    rows = {}
    skipped = 0
    for index in range(8):
        page = get("/query", where="STATEFIPS='27'", returnGeometry="false",
                   orderByFields="OBJECTID ASC", resultOffset=index * (count - 700) // 7,
                   resultRecordCount=700, outFields="CSBID,CNTYFIPS," + ",".join(f"CDL{year}" for year in years))
        for feature in page["features"]:
            row = feature["attributes"]
            field, county = row["CSBID"], row["CNTYFIPS"]
            history = tuple(row[f"CDL{year}"] for year in years)
            if not field or not county or any(code not in labels for code in history):
                skipped += 1
                continue
            if field in rows and rows[field] != (county, history):
                raise ValueError(f"Conflicting crop histories for {field}.")
            rows[field] = (county, history)
    return years, labels, rows, skipped


def county_holdout(county):
    return int(hashlib.sha256(county.encode()).hexdigest()[:8], 16) % 5 == 0


def build_model(size):
    return nn.Sequential(nn.Embedding(size, 24), nn.Flatten(), nn.Linear(72, 64), nn.ReLU(), nn.Linear(64, size))


def predict_crops(model, device, lookup, test):
    with torch.inference_mode():
        inputs = torch.tensor([[lookup.get(code, 0) for code in history] for history, _ in test], device=device)
        predictions = model(inputs).argmax(dim=1).cpu().tolist()
    codes = {index: code for code, index in lookup.items()}
    return [codes.get(index) for index in predictions]


def metrics_for(actual, predicted):
    class_counts = Counter(actual)
    return {
        "accuracy": sum(a == p for a, p in zip(actual, predicted)) / len(actual),
        "macro_recall": sum(
            sum(a == code and a == p for a, p in zip(actual, predicted)) / count
            for code, count in class_counts.items()
        ) / len(class_counts),
    }


def evaluate(model, device, lookup, train, test):
    transitions = defaultdict(Counter)
    for history, code in train:
        transitions[history[-1]][code] += 1
    methods = {
        "model": predict_crops(model, device, lookup, test),
        "last_crop": [history[-1] for history, _ in test],
        "most_common_transition": [transitions[history[-1]].most_common(1)[0][0] if transitions[history[-1]]
                                   else history[-1] for history, _ in test],
    }
    actual = [code for _, code in test]
    return {name: metrics_for(actual, predicted) for name, predicted in methods.items()}


def validate_checkpoint(checkpoint_path, device):
    started = time.perf_counter()
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    lookup = checkpoint["lookup"]
    model = build_model(len(lookup) + 1).to(device)
    model.load_state_dict(checkpoint["weights"])
    model.eval()
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    loaded = time.perf_counter()
    years, labels, rows, _ = curate()
    version = hashlib.sha256(json.dumps([years, labels, rows], sort_keys=True).encode()).hexdigest()
    if version != checkpoint["report"]["version"]:
        raise ValueError("The sampled records changed. This command reproduces the original holdout only.")
    test = [(history[-4:-1], history[-1]) for county, history in rows.values() if county_holdout(county)]
    if not test:
        raise ValueError("No held-out fields were found.")
    data_ready = time.perf_counter()
    predictions = predict_crops(model, device, lookup, test)
    inference_done = time.perf_counter()
    result = metrics_for([code for _, code in test], predictions)
    return {
        "mode": "validation-only",
        "device": str(device),
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "fields": len(test),
        "test_year": years[-1],
        "metrics": result,
        "seconds": {
            "checkpoint_load": loaded - started,
            "data_fetch_and_preparation": data_ready - loaded,
            "batch_inference_and_transfer": inference_done - data_ready,
            "total": time.perf_counter() - started,
        },
    }


def run(device):
    years, labels, rows, skipped = curate()
    version = hashlib.sha256(json.dumps([years, labels, rows], sort_keys=True).encode()).hexdigest()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report_file = OUTPUT / f"{version[:16]}.json"
    if report_file.exists():
        return json.loads(report_file.read_text())

    train, test = [], []
    train_counties, test_counties = set(), set()
    for county, history in rows.values():
        if county_holdout(county):
            test_counties.add(county)
            test.append((history[-4:-1], history[-1]))
        else:
            train_counties.add(county)
            train.extend((history[target - 3:target], history[target]) for target in range(3, len(years) - 1))
    if len(train) < 1000 or len(test) < 100 or len(train_counties) < 5 or len(test_counties) < 2:
        raise ValueError(f"Insufficient data after county and time holdout: {len(train)} train, {len(test)} test.")
    if train_counties & test_counties:
        raise ValueError("Training and test counties overlap.")

    lookup = {code: index for index, code in enumerate(sorted(labels), start=1)}
    torch.manual_seed(42)
    size = len(lookup) + 1
    model = build_model(size).to(device)
    x = torch.tensor([[lookup[code] for code in history] for history, _ in train], device=device)
    y = torch.tensor([lookup[code] for _, code in train], device=device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003)
    for _ in range(12):
        for indices in torch.randperm(len(y), device=device).split(256):
            optimizer.zero_grad()
            nn.functional.cross_entropy(model(x[indices]), y[indices]).backward()
            optimizer.step()

    metrics = evaluate(model.eval(), device, lookup, train, test)
    report = {
        "source": SOURCE, "version": version, "years": years, "device": str(device),
        "fields": len(rows), "skipped_rows": skipped, "train_examples": len(train),
        "test_examples": len(test), "train_counties": len(train_counties), "test_counties": len(test_counties),
        "test_year": years[-1], "metrics": metrics,
        "candidate_beats_baselines": all(
            metrics["model"][metric] > max(metrics[name][metric] for name in ("last_crop", "most_common_transition"))
            for metric in ("accuracy", "macro_recall")
        ),
    }
    torch.save({"weights": {key: value.cpu() for key, value in model.state_dict().items()},
                "lookup": lookup, "labels": labels, "report": report}, report_file.with_suffix(".pt"))
    temp = report_file.with_suffix(".tmp")
    temp.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temp.replace(report_file)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu"))
    parser.add_argument("--watch", action="store_true", help="Check the existing feed daily while this process runs.")
    parser.add_argument("--validate-only", type=Path, metavar="CHECKPOINT", help="Score an existing checkpoint without training.")
    options = parser.parse_args()
    if options.device == "cuda" and not torch.cuda.is_available():
        parser.error("Select an A30 CUDA-enabled Python environment or use --device cpu for a smoke test.")
    device = torch.device(options.device)
    if options.validate_only:
        if options.watch:
            parser.error("--validate-only and --watch cannot be used together.")
        print(json.dumps(validate_checkpoint(options.validate_only, device), indent=2), flush=True)
        raise SystemExit(0)
    while True:
        try:
            print(json.dumps(run(device), indent=2), flush=True)
        except (OSError, RuntimeError, ValueError) as error:
            if not options.watch:
                raise
            print(f"CSB update check failed: {error}", flush=True)
        if not options.watch:
            break
        time.sleep(86400)
