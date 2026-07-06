#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

const FEC_COLUMNS = [
  'cand_id',
  'cand_name',
  'party',
  'election_year',
  'office_state',
  'office',
  'office_district',
  'incumbent_challenger_open_seat',
  'status',
  'principal_committee_id',
  'street_1',
  'street_2',
  'city',
  'state',
  'zip',
];

const DEFAULT_SOURCE = 'data/sources/cn26.txt';
const DEFAULT_MANIFEST = 'data/sources/manifest.json';
const DEFAULT_OUT = 'data/generated/fec-2026-federal-races.sql';
const FEDERAL_OFFICES = new Set(['H', 'S']);
const DEFAULT_STATUSES = new Set(['C', 'F']);

const PARTY_LABELS = {
  DEM: 'Democrat',
  REP: 'Republican',
  IND: 'Independent',
  LIB: 'Libertarian',
  GRE: 'Green',
  NPA: 'No Party Affiliation',
  NON: 'Nonpartisan',
  UNK: 'Unknown',
};

function usage() {
  return `Usage: node scripts/prepare-fec-2026-loader.mjs [options]

Options:
  --source <path>          FEC cn26.txt source path. Default: ${DEFAULT_SOURCE}
  --manifest <path>        Source manifest path. Default: ${DEFAULT_MANIFEST}
  --out <path>             SQL output path. Default: ${DEFAULT_OUT}
  --cycle <year>           Election cycle filter. Default: 2026
  --status <codes>         Comma-separated FEC statuses. Default: C,F
  --race-status <status>   Race status to write. Default: upcoming
  --include-candidates     Also emit unclaimed candidate directory rows.
  --dry-run                Parse and print counts without writing SQL.
  --help                   Show this help.

This script never executes SQL. Apply output manually with wrangler d1 execute after review.`;
}

function parseArgs(argv) {
  const args = {
    source: DEFAULT_SOURCE,
    manifest: DEFAULT_MANIFEST,
    out: DEFAULT_OUT,
    cycle: '2026',
    statuses: new Set(DEFAULT_STATUSES),
    raceStatus: 'upcoming',
    includeCandidates: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      args.help = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--include-candidates') {
      args.includeCandidates = true;
    } else if (arg === '--source') {
      args.source = argv[++i];
    } else if (arg === '--manifest') {
      args.manifest = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (arg === '--cycle') {
      args.cycle = argv[++i];
    } else if (arg === '--status') {
      args.statuses = new Set((argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg === '--race-status') {
      args.raceStatus = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseFecLine(line) {
  const fields = line.split('|');
  return FEC_COLUMNS.reduce((row, key, index) => {
    row[key] = fields[index] || '';
    return row;
  }, {});
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeDistrict(office, district) {
  if (office === 'S') return '';
  const trimmed = String(district || '').trim();
  if (!trimmed) return '00';
  return trimmed.padStart(2, '0');
}

function raceIdFor(row) {
  const state = row.office_state.toUpperCase();
  const district = normalizeDistrict(row.office, row.office_district);
  return row.office === 'S'
    ? `race-${row.election_year}-${state}-S`
    : `race-${row.election_year}-${state}-H-${district}`;
}

function raceNameFor(row) {
  const state = row.office_state.toUpperCase();
  if (row.office === 'S') return `${row.election_year} ${state} Senate Race`;
  const district = normalizeDistrict(row.office, row.office_district);
  const districtLabel = district === '00' ? 'At-Large' : `District ${district}`;
  return `${row.election_year} ${state} ${districtLabel} House Race`;
}

function officeLabel(office) {
  if (office === 'S') return 'Senate';
  if (office === 'H') return 'House';
  return 'Other';
}

function normalizeParty(party) {
  const code = String(party || '').trim().toUpperCase();
  return PARTY_LABELS[code] || code || 'Unknown';
}

function candidateIdFor(row) {
  return `cand-fec-${row.cand_id.toLowerCase()}`;
}

function parseFederalFecRows(text, { cycle = '2026', statuses = DEFAULT_STATUSES } = {}) {
  const races = new Map();
  const candidates = [];
  const skipped = {
    missing_required: 0,
    wrong_cycle: 0,
    wrong_office: 0,
    wrong_status: 0,
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const row = parseFecLine(line);
    if (!row.cand_id || !row.cand_name || !row.election_year) {
      skipped.missing_required += 1;
      continue;
    }
    if (row.election_year !== cycle) {
      skipped.wrong_cycle += 1;
      continue;
    }
    if (!FEDERAL_OFFICES.has(row.office)) {
      skipped.wrong_office += 1;
      continue;
    }
    if (!statuses.has(row.status)) {
      skipped.wrong_status += 1;
      continue;
    }

    const raceId = raceIdFor(row);
    if (!races.has(raceId)) {
      races.set(raceId, {
        id: raceId,
        name: raceNameFor(row),
        office: officeLabel(row.office),
        state: row.office_state.toUpperCase(),
        district: normalizeDistrict(row.office, row.office_district),
        jurisdiction_level: 'federal',
        description: `Imported from FEC ${cycle} candidate master; source label fec_registered, not state ballot certification.`,
      });
    }

    candidates.push({
      id: candidateIdFor(row),
      race_id: raceId,
      name: row.cand_name,
      party: normalizeParty(row.party),
      source_status: 'fec_registered',
      source_url: 'https://www.fec.gov/campaign-finance-data/candidate-master-file-description/',
      source_label: 'FEC-registered; not state ballot-certified',
      source_updated_at: null,
      verification_status: 'pending',
      is_active: 1,
    });
  }

  return {
    races: [...races.values()].sort((a, b) => a.id.localeCompare(b.id)),
    candidates: candidates.sort((a, b) => a.id.localeCompare(b.id)),
    skipped,
  };
}

function buildSql({ races, candidates }, { includeCandidates = false, raceStatus = 'upcoming' } = {}) {
  const lines = [
    '-- Generated by scripts/prepare-fec-2026-loader.mjs',
    '-- Source label: fec_registered (NOT state ballot certification)',
    '-- Review before applying. This file is idempotent and uses INSERT OR IGNORE.',
    '',
  ];

  for (const race of races) {
    lines.push(
      `INSERT OR IGNORE INTO races (id, name, office, state, district, jurisdiction_level, status, description) VALUES (${[
        race.id,
        race.name,
        race.office,
        race.state,
        race.district,
        race.jurisdiction_level,
        raceStatus,
        race.description,
      ].map(sqlString).join(', ')});`
    );
  }

  if (includeCandidates) {
    lines.push('', '-- Candidate directory rows are unclaimed FEC registrations, not platform participants.');
    for (const candidate of candidates) {
      lines.push(
        `INSERT OR IGNORE INTO candidates (id, race_id, name, party, source_status, source_url, source_label, source_updated_at, verification_status, is_active) VALUES (${[
          candidate.id,
          candidate.race_id,
          candidate.name,
          candidate.party,
          candidate.source_status,
          candidate.source_url,
          candidate.source_label,
          candidate.source_updated_at,
          candidate.verification_status,
          candidate.is_active,
        ].map(sqlString).join(', ')});`
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

function summarize(parsed) {
  const byOffice = parsed.races.reduce((counts, race) => {
    counts[race.office] = (counts[race.office] || 0) + 1;
    return counts;
  }, {});

  return {
    races: parsed.races.length,
    house_races: byOffice.House || 0,
    senate_races: byOffice.Senate || 0,
    candidates: parsed.candidates.length,
    skipped: parsed.skipped,
  };
}

async function sha256File(path) {
  const [{ createHash }, fs] = await Promise.all([
    import('node:crypto'),
    import('node:fs/promises'),
  ]);
  const data = await fs.readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

async function main() {
  const [fs, path] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const manifest = JSON.parse(await fs.readFile(args.manifest, 'utf8'));
  if (manifest.source_text_sha256) {
    const actual = await sha256File(args.source);
    if (actual !== manifest.source_text_sha256) {
      throw new Error(`Source text hash mismatch for ${args.source}: expected ${manifest.source_text_sha256}, got ${actual}`);
    }
  }

  const source = await fs.readFile(args.source, 'utf8');
  const parsed = parseFederalFecRows(source, { cycle: args.cycle, statuses: args.statuses });
  const summary = summarize(parsed);
  console.log(JSON.stringify(summary, null, 2));

  if (args.dryRun) return;

  const sql = buildSql(parsed, {
    includeCandidates: args.includeCandidates,
    raceStatus: args.raceStatus,
  });
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, sql, 'utf8');
  console.log(`Wrote ${args.out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
  });
}

export {
  buildSql,
  parseFederalFecRows,
  summarize,
};
