"""Train and calibrate an annual-crop model on disjoint Minnesota counties."""

import hashlib
import json
import math

import torch
from torch import nn

from train_rotation import OUTPUT, build_model, county_holdout, curate

ANNUAL_CROPS = {
    "corn", "soybeans", "oats", "barley", "spring wheat", "winter wheat", "dry beans",
    "peas", "sunflower", "cotton", "tomatoes", "rice", "sorghum", "safflower", "sugarbeets",
}


def summarize(logits, targets, temperature):
    scores, choices = (logits / temperature).softmax(dim=1).max(dim=1)
    correct = choices.eq(targets)
    bins = torch.clamp((scores * 5).long(), max=4)
    error = sum(float(mask.sum()) * abs(float(scores[mask].mean()) - float(correct[mask].float().mean()))
                for index in range(5) if (mask := bins.eq(index)).any()) / len(scores)
    return {
        "mean_confidence": float(scores.mean()),
        "accuracy": float(correct.float().mean()),
        "calibration_error_five_bins": error,
        "cross_entropy": float(nn.functional.cross_entropy(logits / temperature, targets)),
        "thresholds": {
            str(level): {"answered": int((scores >= level).sum()),
                         "correct": int(((scores >= level) & correct).sum())}
            for level in (0, 0.5, 0.7, 0.8, 0.9)
        },
    }


def main():
    torch.set_num_threads(2)
    torch.manual_seed(42)
    years, labels, rows, _ = curate()
    fingerprint = hashlib.sha256(json.dumps([years, labels, rows], sort_keys=True).encode()).hexdigest()
    if fingerprint != "9ff188a769b7c3529fa07622922ba38cffe2e4abf9f21da62349ccfa38500b81":
        raise ValueError("The USDA source no longer matches the original comparison cohort.")
    lookup = {code: i for i, code in enumerate(
        sorted(code for code, label in labels.items() if label.casefold().strip() in ANNUAL_CROPS)
    )}
    development = sorted({county for county, _ in rows.values() if not county_holdout(county)},
                         key=lambda county: hashlib.sha256(("tune:" + county).encode()).hexdigest())
    calibration_counties = set(development[:max(2, len(development) // 4)])
    splits = {"train": [], "calibration": [], "test": []}
    eligible = dict.fromkeys(splits, 0)
    totals = dict.fromkeys(splits, 0)
    for county, history in rows.values():
        if county_holdout(county):
            split, targets = "test", [len(years) - 1]
        elif county in calibration_counties:
            split, targets = "calibration", [len(years) - 2]
        else:
            split, targets = "train", range(3, len(years) - 2)
        for index in targets:
            totals[split] += 1
            previous = history[index - 3:index]
            if not all(code in lookup for code in previous):
                continue
            eligible[split] += 1
            if history[index] in lookup:
                splits[split].append(([lookup[code] for code in previous], lookup[history[index]]))
    if not all(splits.values()):
        raise ValueError("The annual crop filter left an empty evaluation split.")
    tensors = {name: tuple(torch.tensor(column) for column in zip(*examples))
               for name, examples in splits.items()}
    x, y = tensors["train"]
    model = build_model(len(lookup))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.003)
    for _ in range(12):
        for batch in torch.randperm(len(y)).split(256):
            optimizer.zero_grad()
            nn.functional.cross_entropy(model(x[batch]), y[batch]).backward()
            optimizer.step()
    with torch.inference_mode():
        validation_x, validation_y = tensors["calibration"]
        validation_logits = model.eval()(validation_x)
        temperature = min((math.exp(i / 20) for i in range(-20, 61)), key=lambda value:
                          nn.functional.cross_entropy(validation_logits / value, validation_y).item())
        test_x, test_y = tensors["test"]
        logits = model(test_x)
        report = {
            "source_fingerprint": fingerprint, "test_year": years[-1],
            "calibration_year": years[-2], "calibration_counties": sorted(calibration_counties),
            "counts": {name: {"total": totals[name], "crop_history_eligible": eligible[name],
                               "annual_target_scored": len(examples)} for name, examples in splits.items()},
            "temperature": temperature,
            "raw": summarize(logits, test_y, 1),
            "calibrated": summarize(logits, test_y, temperature),
        }
    output = OUTPUT / "experiments"
    output.mkdir(parents=True, exist_ok=True)
    path = output / "annual-crop-confidence.pt"
    temporary = path.with_suffix(".tmp")
    torch.save({"weights": model.state_dict(), "lookup": lookup, "temperature": temperature, "report": report}, temporary)
    restored = torch.load(temporary, weights_only=True, map_location="cpu")
    check = build_model(len(lookup))
    check.load_state_dict(restored["weights"])
    with torch.inference_mode():
        torch.testing.assert_close(check.eval()(test_x), logits)
    temporary.replace(path)
    path.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
