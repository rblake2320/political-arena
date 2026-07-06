import { describe, expect, it } from 'vitest';
import { runRuntimeMigrations } from '../src/db.js';

function createFakeD1({
  users,
  candidates = [],
  adFlights,
  challenges,
  recites,
  issueCategories,
  voterWriteins,
  auditLog,
  pressFeedItems = [],
  emailDeliveries = [],
  correctionRequests = [],
  correctionRequestEvents = [],
  statementReviewProposals = [],
  missingChallengeSlug = false,
}) {
  const userColumns = new Set(users);
  const candidateColumns = new Set(candidates);
  const adColumns = new Set(adFlights);
  const challengeColumns = new Set(challenges);
  const reciteColumns = new Set(recites);
  const issueCategoryColumns = new Set(issueCategories);
  const voterWriteinColumns = new Set(voterWriteins);
  const auditColumns = new Set(auditLog);
  const pressFeedColumns = new Set(pressFeedItems);
  const emailDeliveryColumns = new Set(emailDeliveries);
  const correctionRequestColumns = new Set(correctionRequests);
  const correctionEventColumns = new Set(correctionRequestEvents);
  const statementReviewProposalColumns = new Set(statementReviewProposals);
  let hasMissingChallengeSlug = missingChallengeSlug;
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
          if (sql === 'PRAGMA table_info(candidates)') {
            return { results: Array.from(candidateColumns).map(name => ({ name })) };
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
          if (sql === 'PRAGMA table_info(voter_writeins)') {
            return { results: Array.from(voterWriteinColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(audit_log)') {
            return { results: Array.from(auditColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(press_feed_items)') {
            return { results: Array.from(pressFeedColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(email_deliveries)') {
            return { results: Array.from(emailDeliveryColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(correction_requests)') {
            return { results: Array.from(correctionRequestColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(correction_request_events)') {
            return { results: Array.from(correctionEventColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA table_info(statement_review_proposals)') {
            return { results: Array.from(statementReviewProposalColumns).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA index_list(audit_log)') {
            return { results: Array.from(auditIndexes).map(name => ({ name })) };
          }
          if (sql === 'PRAGMA index_list(voter_survey_responses)') {
            return { results: Array.from(surveyResponseIndexes).map(name => ({ name })) };
          }
          return { results: [] };
        },
        first: async () => {
          if (sql === `SELECT id FROM challenges WHERE public_receipt_slug IS NULL OR public_receipt_slug = '' LIMIT 1`) {
            return hasMissingChallengeSlug ? { id: 'legacy-challenge' } : null;
          }
          return null;
        },
      };
    },
    batch: async (statements) => {
      for (const statement of statements) {
        executed.push(statement.sql);
        const userMatch = statement.sql.match(/^ALTER TABLE users ADD COLUMN (\w+)/);
        if (userMatch) userColumns.add(userMatch[1]);
        const candidateMatch = statement.sql.match(/^ALTER TABLE candidates ADD COLUMN (\w+)/);
        if (candidateMatch) candidateColumns.add(candidateMatch[1]);
        const adMatch = statement.sql.match(/^ALTER TABLE ad_flights ADD COLUMN (\w+)/);
        if (adMatch) adColumns.add(adMatch[1]);
        const challengeMatch = statement.sql.match(/^ALTER TABLE challenges ADD COLUMN (\w+)/);
        if (challengeMatch) challengeColumns.add(challengeMatch[1]);
        if (statement.sql === `UPDATE challenges SET public_receipt_slug = id WHERE public_receipt_slug IS NULL OR public_receipt_slug = ''`) {
          hasMissingChallengeSlug = false;
        }
        const reciteMatch = statement.sql.match(/^ALTER TABLE recites ADD COLUMN (\w+)/);
        if (reciteMatch) reciteColumns.add(reciteMatch[1]);
        const issueCategoryMatch = statement.sql.match(/^ALTER TABLE issue_categories ADD COLUMN (\w+)/);
        if (issueCategoryMatch) issueCategoryColumns.add(issueCategoryMatch[1]);
        const voterWriteinMatch = statement.sql.match(/^ALTER TABLE voter_writeins ADD COLUMN (\w+)/);
        if (voterWriteinMatch) voterWriteinColumns.add(voterWriteinMatch[1]);
        const auditMatch = statement.sql.match(/^ALTER TABLE audit_log ADD COLUMN (\w+)/);
        if (auditMatch) auditColumns.add(auditMatch[1]);
        const auditIndexMatch = statement.sql.match(/^CREATE UNIQUE INDEX IF NOT EXISTS (idx_audit_\w+)/);
        if (auditIndexMatch) auditIndexes.add(auditIndexMatch[1]);
        const surveyResponseIndexMatch = statement.sql.match(/^CREATE UNIQUE INDEX IF NOT EXISTS (idx_vsr_\w+)/);
        if (surveyResponseIndexMatch) surveyResponseIndexes.add(surveyResponseIndexMatch[1]);
        if (statement.sql.startsWith('CREATE TABLE IF NOT EXISTS press_feed_items')) {
          pressFeedColumns.add('id');
        }
        if (statement.sql.startsWith('CREATE TABLE IF NOT EXISTS email_deliveries')) {
          emailDeliveryColumns.add('id');
        }
        if (statement.sql.startsWith('CREATE TABLE IF NOT EXISTS correction_requests')) {
          [
            'id',
            'requester_id',
            'content_type',
            'content_id',
            'candidate_id',
            'reason',
            'requested_change',
            'evidence_url',
            'status',
            'reviewed_by',
            'reviewed_at',
            'resolution_note',
            'public_note',
            'created_at',
            'updated_at',
          ].forEach(column => correctionRequestColumns.add(column));
        }
        if (statement.sql.startsWith('CREATE TABLE IF NOT EXISTS correction_request_events')) {
          [
            'id',
            'correction_request_id',
            'actor_id',
            'event_type',
            'before_status',
            'after_status',
            'note',
            'public_note',
            'metadata',
            'created_at',
          ].forEach(column => correctionEventColumns.add(column));
        }
        if (statement.sql.startsWith('CREATE TABLE IF NOT EXISTS statement_review_proposals')) {
          [
            'id',
            'statement_id',
            'reviewer_id',
            'truth_status',
            'answer_status',
            'evasion_score',
            'confidence_score',
            'review_note',
            'status',
            'second_reviewer_id',
            'applied_at',
            'created_at',
            'updated_at',
          ].forEach(column => statementReviewProposalColumns.add(column));
        }
      }
      return statements.map(() => ({ success: true }));
    },
    userColumns,
    candidateColumns,
    adColumns,
    challengeColumns,
    reciteColumns,
    issueCategoryColumns,
    voterWriteinColumns,
    auditColumns,
    pressFeedColumns,
    emailDeliveryColumns,
    correctionRequestColumns,
    correctionEventColumns,
    statementReviewProposalColumns,
    auditIndexes,
    surveyResponseIndexes,
    executed,
    get hasMissingChallengeSlug() { return hasMissingChallengeSlug; },
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
      candidates: [
        'id',
        'race_id',
        'user_id',
        'name',
        'party',
        'biography',
        'issue_positions',
        'photo_url',
        'website_url',
        'verification_status',
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
      voterWriteins: [
        'id',
        'user_id',
        'race_id',
        'writein_text',
        'normalized_text',
        'party_affiliation',
        'jurisdiction_state',
        'jurisdiction_district',
        'created_at',
        'updated_at',
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
    expect(db.candidateColumns.has('source_status')).toBe(true);
    expect(db.candidateColumns.has('source_url')).toBe(true);
    expect(db.candidateColumns.has('source_label')).toBe(true);
    expect(db.candidateColumns.has('source_updated_at')).toBe(true);
    expect(db.adColumns.has('source_type')).toBe(true);
    expect(db.adColumns.has('source_url')).toBe(true);
    expect(db.adColumns.has('source_label')).toBe(true);
    expect(db.adColumns.has('posted_for_rebuttal_by')).toBe(true);
    expect(db.challengeColumns.has('claim_text')).toBe(true);
    expect(db.challengeColumns.has('public_receipt_slug')).toBe(true);
    expect(db.reciteColumns.has('archive_url')).toBe(true);
    expect(db.reciteColumns.has('review_note')).toBe(true);
    expect(db.issueCategoryColumns.has('parent_category_id')).toBe(true);
    expect(db.voterWriteinColumns.has('writein_rank')).toBe(true);
    expect(db.auditColumns.has('prev_hash')).toBe(true);
    expect(db.auditColumns.has('entry_hash')).toBe(true);
    expect(db.auditColumns.has('chain_seq')).toBe(true);
    expect(db.auditIndexes.has('idx_audit_entity_seq_unique')).toBe(true);
    expect(db.auditIndexes.has('idx_audit_entity_prev_hash_unique')).toBe(true);
    expect(db.pressFeedColumns.has('id')).toBe(true);
    expect(db.emailDeliveryColumns.has('id')).toBe(true);
    expect(db.correctionRequestColumns.has('id')).toBe(true);
    expect(db.correctionEventColumns.has('id')).toBe(true);
    expect(db.statementReviewProposalColumns.has('id')).toBe(true);
    expect(db.executed).toEqual([
      'ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT',
      'ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT',
      "ALTER TABLE candidates ADD COLUMN source_status TEXT NOT NULL DEFAULT 'platform_claim'",
      'ALTER TABLE candidates ADD COLUMN source_url TEXT',
      'ALTER TABLE candidates ADD COLUMN source_label TEXT',
      'ALTER TABLE candidates ADD COLUMN source_updated_at TEXT',
      `UPDATE candidates
         SET source_status = 'fec_registered',
             source_label = 'FEC-registered; not state ballot-certified',
             source_url = COALESCE(source_url, 'https://www.fec.gov/campaign-finance-data/candidate-master-file-description/'),
             source_updated_at = COALESCE(source_updated_at, datetime('now'))
         WHERE id LIKE 'cand-fec-%'
           AND user_id IS NULL
           AND (source_status IS NULL OR source_status = 'platform_claim')`,
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
      'ALTER TABLE voter_writeins ADD COLUMN writein_rank INTEGER NOT NULL DEFAULT 1 CHECK(writein_rank BETWEEN 1 AND 3)',
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
      `CREATE TABLE IF NOT EXISTS press_feed_items (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'news' CHECK(source_type IN ('official_record','news','press_release')),
        title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        publisher TEXT NOT NULL,
        section TEXT,
        published_at TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        content_hash TEXT,
        change_status TEXT NOT NULL DEFAULT 'new' CHECK(change_status IN ('new','updated','removed')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_press_feed_active_published
        ON press_feed_items(is_active, published_at DESC, first_seen_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_press_feed_source
        ON press_feed_items(source, section)`,
      `CREATE TABLE IF NOT EXISTS email_deliveries (
        id TEXT PRIMARY KEY,
        provider TEXT,
        provider_message_id TEXT,
        recipient_user_id TEXT REFERENCES users(id),
        recipient_email TEXT,
        subject TEXT NOT NULL,
        template_key TEXT,
        related_entity_type TEXT,
        related_entity_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('sent','failed','skipped')),
        error_message TEXT,
        metadata TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_email_deliveries_recipient
        ON email_deliveries(recipient_user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_email_deliveries_related
        ON email_deliveries(related_entity_type, related_entity_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_email_deliveries_status
        ON email_deliveries(status, created_at)`,
      `CREATE TABLE IF NOT EXISTS correction_requests (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id),
      content_type TEXT NOT NULL CHECK(content_type IN ('statement','recite','challenge','challenge_response','candidate','ad','rebuttal')),
      content_id TEXT NOT NULL,
      candidate_id TEXT REFERENCES candidates(id),
      reason TEXT NOT NULL DEFAULT 'factual_error' CHECK(reason IN ('factual_error','missing_context','source_error','identity_error','score_dispute','other')),
      requested_change TEXT NOT NULL,
      evidence_url TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','under_review','upheld','revised','rejected')),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      resolution_note TEXT,
      public_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
      `CREATE TABLE IF NOT EXISTS correction_request_events (
      id TEXT PRIMARY KEY,
      correction_request_id TEXT NOT NULL REFERENCES correction_requests(id),
      actor_id TEXT REFERENCES users(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('submitted','status_changed','public_note')),
      before_status TEXT,
      after_status TEXT,
      note TEXT,
      public_note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
      `CREATE INDEX IF NOT EXISTS idx_corrections_status
      ON correction_requests(status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_corrections_content
      ON correction_requests(content_type, content_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_corrections_requester
      ON correction_requests(requester_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_correction_events_request
      ON correction_request_events(correction_request_id, created_at)`,
      `CREATE TABLE IF NOT EXISTS statement_review_proposals (
        id TEXT PRIMARY KEY,
        statement_id TEXT NOT NULL REFERENCES public_statements(id),
        reviewer_id TEXT NOT NULL REFERENCES users(id),
        truth_status TEXT NOT NULL,
        answer_status TEXT NOT NULL,
        evasion_score INTEGER NOT NULL CHECK(evasion_score BETWEEN 0 AND 100),
        confidence_score INTEGER NOT NULL CHECK(confidence_score BETWEEN 0 AND 100),
        review_note TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')),
        second_reviewer_id TEXT REFERENCES users(id),
        applied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_statement_review_proposals_statement
        ON statement_review_proposals(statement_id, status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_statement_review_proposals_reviewer
        ON statement_review_proposals(reviewer_id, status, created_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_statement_review_one_pending_reviewer
        ON statement_review_proposals(statement_id, reviewer_id)
        WHERE status = 'pending'`,
    ]);

    db.executed.length = 0;
    await runRuntimeMigrations(db);

    expect(db.executed).toEqual([]);
  });

  it('backfills legacy challenge receipt slugs once', async () => {
    const db = createFakeD1({
      users: ['id'],
      candidates: ['id', 'source_status', 'source_url', 'source_label', 'source_updated_at'],
      adFlights: ['id'],
      challenges: ['id', 'public_receipt_slug'],
      recites: ['id'],
      issueCategories: ['id', 'parent_category_id'],
      voterWriteins: ['id', 'writein_rank'],
      auditLog: ['id', 'prev_hash', 'entry_hash', 'chain_seq'],
      missingChallengeSlug: true,
    });

    await runRuntimeMigrations(db);

    expect(db.executed).toContain(
      `UPDATE challenges SET public_receipt_slug = id WHERE public_receipt_slug IS NULL OR public_receipt_slug = ''`
    );
    expect(db.hasMissingChallengeSlug).toBe(false);

    db.executed.length = 0;
    await runRuntimeMigrations(db);

    expect(db.executed).not.toContain(
      `UPDATE challenges SET public_receipt_slug = id WHERE public_receipt_slug IS NULL OR public_receipt_slug = ''`
    );
  });

  it('rebuilds legacy correction tables to the current correction schema', async () => {
    const db = createFakeD1({
      users: ['id', 'password_reset_token_hash', 'password_reset_expires_at'],
      candidates: ['id', 'source_status', 'source_url', 'source_label', 'source_updated_at'],
      adFlights: ['id', 'source_type', 'source_url', 'source_label', 'posted_for_rebuttal_by'],
      challenges: ['id', 'claim_text', 'dispute_summary', 'requested_response', 'public_receipt_slug'],
      recites: ['id', 'source_published_at', 'accessed_at', 'archive_url', 'evidence_media_url', 'review_note'],
      issueCategories: ['id', 'parent_category_id'],
      voterWriteins: ['id', 'writein_rank'],
      auditLog: ['id', 'prev_hash', 'entry_hash', 'chain_seq'],
      pressFeedItems: ['id'],
      emailDeliveries: ['id'],
      correctionRequests: [
        'id',
        'content_type',
        'content_id',
        'submitted_by',
        'candidate_id',
        'request_text',
        'requested_change',
        'evidence_url',
        'status',
        'public_note',
        'reviewed_by',
        'reviewed_at',
        'created_at',
        'updated_at',
      ],
      correctionRequestEvents: [
        'id',
        'correction_request_id',
        'actor_id',
        'action_type',
        'note',
        'previous_status',
        'new_status',
        'metadata',
        'created_at',
      ],
      statementReviewProposals: [
        'id',
        'statement_id',
        'reviewer_id',
        'truth_status',
        'answer_status',
        'evasion_score',
        'confidence_score',
        'review_note',
        'status',
        'second_reviewer_id',
        'applied_at',
        'created_at',
        'updated_at',
      ],
    });

    await runRuntimeMigrations(db);

    expect(db.executed).toContain('ALTER TABLE correction_request_events RENAME TO correction_request_events_legacy');
    expect(db.executed).toContain('ALTER TABLE correction_requests RENAME TO correction_requests_legacy');
    expect(db.executed.some(sql => sql.includes('INSERT OR IGNORE INTO correction_requests') && sql.includes('submitted_by'))).toBe(true);
    expect(db.executed.some(sql => sql.includes('INSERT OR IGNORE INTO correction_request_events') && sql.includes('action_type'))).toBe(true);
    expect(db.executed).toContain('DROP TABLE IF EXISTS correction_requests_legacy');
  });
});
