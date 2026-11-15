"""Compare a NASA POWER weather-enriched model with a crop-history control."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
import hashlib
import json
from statistics import mean
from time import perf_counter
from urllib.parse import urlencode
from urllib.request import urlopen

import torch
from torch import nn

from train_rotation import OUTPUT, SOURCE, county_holdout, curate, get, metrics_for

POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
CODES = ("T2M", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN")


def county_point(county):
    extent = get("/query", where=f"STATEFIPS='27' AND CNTYFIPS='{int(county):03d}'",
                 returnExtentOnly="true", outSR="4326")["extent"]
    if not extent:
        raise ValueError(f"No USDA extent for county {county}.")
    # Quantize representative points so fields sharing a POWER cell share one request.
    return tuple(round((extent[low] + extent[high]) / (2 * spacing)) * spacing
                 for low, high, spacing in (("xmin", "xmax", 0.625), ("ymin", "ymax", 0.5)))


def fetch_seasons(point, years):
    lon, lat = point
    url = POWER + "?" + urlencode({
        "community": "AG", "longitude": lon, "latitude": lat, "parameters": ",".join(CODES),
        "start": f"{years[0]}0501", "end": f"{years[-1]}0930", "format": "JSON", "time-standard": "UTC",
    })
    with urlopen(url, timeout=40) as response:
        data = json.load(response)
    values = data["properties"]["parameter"]
    missing = data["header"]["fill_value"]
    seasons = {}
    for year in years:
        start, stop = date(year, 5, 1), date(year, 9, 30)
        days = [(start + timedelta(days=i)).strftime("%Y%m%d") for i in range((stop - start).days + 1)]
        features = []
        for code in CODES:
            series = [values[code].get(day) for day in days]
            if any(value is None or value == missing for value in series):
                raise ValueError(f"Incomplete {code} at {point} in {year}.")
            features.append(sum(series) if code == "PRECTOTCORR" else mean(series))
        seasons[year] = features
    return url, seasons


class RotationModel(nn.Module):
    def __init__(self, size, weather_width):
        super().__init__()
        self.crops = nn.Embedding(size, 24)
        self.output = nn.Sequential(nn.Linear(72 + weather_width, 64), nn.ReLU(), nn.Linear(64, size))

    def forward(self, crops, weather):
        return self.output(torch.cat((self.crops(crops).flatten(1), weather), dim=1))


def fit(train, test, lookup, device, use_weather):
    def tensors(rows):
        histories, features, targets = zip(*rows)
        return (
            torch.tensor([[lookup[code] for code in row] for row in histories], device=device),
            torch.tensor(features, dtype=torch.float32, device=device),
            torch.tensor([lookup[code] for code in targets], device=device),
        )

    train_crops, train_weather, train_targets = tensors(train)
    test_crops, test_weather, test_targets = tensors(test)
    center = train_weather.mean(dim=0)
    scale = train_weather.std(dim=0).clamp_min(1e-6)
    train_weather = (train_weather - center) / scale
    test_weather = (test_weather - center) / scale
    if not use_weather:
        train_weather, test_weather = train_weather[:, :0], test_weather[:, :0]
    size = len(lookup) + 1
    width = train_weather.shape[1]
    torch.manual_seed(42)
    model = RotationModel(size, width).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003)
    for _ in range(12):
        for batch in torch.randperm(len(train_targets), device=device).split(256):
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(model(train_crops[batch], train_weather[batch]), train_targets[batch])
            loss.backward()
            optimizer.step()
    with torch.inference_mode():
        predictions = model.eval()(test_crops, test_weather).argmax(dim=1).cpu().tolist()
    checkpoint = {"weights": {key: value.cpu() for key, value in model.state_dict().items()},
                  "weather_center": center.cpu(), "weather_scale": scale.cpu(), "lookup": lookup,
                  "weather_width": width}
    return metrics_for(test_targets.cpu().tolist(), predictions), checkpoint


def run(device):
    started = perf_counter()
    years, labels, rows, skipped = curate()
    version = hashlib.sha256(json.dumps([years, labels, rows], sort_keys=True).encode()).hexdigest()
    counties = sorted({county for county, _ in rows.values()})
    print(f"Joined USDA cohort {version[:16]}: {len(rows)} fields in {len(counties)} counties", flush=True)
    prior_years = years[2:-1]
    with ThreadPoolExecutor(max_workers=4) as executor:
        points = dict(zip(counties, executor.map(county_point, counties)))
        unique = sorted(set(points.values()))
        fetch = executor.map(lambda point: fetch_seasons(point, prior_years), unique)
        weather = dict(zip(unique, fetch))
    print(f"Retrieved complete NASA POWER seasons for {len(weather)} representative points", flush=True)
    retrieved = perf_counter()
    train, test = [], []
    for county, history in rows.values():
        holdout = county_holdout(county)
        for index in (range(len(years) - 1, len(years)) if holdout else range(3, len(years) - 1)):
            features = weather[points[county]][1][years[index] - 1]
            (test if holdout else train).append((history[index - 3:index], features, history[index]))
    if len(train) < 1000 or len(test) < 100:
        raise ValueError(f"Insufficient split: {len(train)} training rows and {len(test)} test rows.")
    lookup = {code: index for index, code in enumerate(sorted(labels), start=1)}
    control, _ = fit(train, test, lookup, device, use_weather=False)
    candidate, checkpoint = fit(train, test, lookup, device, use_weather=True)
    fitted = perf_counter()
    report = {
        "usda_source": SOURCE, "usda_fingerprint": version, "test_year": years[-1],
        "device": str(device), "train_examples": len(train), "test_examples": len(test), "skipped_rows": skipped,
        "test_counties": [county for county in counties if county_holdout(county)],
        "weather_window": "May through September of the year before the predicted crop",
        "weather_parameters": CODES, "county_points": points,
        "weather_queries": [url for url, _ in weather.values()],
        "metrics": {"crop_history_control": control, "nasa_power_candidate": candidate},
        "seconds": {"source_retrieval": retrieved - started, "join_and_fit_both_models": fitted - retrieved},
        "target": "Next mapped crop class. The benchmark does not measure yield or rotation benefit.",
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    path = OUTPUT / f"{version[:16]}-nasa-power-{device.type}"
    staging = path.with_suffix(".tmp")
    torch.save({**checkpoint, "report": report}, staging)
    verified = torch.load(staging, map_location="cpu", weights_only=True)
    restored = RotationModel(len(lookup) + 1, len(CODES))
    restored.load_state_dict(verified["weights"])
    with torch.inference_mode():
        crops = torch.tensor([[lookup[code] for code in history] for history, _, _ in test])
        features = torch.tensor([values for _, values, _ in test], dtype=torch.float32)
        predicted = restored.eval()(crops, (features - verified["weather_center"]) / verified["weather_scale"]).argmax(1)
    report["reloaded_checkpoint_metrics"] = metrics_for([lookup[target] for _, _, target in test], predicted.tolist())
    if report["reloaded_checkpoint_metrics"] != candidate:
        raise RuntimeError("Reloaded checkpoint did not reproduce held-out metrics.")
    staging.replace(path.with_suffix(".pt"))
    path.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    args = parser.parse_args()
    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("Choose an A30 CUDA kernel or pass --device cpu for local validation.")
    torch.set_num_threads(2)
    print(json.dumps(run(torch.device(args.device)), indent=2))
