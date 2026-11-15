"""Evaluate candidate crop-history models without tuning on the test counties."""
from collections import Counter, defaultdict
import hashlib
import json

from train_rotation import OUTPUT, county_holdout, curate


def fit(rows, width):
    counts = defaultdict(Counter)
    for row in rows:
        for target in range(1, len(row)):
            for size in range(1, min(width, target) + 1):
                counts[row[target - size:target]][row[target]] += 1
    return counts


def predict(history, counts, width, support):
    for size in range(min(width, len(history)), 0, -1):
        group = counts.get(history[-size:])
        if group and group.total() >= support:
            crop, votes = group.most_common(1)[0]
            return crop, votes / group.total()
    return history[-1], 0


def score(rows, predictions, threshold=0):
    matches = [(row[-1], crop) for row, (crop, confidence) in zip(rows, predictions) if confidence >= threshold]
    hits = sum(actual == predicted for actual, predicted in matches)
    return {"correct": hits, "answered": len(matches), "coverage": len(matches) / len(rows),
            "accuracy": hits / len(matches) if matches else None}


def main():
    years, _, records, _ = curate()
    test = [row for county, row in records.values() if county_holdout(county)]
    counties = sorted({county for county, _ in records.values() if not county_holdout(county)},
                      key=lambda county: hashlib.sha256(("tune:" + county).encode()).hexdigest())
    tuning_counties = set(counties[:max(2, len(counties) // 4)])
    validation = [row[:-1] for county, row in records.values() if county in tuning_counties]
    training = [row for county, row in records.values()
                if not county_holdout(county) and county not in tuning_counties]
    if min(len(training), len(validation), len(test)) < 100:
        raise RuntimeError("Insufficient fields for separate training, tuning and test splits.")
    trials = []
    for width in (1, 2, 3, 4, 5, 6):
        counts = fit([row[:-2] for row in training], width)
        for support in (5, 20, 50, 100):
            pred = [predict(row[:-1], counts, width, support) for row in validation]
            result = score(validation, pred)
            trials.append((result["accuracy"], width, support))
    validation_accuracy, width, support = max(trials)
    final_counts = fit([row[:-1] for row in training] + validation, width)
    pred = [predict(row[:-1], final_counts, width, support) for row in test]
    report = {
        "test_year": years[-1], "test_fields": len(test), "tuning_fields": len(validation),
        "configurations": len(trials), "selected_history_width": width,
        "minimum_support": support, "validation_accuracy": validation_accuracy,
        "test": score(test, pred),
        "test_by_minimum_vote_share": {str(level): score(test, pred, level) for level in (0.8, 0.9, 0.95, 0.99)},
    }
    destination = OUTPUT / "experiments"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "challenger-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
