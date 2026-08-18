#!/usr/bin/env python3
"""Build a compact, source-backed historical corpus for the Android app.

The generator downloads the current Pleiades GIS export from the official
pleiades.datasets GitHub mirror, filters it to Türkiye and its immediate
historical context, joins names/place types/location geometries, and writes a
small JSON asset consumed entirely offline by the WebView.

No speculative treasure/hidden-object points are generated here. The
"protection context" layer in the client is derived only from documented
public records at coarse regional resolution.
"""
from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://raw.githubusercontent.com/isawnyu/pleiades.datasets/main/data/gis/"
FILES = [
    "places.csv",
    "places_place_types.csv",
    "place_types.csv",
    "names.csv",
    "location_linestrings.csv",
    "location_polygons.csv",
    "places_accuracy.csv",
]
# Türkiye + a modest border/context buffer (Aegean islands, Thrace, Caucasus,
# northern Levant). The UI still starts and searches in Türkiye.
MIN_LON, MAX_LON = 24.0, 46.5
MIN_LAT, MAX_LAT = 34.0, 43.5
OUT = Path("app/src/main/assets/data/history-corpus.json")

TYPE_PATTERNS = [
    ("Yol", r"\broad\b|route|street|track|way\b|via\b|road station|milestone"),
    ("Konaklama", r"caravanserai|caravanseray|kervansaray|\bhan\b|\binn\b|mansio|mutatio|station|staging post"),
    ("Geçiş", r"bridge|crossing|ford|pass\b|gateway|gate\b|köprü|geçit"),
    ("Savunma", r"fortress|fortification|fort\b|castle|citadel|city wall|wall\b|tower|kale|hisar|castrum|limes"),
    ("Su", r"aqueduct|cistern|spring|fountain|well\b|reservoir|bath|water|su kemeri|çeşme|kuyu|sarnıç"),
    ("Mağara", r"cave|rock shelter|shelter|grotto|mağara"),
    ("Mezar", r"necropolis|cemetery|tomb|tumulus|burial|mausoleum|grave|nekropol|mezar|tümülüs"),
    ("Dini", r"temple|sanctuary|church|monastery|mosque|shrine|basilica|kilise|manastır|cami|tapınak"),
    ("Yerleşim", r"settlement|city\b|town\b|village|polis\b|oppidum|colonia|urban|habitation|yerleşim|antik kent"),
]
PERIOD_PATTERNS = [
    ("Neolitik", r"neolithic|neolit"),
    ("Kalkolitik", r"chalcolithic|kalkolit"),
    ("Tunç Çağı", r"bronze age|tunç"),
    ("Hitit", r"hittite|hitit"),
    ("Frig", r"phryg|frig"),
    ("Urartu", r"urartu"),
    ("Arkaik", r"archaic|arkaik"),
    ("Klasik", r"classical|klasik"),
    ("Helenistik", r"hellenistic|hellen|helenistik"),
    ("Roma", r"roman|roma\b|late antique|geç antik"),
    ("Bizans", r"byzant|bizans"),
    ("Selçuklu", r"seljuk|selçuk"),
    ("Osmanlı", r"ottoman|osmanl"),
]


def fetch(name: str) -> bytes:
    url = BASE + name
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "AntikHaritaTurkiye-build/15 (+public heritage research map)"},
            )
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{name} indirilemedi: {last}")


def rows(raw: bytes):
    text = raw.decode("utf-8-sig", errors="replace")
    return csv.DictReader(io.StringIO(text))


def pick(d: dict, *names: str) -> str:
    for name in names:
        v = d.get(name)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def as_float(v):
    try:
        x = float(str(v).strip())
        return x if math.isfinite(x) else None
    except Exception:  # noqa: BLE001
        return None


def in_bounds(lat, lon):
    return lat is not None and lon is not None and MIN_LAT <= lat <= MAX_LAT and MIN_LON <= lon <= MAX_LON


def clean_text(v: str, limit: int = 420) -> str:
    if not v:
        return ""
    v = re.sub(r"<[^>]+>", " ", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v[:limit]


def compact_name(v: str) -> str:
    return re.sub(r"\s+", " ", (v or "")).strip()[:120]


def parse_wkt(wkt: str):
    """Parse common LineString/MultiLineString/Polygon WKT from the GIS export."""
    if not wkt:
        return None
    w = re.sub(r"^SRID=\d+;", "", wkt.strip(), flags=re.I)
    m = re.match(r"^LINESTRING\s*\((.*)\)\s*$", w, re.I | re.S)
    if m:
        coords = []
        for pair in m.group(1).split(","):
            nums = re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", pair)
            if len(nums) >= 2:
                coords.append([float(nums[0]), float(nums[1])])
        if len(coords) >= 2:
            return {"type": "LineString", "coordinates": coords[:1500]}
        return None
    m = re.match(r"^MULTILINESTRING\s*\(\((.*)\)\)\s*$", w, re.I | re.S)
    if m:
        lines = []
        for part in re.split(r"\)\s*,\s*\(", m.group(1)):
            coords = []
            for pair in part.split(","):
                nums = re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", pair)
                if len(nums) >= 2:
                    coords.append([float(nums[0]), float(nums[1])])
            if len(coords) >= 2:
                lines.append(coords[:1500])
        if lines:
            return {"type": "MultiLineString", "coordinates": lines[:20]}
        return None
    m = re.match(r"^POLYGON\s*\(\((.*)\)\)\s*$", w, re.I | re.S)
    if m:
        coords = []
        outer = m.group(1).split("),(", 1)[0]
        for pair in outer.split(","):
            nums = re.findall(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", pair)
            if len(nums) >= 2:
                coords.append([float(nums[0]), float(nums[1])])
        if len(coords) >= 4:
            return {"type": "Polygon", "coordinates": [coords[:1500]]}
    return None


def classify(text: str, geom=None) -> str:
    t = text.lower()
    for kind, pat in TYPE_PATTERNS:
        if re.search(pat, t, re.I):
            return kind
    return "Yapı"


def periods(text: str):
    t = text.lower()
    out = []
    for label, pat in PERIOD_PATTERNS:
        if re.search(pat, t, re.I):
            out.append(label)
    return out


def source_id(uri: str, pid: str) -> str:
    if uri:
        m = re.search(r"/places/(\d+)", uri)
        if m:
            return m.group(1)
    return pid


def main():
    print("Pleiades GIS verisi indiriliyor…")
    data = {}
    for name in FILES:
        raw = fetch(name)
        data[name] = raw
        print(f"  {name}: {len(raw)/1024/1024:.1f} MB")

    type_labels = {}
    for r in rows(data["place_types.csv"]):
        key = pick(r, "key", "id", "uri")
        label = pick(r, "label", "title", "value", "description")
        if key:
            type_labels[key] = clean_text(label, 120) or key

    place_types = defaultdict(list)
    for r in rows(data["places_place_types.csv"]):
        pid = pick(r, "place_id", "place", "id")
        key = pick(r, "place_type", "place_type_id", "type", "key")
        if pid and key:
            place_types[pid].append(type_labels.get(key, key))

    alt_names = defaultdict(list)
    name_period_text = defaultdict(list)
    for r in rows(data["names.csv"]):
        pid = pick(r, "place_id", "place")
        if not pid:
            continue
        candidates = [
            pick(r, "attested_form"),
            pick(r, "romanized_form_1"),
            pick(r, "romanized_form_2"),
            pick(r, "romanized_form_3"),
            pick(r, "title"),
        ]
        for n in candidates:
            n = compact_name(n)
            if n and n not in alt_names[pid] and len(alt_names[pid]) < 14:
                alt_names[pid].append(n)
        ptxt = " ".join(
            pick(r, k)
            for k in ("time_periods", "time_period", "start_date", "end_date", "description")
        )
        if ptxt.strip() and len(name_period_text[pid]) < 8:
            name_period_text[pid].append(clean_text(ptxt, 180))

    accuracy = {}
    for r in rows(data["places_accuracy.csv"]):
        pid = pick(r, "place_id", "place")
        if not pid:
            continue
        accuracy[pid] = {
            "min": as_float(pick(r, "min_accuracy_meters")),
            "max": as_float(pick(r, "max_accuracy_meters")),
        }

    geometries = defaultdict(list)
    for fname in ("location_linestrings.csv", "location_polygons.csv"):
        for r in rows(data[fname]):
            pid = pick(r, "place_id", "place")
            if not pid or len(geometries[pid]) >= 3:
                continue
            g = parse_wkt(pick(r, "geometry_wkt", "geometry"))
            if not g:
                continue
            if g["type"] == "LineString":
                flat = g["coordinates"]
            elif g["type"] == "MultiLineString":
                flat = [pt for line in g["coordinates"] for pt in line]
            else:
                flat = g["coordinates"][0]
            if not any(in_bounds(c[1], c[0]) for c in flat[:: max(1, len(flat)//20)]):
                continue
            geometries[pid].append({
                "geometry": g,
                "precision": pick(r, "location_precision"),
                "certainty": pick(r, "association_certainty"),
                "description": clean_text(pick(r, "description"), 180),
                "provenance": clean_text(pick(r, "provenance"), 180),
            })

    records = []
    for r in rows(data["places.csv"]):
        pid = pick(r, "id", "place_id")
        lat = as_float(pick(r, "representative_latitude", "latitude", "lat"))
        lon = as_float(pick(r, "representative_longitude", "longitude", "lon", "lng"))
        if not pid or not in_bounds(lat, lon):
            continue
        uri = pick(r, "uri") or f"https://pleiades.stoa.org/places/{pid}"
        title = compact_name(pick(r, "title", "name")) or f"Pleiades {pid}"
        desc = clean_text(pick(r, "description"), 420)
        details = clean_text(pick(r, "details"), 300)
        provenance = clean_text(pick(r, "provenance"), 220)
        precision = pick(r, "location_precision") or "belirtilmemiş"
        ptypes = place_types.get(pid, [])
        time_text = " ".join(
            [
                pick(r, "time_periods", "time_period", "periods"),
                pick(r, "start_date"), pick(r, "end_date"),
                " ".join(name_period_text.get(pid, [])),
            ]
        )
        whole = " ".join([title, desc, details, provenance, " ".join(ptypes), time_text])
        kind = classify(whole, geometries.get(pid))
        ps = periods(whole)
        aliases = [n for n in alt_names.get(pid, []) if n.casefold() != title.casefold()][:10]
        acc = accuracy.get(pid, {})
        ginfo = geometries.get(pid, [])
        geometry = None
        if ginfo:
            ordered = sorted(ginfo, key=lambda x: 0 if (kind == "Yol" and x["geometry"]["type"] in ("LineString", "MultiLineString")) else 1)
            geometry = ordered[0]["geometry"]
        rec = {
            "id": f"pleiades:{source_id(uri, pid)}",
            "name": title,
            "altNames": aliases,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "kind": kind,
            "periods": ps,
            "dateLabel": clean_text(time_text, 180),
            "evidence": "Gazetteer",
            "source": "Pleiades",
            "sourceUrl": uri,
            "description": desc or details,
            "placeTypes": ptypes[:8],
            "precision": precision,
            "accuracyMinM": acc.get("min"),
            "accuracyMaxM": acc.get("max"),
            "provenance": provenance,
        }
        if geometry:
            rec["geometry"] = geometry
        records.append(rec)

    records.sort(key=lambda x: (x["lat"], x["lon"], x["name"]))
    by_kind = defaultdict(int)
    by_period = defaultdict(int)
    for x in records:
        by_kind[x["kind"]] += 1
        for p in x["periods"]:
            by_period[p] += 1

    payload = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "coverage": {"minLon": MIN_LON, "maxLon": MAX_LON, "minLat": MIN_LAT, "maxLat": MAX_LAT},
        "license": "Pleiades contributors, CC BY 3.0",
        "source": "Pleiades GIS export (pleiades.datasets main)",
        "recordCount": len(records),
        "countsByKind": dict(sorted(by_kind.items())),
        "countsByPeriod": dict(sorted(by_period.items())),
        "records": records,
    }
    if len(records) < 500:
        raise RuntimeError(f"Beklenenden az Pleiades kaydı üretildi ({len(records)}). Boş/demo APK oluşturulmadı.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT}: {len(records)} kaynaklı kayıt, {OUT.stat().st_size/1024/1024:.1f} MB")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"VERİ DERLEME HATASI: {exc}", file=sys.stderr)
        sys.exit(2)
