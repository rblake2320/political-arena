# 2026 Congressional Candidate Database Loader

This package builds a real, source-backed roster of known 2026 U.S. House and U.S. Senate candidates from FEC data.

It uses the official FEC Candidate Master bulk file first. If that ZIP download is blocked, it can fall back to the OpenFEC `candidates/search` API.

## What it outputs

After running `build_congress_candidates_2026.ps1`, you get:

- `outputs/congress_candidates_2026_fec_selected.csv` — full selected candidate table
- `outputs/congress_candidates_2026_minimal.csv` — requested fields plus minimal app keys
- `outputs/congress_candidates_2026_fec_all_statuses.csv` — all FEC statuses for audit
- `outputs/congress_candidates_2026_fec_active.csv` — FEC candidate statuses `C` and `F`
- `db/congress_candidates_2026_fec.sqlite` — SQLite database with indexes for search
- `manifest.json` — source URL, generation time, row counts, state/party counts, and SHA-256 hashes

## Package layout

```text
election-data-2026/
  sources/fec/
    cn26.zip
    cn.txt
  outputs/
    congress_candidates_2026_fec_selected.csv
    congress_candidates_2026_minimal.csv
    congress_candidates_2026_fec_all_statuses.csv
    congress_candidates_2026_fec_active.csv
  db/
    congress_candidates_2026_fec.sqlite
    schema.sql
  scripts/
    build_congress_candidates_2026.ps1
    parse_fec_candidate_master.py
    validate_candidate_counts.ps1
  manifest.json
  README.md
```

## Run it: bulk-file preferred

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\build_congress_candidates_2026.ps1 -OutDir .\election-data-2026
```

## Run it: API-only fallback

Use this when ZIP downloads are blocked by your network/security tooling.

```powershell
$env:FEC_API_KEY = "YOUR_FEC_API_KEY"   # optional; DEMO_KEY is used if omitted but is rate limited
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\build_congress_candidates_2026.ps1 -OutDir .\election-data-2026 -UseApiOnly
```

## Include every FEC status

Default output keeps FEC status `C` and `F` only. To audit everything, including prior/not-yet-candidate records:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\build_congress_candidates_2026.ps1 -OutDir .\election-data-2026 -IncludePriorOrNotYet
```

## Important data integrity note

FEC Candidate Master and OpenFEC candidate records are federal filing/listing sources. They are not the same as state-certified ballot access. Do not label candidates as ballot-qualified unless your app also ingests official state ballot lists.

Allowed app labels:

- `FEC-registered`
- `FEC-listed`
- `State ballot-certified` only after state source verification
- `Withdrawn`
- `Inactive`
- `Prior-cycle`
- `Exploratory / unverified`

For Political Arena launch, this package is source-of-truth reference data only. It should not create accountability clocks, non-response records, evasion scoring, or public candidate claims unless the candidate has claimed the profile or the platform has a verified served-notice record.

## Validate the package

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\scripts\validate_candidate_counts.ps1
```

The validator checks file hashes from `manifest.json`, row counts in the CSV outputs, active-status filtering, and office totals. It also checks the SQLite candidate count when the `sqlite3` CLI is available; otherwise it still verifies the SQLite file hash.

## Minimal table fields

The minimal CSV contains:

- `candidate_name`
- `district`
- `party`
- `party_code`
- `state`
- `office`
- `race_key`
- `source_name`
- `source_url`

## Search keys

The full CSV and SQLite table include:

- `candidate_name_search` — lowercase, punctuation stripped
- `candidate_name_key` — compact lookup key for fuzzy/exact indexing
- `race_key` — stable race ID like `2026-H-TX-18` or `2026-S-MI-SENATE`

## Next layer for a perfect app database

Add an `election_events` table from official state calendars and/or election tracking sources. Keep candidate records and election-event records separate because a candidate can appear in multiple events: primary, runoff, special primary, special general, and general election.
