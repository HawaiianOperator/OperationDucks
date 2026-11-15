"""Train and load Duck's small, word-and-bigram intent classifier."""

import hashlib
import random
import re
from pathlib import Path

import torch
from torch import nn

MODEL_PATH = Path(__file__).resolve().with_name("router.pt")
BUCKETS = 8192
WIDTH = 240
EXAMPLES = {
    "power": ("weather", "air temperature", "rainfall", "solar radiation", "sunlight", "NASA POWER"),
    "smap": ("soil moisture", "SMAP", "root zone moisture", "soil water content", "ground wetness"),
    "gpm": ("GPM", "IMERG", "half hourly precipitation", "satellite rainfall", "precipitation imagery"),
    "landsat": ("Landsat", "HLS", "Harmonized Landsat Sentinel", "NDVI", "crop greenness", "vegetation health"),
    "ecostress": ("ECOSTRESS", "canopy heat stress", "surface temperature", "thermal stress", "land surface heat"),
    "modis": ("MODIS", "Terra vegetation", "historical NDVI", "MOD13Q1", "MOD11A1", "MODIS surface temperature"),
    "emit": ("EMIT", "hyperspectral", "reflectance spectra", "spectral cubes", "mineral spectroscopy"),
    "boundaries": ("geoBoundaries", "district boundaries", "provincial borders", "country polygons", "administrative boundaries"),
    "agriculture": ("FAOSTAT", "crop area", "farm polygons", "farmland", "crops by country", "cropland extent", "MapSPAM", "WorldCereal"),
    "fire": ("FIRMS", "wildfire", "active fire", "fire hotspots", "burning"),
    "planting": ("planting window", "when to sow", "where to plant", "planting dates", "compare planting",
                 "best time to plant", "seed planting", "when should I plant", "when can I seed",
                 "optimal seeding date", "when and where to plant", "best place to grow"),
    "unknown": ("write an essay", "tell a joke", "predict stock prices", "hello", "train your model", "irrigation advice"),
}
LABELS = tuple(EXAMPLES)
DATASET_IDENTIFIERS = {
    "power": r"nasa\s+power",
    "smap": r"smap",
    "gpm": r"gpm|imerg",
    "landsat": r"landsat|hls",
    "ecostress": r"ecostress",
    "modis": r"modis|mod13q1|mod11a1",
    "emit": r"(?-i:EMIT)|nasa\s+emit",
    "boundaries": r"geoboundaries",
    "agriculture": r"faostat|mapspam|worldcereal",
    "fire": r"(?-i:FIRMS)|nasa\s+firms",
}
DATASET_PATTERNS = {
    intent: re.compile(r"\b(?:" + identifiers + r")\b", re.IGNORECASE)
    for intent, identifiers in DATASET_IDENTIFIERS.items()
}


def encode(text):
    text = re.sub(r"\b(?:days|min_c|min_mm)\s*=\s*-?\d+(?:\.\d+)?", " ", text.casefold())
    words = [word for word in re.findall(r"[^\W_]+", text) if not word.isdecimal()]
    terms = words + [" ".join(pair) for pair in zip(words, words[1:])]
    return [
        1 + int.from_bytes(hashlib.blake2b(term.encode(), digest_size=4).digest(), "little") % (BUCKETS - 1)
        for term in terms[:120]
    ] or [0]


def batch(texts):
    rows = [encode(text) for text in texts]
    width = max(map(len, rows))
    return torch.tensor([row + [0] * (width - len(row)) for row in rows])


class Router(nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding = nn.Embedding(BUCKETS, WIDTH, padding_idx=0)
        self.output = nn.Sequential(nn.Linear(WIDTH, 128), nn.ReLU(), nn.Dropout(0.15), nn.Linear(128, len(LABELS)))

    def forward(self, tokens):
        counts = tokens.ne(0).sum(dim=1, keepdim=True).clamp_min(1)
        return self.output(self.embedding(tokens).sum(dim=1) / counts)


def train(device, epochs=35):
    torch.manual_seed(42)
    rng = random.Random(42)
    model = Router().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.006)
    prefixes = ("", "find ", "show me ", "where can I get ", "I need ", "can Duck find ")
    suffixes = ("", " data", " over western Kenya", " for 2024", " near the map center", " worldwide")
    rows = [(prefix + term + suffix, label) for label, terms in enumerate(EXAMPLES.values())
            for term in terms for prefix in prefixes for suffix in suffixes]
    for _ in range(epochs):
        rng.shuffle(rows)
        for offset in range(0, len(rows), 128):
            texts, labels = zip(*rows[offset:offset + 128])
            optimizer.zero_grad()
            loss = nn.functional.cross_entropy(model(batch(texts).to(device)), torch.tensor(labels, device=device))
            loss.backward()
            optimizer.step()
    return model.eval()


def predict(model, question):
    named = [intent for intent, pattern in DATASET_PATTERNS.items() if pattern.search(question)]
    if len(named) == 1:
        return named[0], 1.0
    with torch.inference_mode():
        scores = model(batch([question]).to(next(model.parameters()).device)).softmax(dim=1)[0]
    index = int(scores.argmax())
    return LABELS[index], float(scores[index])


def save(model):
    MODEL_PATH.parent.mkdir(exist_ok=True)
    temporary = MODEL_PATH.with_suffix(".tmp")
    torch.save({"labels": LABELS, "weights": model.state_dict()}, temporary)
    temporary.replace(MODEL_PATH)


def load():
    checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
    if checkpoint["labels"] != LABELS:
        raise ValueError("Duck router labels changed. Retrain and export the checkpoint.")
    model = Router()
    model.load_state_dict(checkpoint["weights"])
    return model.eval()
