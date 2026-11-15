"""Seasonal estimates from NASA POWER daily point records."""

from datetime import date
import json
from pathlib import Path
import re
from statistics import mean


SITES = {
    "diddly-squat-area": ("diddly squat", "clarkson", "chadlington", "oxfordshire"),
    "central-valley": ("central valley",),
    "hawaii-kona": ("kona",),
    "hawaii-hilo": ("hilo",),
    "hawaii-central-maui": ("central maui", "maui"),
    "hawaii-central-oahu": ("central oahu", "oahu", "oʻahu"),
    "hawaii-kauai": ("kauai", "kauaʻi"),
    "hawaii-molokai": ("molokai", "molokaʻi"),
    "hawaii-lanai": ("lanai", "lānaʻi"),
}
VARIABLES = {
    "T2M": ("air temperature", ("temperature", "heat")),
    "PRECTOTCORR": ("precipitation", ("rain", "precipitation", "irrigation")),
    "ALLSKY_SFC_SW_DWN": ("solar radiation", ("solar", "sunlight", "irradiance")),
}


def load_history(root):
    histories = {}
    for site in SITES:
        path = Path(root) / "resources" / "data" / "NASA" / f"power-{site}-2016-2025.json"
        if not path.is_file():
            continue
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        histories[site] = {
            code: (
                data["parameters"][code]["units"],
                {date.fromisoformat(key): value for key, value in data["properties"]["parameter"][code].items()
                 if value != data["header"]["fill_value"]},
            )
            for code in VARIABLES
        }
    return histories


def monthly_estimate(values, month, cutoff_year):
    sample = [value for day, value in values.items() if day.year < cutoff_year and day.month == month]
    return mean(sample) if sample else None


def backtest(values, first_year=2023, last_year=2025):
    errors = []
    for day, observed in sorted(values.items()):
        if first_year <= day.year <= last_year:
            expected = monthly_estimate(values, day.month, day.year)
            if expected is not None:
                errors.append(abs(expected - observed))
    return {"days": len(errors), "mae": mean(errors) if errors else None}


def historical_evidence(histories, question):
    query = question.casefold()
    match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", query)
    site = next((key for key, aliases in SITES.items() if any(alias in query for alias in aliases)), None)
    code = next((key for key, (_, aliases) in VARIABLES.items() if any(alias in query for alias in aliases)), None)
    if not match or not site or not code:
        return ""
    if site not in histories:
        return f"Historical POWER series for {site} is unavailable."
    try:
        target = date.fromisoformat(match.group())
    except ValueError:
        return "The requested date is invalid."
    unit, values = histories[site][code]
    name = VARIABLES[code][0]
    if target in values:
        return f"NASA POWER gridded daily {name} for {site} on {target}: {values[target]:.2f} {unit}."
    estimate = monthly_estimate(values, target.month, target.year)
    if estimate is None:
        return f"No historical baseline exists for {site} and {target}."
    evaluation = backtest(values, last_year=min(2025, target.year - 1))
    error = (f" Backtest daily mean absolute error: {evaluation['mae']:.2f} {unit} across "
             f"{evaluation['days']} held-out days." if evaluation["days"] else "")
    return (f"Historical monthly daily-average estimate for {site} and {target}: {name} "
            f"{estimate:.2f} {unit}. This is a seasonal baseline; daily weather can vary.{error}")
