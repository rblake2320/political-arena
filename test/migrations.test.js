import { describe, expect, it } from 'vitest';
import { runRuntimeMigrations } from '../src/db.js';

function createFakeD1({ users, adFlights, challenges, recites }) {
  const userColumns = new Set(users);
  const adColumns = new Set(adFlights);
  const challengeColumns = new Set(challenges);
  const reciteColumns = new Set(recites);
  const executed = [];

  const db = {
    prepare(sql) {
      return {
        sql,
        all: async () => {
          if (sql === 'PRAGMA table_info(users)') {
            return { results: Array.from(userColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(ad_flights)') {
            return { results: Array.from(adColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(challenges)') {
            return { results: Array.from(challengeColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(recites)') {
            return { results: Array.from(reciteColumns).map(name => ({ name })) };
          }
          return { results: [] };
        },
      };
    },
    batch: async (statements) => {
      for (const statement of statements) {
        executed.push(statement.sql);
        const userMatch = statement.sql.match(/^ALTER TABLE users ADD COLUMN (\w+)/);
        if (userMatch) userColumns.add(userMatch[1]);
        const adMatch = statement.sql.match(/^ALTER TABLE ad_flights ADD COLUMN (\w+)/);
        if (adMatch) adColumns.add(adMatch[1]);
        const challengeMatch = statement.sql.match(/^ALTER TABLE challenges ADD COLUMN (\w+)/);
        if (challengeMatch) challengeColumns.add(challengeMatch[1]);
        const reciteMatch = statement.sql.match(/^ALTER TABLE recites ADD COLUMN (\w+)/);
        if (reciteMatch) reciteColumns.add(reciteMatch[1]);
      }
      return statements.map(() => ({ success: true }));
    },
    userColumns,
    adColumns,
    challengeColumns,
    reciteColumns,
    executed,
  };

  return db;
}

describe('runtime migrations', () => {
  it('adds runtime columns to older tables and is idempotent', async () => {
    const db = createFakeD1({
      users: [
        'id',
        'email',
        'username',
        'display_name',
        'password_hash',
        'role',
        'email_verified',
        'verification_token',
      ],
      adFlights: [
        'id',
        'race_id',
        'candidate_id',
        'created_by',
        'title',
        'media_url',
        'media_type',
        'ad_content_text',
        'disclaimer_text',
      ],
      challenges: [
        'id',
        'race_id',
        'challenger_candidate_id',
        'target_candidate_id',
        'created_by',
        'challenge_text',
        'media_url',
        'challenge_type',
        'status',
        'deadline_business_days',
        'response_deadline',
      ],
      recites: [
        'id',
        'content_type',
        'content_id',
        'user_id',
        'url',
        'title',
        'publisher',
        'source_type',
        'stance',
        'claim_text',
        'quote',
        'status',
      ],
    });

    await runRuntimeMigrations(db);

    expect(db.userColumns.has('password_reset_token_hash')).toBe(true);
    expect(db.userColumns.has('password_reset_expires_at')).toBe(true);
    expect(db.adColumns.has('source_type')).toBe(true);
    expect(db.adColumns.has('source_url')).toBe(true);
    expect(db.adColumns.has('source_label')).toBe(true);
    expect(db.adColumns.has('posted_for_rebuttal_by')).toBe(true);
    expect(db.challengeColumns.has('claim_text')).toBe(true);
    expect(db.challengeColumns.has('public_receipt_slug')).toBe(true);
    expect(db.reciteColumns.has('archive_url')).toBe(true);
    expect(db.reciteColumns.has('review_note')).toBe(true);
    expect(db.executed).toEqual([
      'ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT',
      'ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT',
      "ALTER TABLE ad_flights ADD COLUMN source_type TEXT NOT NULL DEFAULT 'platform'",
      'ALTER TABLE ad_flights ADD COLUMN source_url TEXT',
      'ALTER TABLE ad_flights ADD COLUMN source_label TEXT',
      'ALTER TABLE ad_flights ADD COLUMN posted_for_rebuttal_by TEXT REFERENCES candidates(id)',
      'ALTER TABLE challenges ADD COLUMN claim_text TEXT',
      'ALTER TABLE challenges ADD COLUMN dispute_summary TEXT',
      'ALTER TABLE challenges ADD COLUMN requested_response TEXT',
      'ALTER TABLE challenges ADD COLUMN public_receipt_slug TEXT',
      'ALTER TABLE recites ADD COLUMN source_published_at TEXT',
      'ALTER TABLE recites ADD COLUMN accessed_at TEXT',
      'ALTER TABLE recites ADD COLUMN archive_url TEXT',
      'ALTER TABLE recites ADD COLUMN evidence_media_url TEXT',
      'ALTER TABLE recites ADD COLUMN review_note TEXT',
    ]);

    db.executed.length = 0;
    await runRuntimeMigrations(db);

    expect(db.executed).toEqual([]);
  });
});
