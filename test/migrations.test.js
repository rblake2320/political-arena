import { describe, expect, it } from 'vitest';
import { runRuntimeMigrations } from '../src/db.js';

function createFakeD1({ users, adFlights, challenges, recites, issueCategories, auditLog }) {
  const userColumns = new Set(users);
  const adColumns = new Set(adFlights);
  const challengeColumns = new Set(challenges);
  const reciteColumns = new Set(recites);
  const issueCategoryColumns = new Set(issueCategories);
  const auditColumns = new Set(auditLog);
  const auditIndexes = new Set();
  const surveyResponseIndexes = new Set();
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
          if (sql === 'PRAGMA table_info(issue_categories)') {
            return { results: Array.from(issueCategoryColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(audit_log)') {
            return { results: Array.from(auditColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA index_list(audit_log)') {
            return { results: Array.from(auditIndexes).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA index_list(voter_survey_responses)') {
            return { results: Array.from(surveyResponseIndexes).map(name => ({ name })) };
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
        const issueCategoryMatch = statement.sql.match(/^ALTER TABLE issue_categories ADD COLUMN (\w+)/);
        if (issueCategoryMatch) issueCategoryColumns.add(issueCategoryMatch[1]);
        const auditMatch = statement.sql.match(/^ALTER TABLE audit_log ADD COLUMN (\w+)/);
        if (auditMatch) auditColumns.add(auditMatch[1]);
        const auditIndexMatch = statement.sql.match(/^CREATE UNIQUE INDEX IF NOT EXISTS (idx_audit_\w+)/);
        if (auditIndexMatch) auditIndexes.add(auditIndexMatch[1]);
        const surveyResponseIndexMatch = statement.sql.match(/^CREATE UNIQUE INDEX IF NOT EXISTS (idx_vsr_\w+)/);
        if (surveyResponseIndexMatch) surveyResponseIndexes.add(surveyResponseIndexMatch[1]);
      }
      return statements.map(() => ({ success: true }));
    },
    userColumns,
    adColumns,
    challengeColumns,
    reciteColumns,
    issueCategoryColumns,
    auditColumns,
    auditIndexes,
    surveyResponseIndexes,
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
      issueCategories: [
        'id',
        'name',
        'slug',
        'description',
        'icon',
        'display_order',
        'is_active',
      ],
      auditLog: [
        'id',
        'actor_id',
        'actor_type',
        'action',
        'entity_type',
        'entity_id',
        'before_state',
        'after_state',
        'metadata',
        'ip_address',
        'created_at',
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
    expect(db.issueCategoryColumns.has('parent_category_id')).toBe(true);
    expect(db.auditColumns.has('prev_hash')).toBe(true);
    expect(db.auditColumns.has('entry_hash')).toBe(true);
    expect(db.auditColumns.has('chain_seq')).toBe(true);
    expect(db.auditIndexes.has('idx_audit_entity_seq_unique')).toBe(true);
    expect(db.auditIndexes.has('idx_audit_entity_prev_hash_unique')).toBe(true);
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
      'ALTER TABLE issue_categories ADD COLUMN parent_category_id TEXT REFERENCES issue_categories(id)',
      'ALTER TABLE audit_log ADD COLUMN prev_hash TEXT',
      'ALTER TABLE audit_log ADD COLUMN entry_hash TEXT',
      'ALTER TABLE audit_log ADD COLUMN chain_seq INTEGER',
      `WITH ranked AS (
         SELECT pending.id,
                COALESCE((
                  SELECT MAX(existing.chain_seq)
                  FROM audit_log existing
                  WHERE existing.entity_type = pending.entity_type
                    AND existing.entity_id = pending.entity_id
                    AND existing.chain_seq IS NOT NULL
                ), 0) + ROW_NUMBER() OVER (
                  PARTITION BY pending.entity_type, pending.entity_id
                  ORDER BY pending.created_at ASC, pending.id ASC
                ) AS seq
         FROM audit_log pending
         WHERE pending.chain_seq IS NULL
       )
       UPDATE audit_log
       SET chain_seq = (SELECT seq FROM ranked WHERE ranked.id = audit_log.id)
       WHERE id IN (SELECT id FROM ranked)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_entity_seq_unique
       ON audit_log(entity_type, entity_id, chain_seq)
       WHERE chain_seq IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_entity_prev_hash_unique
       ON audit_log(entity_type, entity_id, prev_hash)
       WHERE chain_seq IS NOT NULL AND entry_hash IS NOT NULL AND prev_hash IS NOT NULL`,
      `DELETE FROM voter_survey_responses
         WHERE rowid NOT IN (
           SELECT MIN(rowid)
           FROM voter_survey_responses
           GROUP BY user_id, survey_id, question_id
         )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_vsr_user_survey_question
         ON voter_survey_responses(user_id, survey_id, question_id)`,
    ]);

    db.executed.length = 0;
    await runRuntimeMigrations(db);

    expect(db.executed).toEqual([]);
  });
});
