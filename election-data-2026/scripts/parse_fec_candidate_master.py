#!/usr/bin/env python3
"""
Build a 2026 U.S. House/Senate candidate roster from FEC data.

Primary input: FEC Candidate Master bulk file.
Fallback input: OpenFEC candidates/search API.

The parser intentionally keeps the official FEC candidate name as candidate_name.
It also creates normalized search fields for app/database lookup.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from typing import Dict, Iterable, List

FIELDS = [
    "CAND_ID",
    "CAND_NAME",
    "CAND_PTY_AFFILIATION",
    "CAND_ELECTION_YR",
    "CAND_OFFICE_ST",
    "CAND_OFFICE",
    "CAND_OFFICE_DISTRICT",
    "CAND_ICI",
    "CAND_STATUS",
    "CAND_PCC",
    "CAND_ST1",
    "CAND_ST2",
    "CAND_CITY",
    "CAND_ST",
    "CAND_ZIP",
]

STATE_50 = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
}

OFFICE_MAP = {"H": "U.S. House", "S": "U.S. Senate"}

STATUS_MAP = {
    "C": "Present candidate",
    "F": "Future candidate",
    "N": "Not yet a candidate",
    "P": "Prior candidate",
}

ICI_MAP = {"I": "Incumbent", "C": "Challenger", "O": "Open seat"}

# Common FEC party abbreviations. Unknown codes are preserved as-is.
PARTY_MAP = {
    "ACE": "Ace Party",
    "AKI": "Alaskan Independence Party",
    "AIC": "American Independent Conservative",
    "AIP": "American Independent Party",
    "AMP": "American Party",
    "APF": "American People's Freedom Party",
    "APP": "American Patriot Party",
    "ASP": "American Solidarity Party",
    "BFP": "Better for America Party",
    "BYP": "Better for Philadelphia Party",
    "CC": "Constitutional Conservative",
    "CCC": "Constitution Party",
    "CON": "Constitution Party",
    "CST": "Constitutional",
    "D": "Democratic Party",
    "DEM": "Democratic Party",
    "DFL": "Democratic-Farmer-Labor Party",
    "FED": "Federalist",
    "FRE": "Freedom Party",
    "GOP": "Republican Party",
    "GRE": "Green Party",
    "GRN": "Green Party",
    "I": "Independent",
    "IND": "Independent",
    "IP": "Independent Party",
    "JCN": "Justice For All Party",
    "LBL": "Liberal Party",
    "LIB": "Libertarian Party",
    "LBT": "Libertarian Party",
    "N": "Nonpartisan",
    "NOP": "No Party Affiliation",
    "NPA": "No Party Affiliation",
    "NPP": "No Party Preference",
    "OTH": "Other",
    "PAG": "Pacific Green Party",
    "POP": "People Over Politics Party",
    "PRO": "Progressive Party",
    "R": "Republican Party",
    "REF": "Reform Party",
    "REP": "Republican Party",
    "RTL": "Right to Life Party",
    "SOC": "Socialist Party",
    "SWP": "Socialist Workers Party",
    "TEA": "Tea Party",
    "UNK": "Unknown",
    "UST": "U.S. Taxpayers Party",
    "W": "Write-In",
    "WFP": "Working Families Party",
}

BULK_SOURCE_URL = "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip"
BULK_SOURCE_NAME = "FEC 2026 Candidate Master"
API_SOURCE_URL = "https://api.open.fec.gov/v1/candidates/search/?election_year=2026&office=H,S"
API_SOURCE_NAME = "OpenFEC candidates/search API"
BALLOT_STATUS = "FEC-registered/FEC-listed; not state ballot certified by this dataset"


def clean_cell(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\x00", " ").strip().split())


def normalize_search(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def compact_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", normalize_search(value))


def district_value(office_code: str, state: str, district_raw: str) -> str:
    d = clean_cell(district_raw).upper()
    if office_code == "S":
        return f"{state}-SENATE"
    if d in {"", "0", "00", "000", "AL", "AT-LARGE", "AT LARGE"}:
        return f"{state}-AL"
    if d.isdigit():
        return f"{state}-{int(d):02d}"
    return f"{state}-{d}"


def race_key(cycle: str, office_code: str, state: str, district: str) -> str:
    suffix = district.split("-", 1)[1] if "-" in district else district
    return f"{cycle}-{office_code}-{state}-{suffix}"


def row_to_dict(row: List[str]) -> Dict[str, str]:
    padded = list(row) + [""] * max(0, len(FIELDS) - len(row))
    return {field: clean_cell(padded[i]) for i, field in enumerate(FIELDS)}


def base_candidate_record(
    *,
    cycle: str,
    office_code: str,
    state: str,
    district_raw: str,
    name: str,
    party_code: str,
    party_full: str,
    fec_id: str,
    status_code: str,
    ici_code: str,
    source_name: str,
    source_url: str,
    verified_utc: str,
) -> Dict[str, str] | None:
    cycle = clean_cell(cycle)
    state = clean_cell(state).upper()
    office_code = clean_cell(office_code).upper()
    name = clean_cell(name)
    party_code = clean_cell(party_code).upper()
    party_full = clean_cell(party_full)
    status_code = clean_cell(status_code).upper()
    ici_code = clean_cell(ici_code).upper()
    fec_id = clean_cell(fec_id)

    if cycle != "2026":
        return None
    if office_code not in {"H", "S"}:
        return None
    if state not in STATE_50:
        return None
    if not name:
        return None

    district = district_value(office_code, state, district_raw)
    return {
        "candidate_uid": f"fec:{fec_id}" if fec_id else f"fec-name:{compact_key(name)}:{cycle}:{office_code}:{state}:{district}",
        "cycle": cycle,
        "office_code": office_code,
        "office": OFFICE_MAP.get(office_code, office_code),
        "state": state,
        "district": district,
        "race_key": race_key(cycle, office_code, state, district),
        "candidate_name": name,
        "candidate_name_search": normalize_search(name),
        "candidate_name_key": compact_key(name),
        "party_code": party_code,
        "party": party_full or PARTY_MAP.get(party_code, party_code or "Unknown"),
        "fec_candidate_id": fec_id,
        "candidate_status_code": status_code,
        "candidate_status": STATUS_MAP.get(status_code, status_code or "Unknown"),
        "incumbent_challenger_open_code": ici_code,
        "incumbent_challenger_open": ICI_MAP.get(ici_code, ici_code or "Unknown"),
        "ballot_status": BALLOT_STATUS,
        "source_name": source_name,
        "source_url": source_url,
        "last_verified_utc": verified_utc,
    }


def load_candidate_rows(path: str) -> Iterable[Dict[str, str]]:
    # FEC bulk files are usually pipe-delimited and commonly latin-1/Windows-1252 compatible text.
    with open(path, "r", encoding="latin-1", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        delimiter = "|" if sample.count("|") >= sample.count(",") else ","
        reader = csv.reader(f, delimiter=delimiter)
        for raw in reader:
            if not raw or all(not clean_cell(x) for x in raw):
                continue
            if clean_cell(raw[0]).upper() in {"CAND_ID", "CANDIDATE_ID"}:
                continue
            yield row_to_dict(raw)


def transform_bulk_candidate(src: Dict[str, str], verified_utc: str) -> Dict[str, str] | None:
    return base_candidate_record(
        cycle=src.get("CAND_ELECTION_YR", ""),
        office_code=src.get("CAND_OFFICE", ""),
        state=src.get("CAND_OFFICE_ST", ""),
        district_raw=src.get("CAND_OFFICE_DISTRICT", ""),
        name=src.get("CAND_NAME", ""),
        party_code=src.get("CAND_PTY_AFFILIATION", ""),
        party_full="",
        fec_id=src.get("CAND_ID", ""),
        status_code=src.get("CAND_STATUS", ""),
        ici_code=src.get("CAND_ICI", ""),
        source_name=BULK_SOURCE_NAME,
        source_url=BULK_SOURCE_URL,
        verified_utc=verified_utc,
    )


def transform_api_candidate(src: Dict, verified_utc: str) -> Dict[str, str] | None:
    return base_candidate_record(
        cycle="2026",
        office_code=src.get("office", ""),
        state=src.get("state", ""),
        district_raw=src.get("district", ""),
        name=src.get("name") or src.get("candidate_name") or "",
        party_code=src.get("party") or src.get("party_code") or "",
        party_full=src.get("party_full") or "",
        fec_id=src.get("candidate_id") or src.get("candidate_id_full") or "",
        status_code=src.get("candidate_status") or "",
        ici_code=src.get("incumbent_challenge") or "",
        source_name=API_SOURCE_NAME,
        source_url=API_SOURCE_URL,
        verified_utc=verified_utc,
    )


def http_json(url: str, retries: int = 5) -> Dict:
    last_error = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": "candidate-db-loader/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            last_error = f"HTTP {e.code}: {body}"
            if e.code in {429, 500, 502, 503, 504}:
                time.sleep(min(30, 2 ** attempt))
                continue
            raise RuntimeError(last_error)
        except Exception as e:
            last_error = str(e)
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"Failed API request after {retries} attempts: {last_error}")


def fetch_api_candidates(api_key: str, include_all_statuses: bool, request_delay_ms: int, verified_utc: str) -> List[Dict[str, str]]:
    base = "https://api.open.fec.gov/v1/candidates/search/"
    rows: List[Dict[str, str]] = []
    for office_code in ["H", "S"]:
        page = 1
        while True:
            params = [
                ("api_key", api_key),
                ("election_year", "2026"),
                ("office", office_code),
                ("per_page", "100"),
                ("sort", "name"),
                ("page", str(page)),
            ]
            if not include_all_statuses:
                params.extend([("candidate_status", "C"), ("candidate_status", "F")])
            url = base + "?" + urllib.parse.urlencode(params)
            data = http_json(url)
            results = data.get("results", []) or []
            for item in results:
                transformed = transform_api_candidate(item, verified_utc)
                if transformed is not None:
                    rows.append(transformed)
            pagination = data.get("pagination", {}) or {}
            pages = int(pagination.get("pages") or 0)
            count = int(pagination.get("count") or 0)
            if not results or (pages and page >= pages):
                break
            if not pages and len(results) < 100:
                break
            page += 1
            if request_delay_ms > 0:
                time.sleep(request_delay_ms / 1000.0)
        print(f"Fetched OpenFEC office={office_code}; current rows={len(rows)}", file=sys.stderr)
    return rows


def write_csv(path: str, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_sqlite(path: str, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    if os.path.exists(path):
        os.remove(path)
    con = sqlite3.connect(path)
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA foreign_keys=ON;")
        con.execute(
            """
            CREATE TABLE candidates (
                candidate_uid TEXT PRIMARY KEY,
                cycle INTEGER NOT NULL,
                office_code TEXT NOT NULL,
                office TEXT NOT NULL,
                state TEXT NOT NULL,
                district TEXT NOT NULL,
                race_key TEXT NOT NULL,
                candidate_name TEXT NOT NULL,
                candidate_name_search TEXT NOT NULL,
                candidate_name_key TEXT NOT NULL,
                party_code TEXT,
                party TEXT,
                fec_candidate_id TEXT,
                candidate_status_code TEXT,
                candidate_status TEXT,
                incumbent_challenger_open_code TEXT,
                incumbent_challenger_open TEXT,
                ballot_status TEXT NOT NULL,
                source_name TEXT NOT NULL,
                source_url TEXT NOT NULL,
                last_verified_utc TEXT NOT NULL
            );
            """
        )
        placeholders = ",".join(["?"] * len(fieldnames))
        quoted = ",".join(fieldnames)
        con.executemany(
            f"INSERT OR REPLACE INTO candidates ({quoted}) VALUES ({placeholders})",
            [[row.get(field, "") for field in fieldnames] for row in rows],
        )
        con.execute("CREATE UNIQUE INDEX idx_candidates_fec_id ON candidates(fec_candidate_id) WHERE fec_candidate_id IS NOT NULL AND fec_candidate_id <> '';")
        con.execute("CREATE INDEX idx_candidates_race ON candidates(cycle, office_code, state, district, party_code);")
        con.execute("CREATE INDEX idx_candidates_name_search ON candidates(candidate_name_search);")
        con.execute("CREATE INDEX idx_candidates_name_key ON candidates(candidate_name_key);")
        con.execute("CREATE INDEX idx_candidates_party ON candidates(party_code, party);")
        con.commit()
    finally:
        con.close()


def dedupe(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen = set()
    out = []
    for row in rows:
        uid = row["candidate_uid"]
        if uid in seen:
            continue
        seen.add(uid)
        out.append(row)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Path to extracted FEC Candidate Master .txt/.csv file")
    parser.add_argument("--outdir", required=True, help="Output directory")
    parser.add_argument("--include-prior-or-notyet", action="store_true", help="Do not filter candidate_status to C/F")
    parser.add_argument("--api-only", action="store_true", help="Use OpenFEC API instead of bulk file")
    parser.add_argument("--api-key", default="DEMO_KEY", help="OpenFEC API key; DEMO_KEY works but is rate limited")
    parser.add_argument("--request-delay-ms", type=int, default=250, help="Delay between API requests")
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    verified_utc = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

    if args.api_only:
        all_rows = fetch_api_candidates(args.api_key, args.include_prior_or_notyet, args.request_delay_ms, verified_utc)
        source_mode = "api"
    else:
        if not args.input:
            raise SystemExit("--input is required unless --api-only is used")
        source_mode = "bulk"
        all_rows = []
        for raw in load_candidate_rows(args.input):
            transformed = transform_bulk_candidate(raw, verified_utc)
            if transformed is not None:
                all_rows.append(transformed)

    all_rows = dedupe(all_rows)
    active_statuses = {"C", "F"}
    active_rows = [r for r in all_rows if r["candidate_status_code"] in active_statuses]
    selected_rows = all_rows if args.include_prior_or_notyet else active_rows

    full_fields = [
        "candidate_uid", "cycle", "office_code", "office", "state", "district", "race_key",
        "candidate_name", "candidate_name_search", "candidate_name_key", "party_code", "party",
        "fec_candidate_id", "candidate_status_code", "candidate_status",
        "incumbent_challenger_open_code", "incumbent_challenger_open",
        "ballot_status", "source_name", "source_url", "last_verified_utc",
    ]
    minimal_fields = ["candidate_name", "district", "party", "party_code", "state", "office", "race_key", "source_name", "source_url"]

    all_path = os.path.join(args.outdir, "congress_candidates_2026_fec_all_statuses.csv")
    active_path = os.path.join(args.outdir, "congress_candidates_2026_fec_active.csv")
    selected_path = os.path.join(args.outdir, "congress_candidates_2026_fec_selected.csv")
    minimal_path = os.path.join(args.outdir, "congress_candidates_2026_minimal.csv")
    sqlite_path = os.path.join(args.outdir, "congress_candidates_2026_fec.sqlite")
    manifest_path = os.path.join(args.outdir, "manifest.json")

    write_csv(all_path, all_rows, full_fields)
    write_csv(active_path, active_rows, full_fields)
    write_csv(selected_path, selected_rows, full_fields)
    write_csv(minimal_path, selected_rows, minimal_fields)
    write_sqlite(sqlite_path, selected_rows, full_fields)

    counts_by_office = Counter(r["office"] for r in selected_rows)
    counts_by_state = Counter(r["state"] for r in selected_rows)
    counts_by_party = Counter(r["party_code"] or "UNKNOWN" for r in selected_rows)
    counts_by_status = Counter(r["candidate_status_code"] or "UNKNOWN" for r in all_rows)

    manifest = {
        "generated_utc": verified_utc,
        "source_mode": source_mode,
        "source_names": sorted({r["source_name"] for r in all_rows}) if all_rows else [],
        "source_urls": sorted({r["source_url"] for r in all_rows}) if all_rows else [],
        "cycle": 2026,
        "scope": "U.S. House and U.S. Senate candidates for the 50 states only",
        "ballot_certification_warning": BALLOT_STATUS,
        "default_filter": "candidate_status_code in ['C','F'] unless --include-prior-or-notyet is used",
        "row_counts": {
            "all_statuses": len(all_rows),
            "active_selected": len(selected_rows),
            "active_C_or_F": len(active_rows),
        },
        "counts_by_office": dict(sorted(counts_by_office.items())),
        "counts_by_state": dict(sorted(counts_by_state.items())),
        "counts_by_party_code": dict(sorted(counts_by_party.items())),
        "counts_by_status_all_rows": dict(sorted(counts_by_status.items())),
        "outputs": {
            "all_statuses_csv": all_path,
            "active_csv": active_path,
            "selected_csv": selected_path,
            "minimal_csv": minimal_path,
            "sqlite": sqlite_path,
        },
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)

    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
