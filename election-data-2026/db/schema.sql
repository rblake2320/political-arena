-- 2026 Congressional Candidates database schema
-- Source-first design: every candidate row must retain source_name, source_url, and last_verified_utc.
-- FEC Candidate Master rows are federal filing/listing records, not guaranteed state-certified ballot records.

CREATE TABLE IF NOT EXISTS candidates (
    candidate_uid TEXT PRIMARY KEY,
    cycle INTEGER NOT NULL,
    office_code TEXT NOT NULL CHECK (office_code IN ('H','S')),
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_fec_id
ON candidates(fec_candidate_id)
WHERE fec_candidate_id IS NOT NULL AND fec_candidate_id <> '';

CREATE INDEX IF NOT EXISTS idx_candidates_race
ON candidates(cycle, office_code, state, district, party_code);

CREATE INDEX IF NOT EXISTS idx_candidates_name_search
ON candidates(candidate_name_search);

CREATE INDEX IF NOT EXISTS idx_candidates_name_key
ON candidates(candidate_name_key);

CREATE INDEX IF NOT EXISTS idx_candidates_party
ON candidates(party_code, party);

-- Recommended event table for the next layer.
-- Fill from state election offices / FEC election calendar / Green Papers event tracker.
CREATE TABLE IF NOT EXISTS election_events (
    event_uid TEXT PRIMARY KEY,
    cycle INTEGER NOT NULL,
    state TEXT NOT NULL,
    office_code TEXT NOT NULL CHECK (office_code IN ('H','S')),
    district TEXT NOT NULL,
    race_key TEXT NOT NULL,
    event_date TEXT NOT NULL, -- ISO date: YYYY-MM-DD
    event_type TEXT NOT NULL, -- primary, runoff, special_primary, special_general, general, etc.
    is_special INTEGER NOT NULL DEFAULT 0 CHECK (is_special IN (0,1)),
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    last_verified_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_election_events_race_date
ON election_events(race_key, event_date, event_type);
