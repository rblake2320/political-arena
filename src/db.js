/**
 * Arena — Database Layer
 * All 25 tables + indexes created upfront via CREATE TABLE IF NOT EXISTS
 * Pattern: one-time schema bootstrap per D1 binding
 */

const initializedDbs = new WeakSet();

const DEMO_MEDIA = {
  healthcareAdImage: 'https://placehold.co/800x450/111827/ffffff.png?text=Healthcare+Ad',
  texasEnergyImage: 'https://placehold.co/800x450/172554/ffffff.png?text=Texas+Energy',
  aiRegulationImage: 'https://placehold.co/800x450/312e81/ffffff.png?text=AI+Regulation',
  healthcareRebuttalImage: 'https://placehold.co/800x450/1f2937/ffffff.png?text=Rebuttal+Response',
  debateResponseImage: 'https://placehold.co/800x450/064e3b/ffffff.png?text=Challenge+Response',
  educationResponseImage: 'https://placehold.co/800x450/78350f/ffffff.png?text=Education+Response',
  outsideAdVideo: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  outsideResponseVideo: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
};

export async function runRuntimeMigrations(db) {
  // Runtime migrations for databases created by older versions of the worker.
  const userColumnsResult = await db.prepare(`PRAGMA table_info(users)`).all();
  const userColumns = new Set((userColumnsResult.results || []).map(c => c.name));
  const userColumnMigrations = [];
  if (!userColumns.has('password_reset_token_hash')) {
    userColumnMigrations.push(db.prepare(`ALTER TABLE users ADD COLUMN password_reset_token_hash TEXT`));
  }
  if (!userColumns.has('password_reset_expires_at')) {
    userColumnMigrations.push(db.prepare(`ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT`));
  }
  if (userColumnMigrations.length > 0) await db.batch(userColumnMigrations);

  const adColumnsResult = await db.prepare(`PRAGMA table_info(ad_flights)`).all();
  const adColumns = new Set((adColumnsResult.results || []).map(c => c.name));
  const adColumnMigrations = [];
  if (!adColumns.has('source_type')) {
    adColumnMigrations.push(db.prepare(`ALTER TABLE ad_flights ADD COLUMN source_type TEXT NOT NULL DEFAULT 'platform'`));
  }
  if (!adColumns.has('source_url')) {
    adColumnMigrations.push(db.prepare(`ALTER TABLE ad_flights ADD COLUMN source_url TEXT`));
  }
  if (!adColumns.has('source_label')) {
    adColumnMigrations.push(db.prepare(`ALTER TABLE ad_flights ADD COLUMN source_label TEXT`));
  }
  if (!adColumns.has('posted_for_rebuttal_by')) {
    adColumnMigrations.push(db.prepare(`ALTER TABLE ad_flights ADD COLUMN posted_for_rebuttal_by TEXT REFERENCES candidates(id)`));
  }
  if (adColumnMigrations.length > 0) await db.batch(adColumnMigrations);

  const challengeColumnsResult = await db.prepare(`PRAGMA table_info(challenges)`).all();
  const challengeColumns = new Set((challengeColumnsResult.results || []).map(c => c.name));
  const challengeColumnMigrations = [];
  if (!challengeColumns.has('claim_text')) {
    challengeColumnMigrations.push(db.prepare(`ALTER TABLE challenges ADD COLUMN claim_text TEXT`));
  }
  if (!challengeColumns.has('dispute_summary')) {
    challengeColumnMigrations.push(db.prepare(`ALTER TABLE challenges ADD COLUMN dispute_summary TEXT`));
  }
  if (!challengeColumns.has('requested_response')) {
    challengeColumnMigrations.push(db.prepare(`ALTER TABLE challenges ADD COLUMN requested_response TEXT`));
  }
  if (!challengeColumns.has('public_receipt_slug')) {
    challengeColumnMigrations.push(db.prepare(`ALTER TABLE challenges ADD COLUMN public_receipt_slug TEXT`));
  }
  if (challengeColumnMigrations.length > 0) await db.batch(challengeColumnMigrations);

  const reciteColumnsResult = await db.prepare(`PRAGMA table_info(recites)`).all();
  const reciteColumns = new Set((reciteColumnsResult.results || []).map(c => c.name));
  const reciteColumnMigrations = [];
  if (!reciteColumns.has('source_published_at')) {
    reciteColumnMigrations.push(db.prepare(`ALTER TABLE recites ADD COLUMN source_published_at TEXT`));
  }
  if (!reciteColumns.has('accessed_at')) {
    reciteColumnMigrations.push(db.prepare(`ALTER TABLE recites ADD COLUMN accessed_at TEXT`));
  }
  if (!reciteColumns.has('archive_url')) {
    reciteColumnMigrations.push(db.prepare(`ALTER TABLE recites ADD COLUMN archive_url TEXT`));
  }
  if (!reciteColumns.has('evidence_media_url')) {
    reciteColumnMigrations.push(db.prepare(`ALTER TABLE recites ADD COLUMN evidence_media_url TEXT`));
  }
  if (!reciteColumns.has('review_note')) {
    reciteColumnMigrations.push(db.prepare(`ALTER TABLE recites ADD COLUMN review_note TEXT`));
  }
  if (reciteColumnMigrations.length > 0) await db.batch(reciteColumnMigrations);

  const issueCategoryColumnsResult = await db.prepare(`PRAGMA table_info(issue_categories)`).all();
  const issueCategoryColumns = new Set((issueCategoryColumnsResult.results || []).map(c => c.name));
  if (!issueCategoryColumns.has('parent_category_id')) {
    await db.batch([
      db.prepare(`ALTER TABLE issue_categories ADD COLUMN parent_category_id TEXT REFERENCES issue_categories(id)`),
    ]);
  }

  const auditColumnsResult = await db.prepare(`PRAGMA table_info(audit_log)`).all();
  const auditColumns = new Set((auditColumnsResult.results || []).map(c => c.name));
  const auditColumnMigrations = [];
  if (!auditColumns.has('prev_hash')) {
    auditColumnMigrations.push(db.prepare(`ALTER TABLE audit_log ADD COLUMN prev_hash TEXT`));
  }
  if (!auditColumns.has('entry_hash')) {
    auditColumnMigrations.push(db.prepare(`ALTER TABLE audit_log ADD COLUMN entry_hash TEXT`));
  }
  if (!auditColumns.has('chain_seq')) {
    auditColumnMigrations.push(db.prepare(`ALTER TABLE audit_log ADD COLUMN chain_seq INTEGER`));
    auditColumnMigrations.push(db.prepare(
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
       WHERE id IN (SELECT id FROM ranked)`
    ));
  }
  if (auditColumnMigrations.length > 0) await db.batch(auditColumnMigrations);

  const auditIndexesResult = await db.prepare(`PRAGMA index_list(audit_log)`).all();
  const auditIndexes = new Set((auditIndexesResult.results || []).map(i => i.name));
  const auditIndexMigrations = [];
  if (!auditIndexes.has('idx_audit_entity_seq_unique')) {
    auditIndexMigrations.push(db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_entity_seq_unique
       ON audit_log(entity_type, entity_id, chain_seq)
       WHERE chain_seq IS NOT NULL`
    ));
  }
  if (!auditIndexes.has('idx_audit_entity_prev_hash_unique')) {
    auditIndexMigrations.push(db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_entity_prev_hash_unique
       ON audit_log(entity_type, entity_id, prev_hash)
       WHERE chain_seq IS NOT NULL AND entry_hash IS NOT NULL AND prev_hash IS NOT NULL`
    ));
  }
  if (auditIndexMigrations.length > 0) await db.batch(auditIndexMigrations);

  const surveyResponseIndexesResult = await db.prepare(`PRAGMA index_list(voter_survey_responses)`).all();
  const surveyResponseIndexes = new Set((surveyResponseIndexesResult.results || []).map(i => i.name));
  if (!surveyResponseIndexes.has('idx_vsr_user_survey_question')) {
    await db.batch([
      db.prepare(
        `DELETE FROM voter_survey_responses
         WHERE rowid NOT IN (
           SELECT MIN(rowid)
           FROM voter_survey_responses
           GROUP BY user_id, survey_id, question_id
         )`
      ),
      db.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_vsr_user_survey_question
         ON voter_survey_responses(user_id, survey_id, question_id)`
      ),
    ]);
  }
}

export async function initDatabase(db) {
  if (initializedDbs.has(db)) return;

  await db.batch([
    // ========== CORE TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'voter' CHECK(role IN ('voter','candidate_staff','moderator','admin','super_admin')),
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      password_reset_token_hash TEXT,
      password_reset_expires_at TEXT,
      verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','pending','verified','rejected')),
      party_affiliation TEXT,
      jurisdiction_state TEXT,
      jurisdiction_district TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS races (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      office TEXT NOT NULL CHECK(office IN ('Senate','House','Governor','Mayor','State Senate','State House','Other')),
      state TEXT NOT NULL,
      district TEXT,
      jurisdiction_level TEXT NOT NULL DEFAULT 'federal' CHECK(jurisdiction_level IN ('federal','state','local')),
      election_date TEXT,
      filing_deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('upcoming','active','voting','completed','cancelled')),
      description TEXT,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      race_id TEXT NOT NULL REFERENCES races(id),
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      party TEXT NOT NULL,
      biography TEXT,
      issue_positions TEXT,
      photo_url TEXT,
      website_url TEXT,
      verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','verified','rejected','suspended')),
      verified_by TEXT REFERENCES users(id),
      verified_at TEXT,
      credit_balance INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS candidate_staff_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('primary','staff','viewer')),
      granted_by TEXT REFERENCES users(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, candidate_id)
    )`),

    // ========== AD PIPELINE TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS ad_flights (
      id TEXT PRIMARY KEY,
      race_id TEXT NOT NULL REFERENCES races(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      title TEXT,
      media_url TEXT,
      media_type TEXT DEFAULT 'text' CHECK(media_type IN ('image','video','text')),
      ad_content_text TEXT,
      disclaimer_text TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'platform' CHECK(source_type IN ('platform','external')),
      source_url TEXT,
      source_label TEXT,
      posted_for_rebuttal_by TEXT REFERENCES candidates(id),
      budget_cents INTEGER DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','approved','rejected','active','paused','completed')),
      rejection_reason TEXT,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      approved_at TEXT,
      activated_at TEXT,
      completed_at TEXT,
      total_impressions INTEGER DEFAULT 0,
      rebuttal_slot_reserved INTEGER DEFAULT 1,
      rebuttal_window_expires TEXT,
      max_rebuttals INTEGER DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS rebuttal_ads (
      id TEXT PRIMARY KEY,
      parent_ad_id TEXT NOT NULL REFERENCES ad_flights(id),
      race_id TEXT NOT NULL REFERENCES races(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      media_url TEXT,
      response_text TEXT,
      disclaimer_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','approved','rejected','active','paused','completed')),
      slot_claimed_at TEXT,
      priority_score INTEGER DEFAULT 0,
      total_impressions INTEGER DEFAULT 0,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== CHALLENGE TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      race_id TEXT NOT NULL REFERENCES races(id),
      challenger_candidate_id TEXT NOT NULL REFERENCES candidates(id),
      target_candidate_id TEXT NOT NULL REFERENCES candidates(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      challenge_text TEXT NOT NULL,
      claim_text TEXT,
      dispute_summary TEXT,
      requested_response TEXT,
      media_url TEXT,
      challenge_type TEXT NOT NULL DEFAULT 'open' CHECK(challenge_type IN ('open','debate_request','fact_check','policy_question')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','responded','expired','refused','withdrawn')),
      deadline_business_days INTEGER NOT NULL DEFAULT 3,
      response_deadline TEXT NOT NULL,
      responded_at TEXT,
      expired_at TEXT,
      refused_at TEXT,
      refusal_reason TEXT,
      public_receipt_slug TEXT UNIQUE,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS challenge_responses (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL UNIQUE REFERENCES challenges(id),
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      response_text TEXT NOT NULL,
      media_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS challenge_cooldowns (
      id TEXT PRIMARY KEY,
      challenger_candidate_id TEXT NOT NULL,
      target_candidate_id TEXT NOT NULL,
      race_id TEXT NOT NULL,
      cooldown_until TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS public_statements (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      race_id TEXT REFERENCES races(id),
      created_by TEXT NOT NULL REFERENCES users(id),
      statement_text TEXT NOT NULL,
      question_text TEXT,
      response_text TEXT,
      context_text TEXT,
      topic TEXT,
      claim_key TEXT,
      source_type TEXT NOT NULL DEFAULT 'other' CHECK(source_type IN ('youtube','video','audio','article','debate','social','press_release','other')),
      source_url TEXT NOT NULL,
      source_title TEXT,
      transcript_url TEXT,
      transcript_text TEXT,
      quote_start_seconds INTEGER,
      quote_end_seconds INTEGER,
      statement_at TEXT,
      truth_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(truth_status IN ('unreviewed','supported','disputed','false','mixed','context_needed')),
      answer_status TEXT NOT NULL DEFAULT 'not_applicable' CHECK(answer_status IN ('answered','partial','dodged','not_applicable','unclear')),
      evasion_score INTEGER NOT NULL DEFAULT 0 CHECK(evasion_score BETWEEN 0 AND 100),
      confidence_score INTEGER NOT NULL DEFAULT 0 CHECK(confidence_score BETWEEN 0 AND 100),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      review_note TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== ENGAGEMENT TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      content_type TEXT NOT NULL CHECK(content_type IN ('ad','rebuttal','challenge','challenge_response')),
      content_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL CHECK(reaction_type IN ('helpful','misleading','agree','disagree','important')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, content_type, content_id, reaction_type)
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS recites (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL CHECK(content_type IN ('ad','rebuttal','challenge','challenge_response')),
      content_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      publisher TEXT,
      source_type TEXT NOT NULL DEFAULT 'other' CHECK(source_type IN ('official_record','public_document','court_record','research','news','campaign_material','other')),
      stance TEXT NOT NULL CHECK(stance IN ('supports','refutes','context')),
      claim_text TEXT,
      quote TEXT,
      source_published_at TEXT,
      accessed_at TEXT,
      archive_url TEXT,
      evidence_media_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, content_type, content_id, url)
    )`),

    // ========== NOTIFICATION TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS notification_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subscription_type TEXT NOT NULL CHECK(subscription_type IN ('race','candidate','challenge')),
      target_id TEXT NOT NULL,
      notify_on TEXT NOT NULL DEFAULT '[]',
      channel TEXT NOT NULL DEFAULT 'in_app' CHECK(channel IN ('in_app','email','both')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subscription_id TEXT REFERENCES notification_subscriptions(id),
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link_url TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== SURVEY / "WHAT MATTERS" TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS issue_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      parent_category_id TEXT REFERENCES issue_categories(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS voter_issue_priorities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      race_id TEXT,
      issue_category_id TEXT NOT NULL REFERENCES issue_categories(id),
      priority_rank INTEGER NOT NULL CHECK(priority_rank BETWEEN 1 AND 5),
      party_affiliation TEXT,
      jurisdiction_state TEXT,
      jurisdiction_district TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, race_id, issue_category_id)
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS voter_writeins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      race_id TEXT,
      writein_text TEXT NOT NULL CHECK(length(writein_text) BETWEEN 3 AND 200),
      normalized_text TEXT NOT NULL,
      party_affiliation TEXT,
      jurisdiction_state TEXT,
      jurisdiction_district TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, race_id, normalized_text)
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS surveys (
      id TEXT PRIMARY KEY,
      race_id TEXT REFERENCES races(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
      created_by TEXT NOT NULL REFERENCES users(id),
      target_audience TEXT NOT NULL DEFAULT 'all' CHECK(target_audience IN ('all','race_voters','party_specific')),
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS survey_questions (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES surveys(id),
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL CHECK(question_type IN ('ranking','multiple_choice','scale','free_text')),
      options TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS voter_survey_responses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      survey_id TEXT NOT NULL REFERENCES surveys(id),
      question_id TEXT NOT NULL REFERENCES survey_questions(id),
      response_value TEXT NOT NULL,
      party_affiliation TEXT,
      jurisdiction_state TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, survey_id, question_id)
    )`),

    // ========== ANALYTICS ENGINE TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT,
      race_id TEXT,
      candidate_id TEXT,
      content_type TEXT,
      content_id TEXT,
      metadata TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS analytics_aggregates (
      id TEXT PRIMARY KEY,
      period_type TEXT NOT NULL CHECK(period_type IN ('hourly','daily','weekly')),
      period_start TEXT NOT NULL,
      race_id TEXT,
      candidate_id TEXT,
      metric_name TEXT NOT NULL,
      metric_value REAL NOT NULL DEFAULT 0,
      segment TEXT,
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS campaign_analytics_access (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      access_tier TEXT NOT NULL DEFAULT 'basic' CHECK(access_tier IN ('basic','premium','enterprise')),
      features_enabled TEXT,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    )`),

    // ========== MODERATION TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'policy_review' CHECK(reason IN ('auto_flag','user_report','policy_review','ad_submission')),
      reported_by TEXT REFERENCES users(id),
      assigned_to TEXT REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'flagged' CHECK(status IN ('flagged','under_review','resolved_upheld','resolved_overturned','appeal','appeal_review','final')),
      priority INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      resolved_by TEXT REFERENCES users(id),
      resolution_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS moderation_actions (
      id TEXT PRIMARY KEY,
      queue_item_id TEXT NOT NULL REFERENCES moderation_queue(id),
      moderator_id TEXT NOT NULL REFERENCES users(id),
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      previous_status TEXT,
      new_status TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== AUDIT & FAIRNESS TABLES ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_type TEXT NOT NULL DEFAULT 'user' CHECK(actor_type IN ('user','system','cron')),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_state TEXT,
      after_state TEXT,
      metadata TEXT,
      ip_address TEXT,
      prev_hash TEXT,
      entry_hash TEXT,
      chain_seq INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS impression_budgets (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      race_id TEXT NOT NULL REFERENCES races(id),
      budget_impressions INTEGER NOT NULL,
      used_impressions INTEGER NOT NULL DEFAULT 0,
      budget_period_start TEXT NOT NULL,
      budget_period_end TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(candidate_id, race_id, budget_period_start)
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS impression_logs (
      id TEXT PRIMARY KEY,
      ad_id TEXT,
      rebuttal_id TEXT,
      candidate_id TEXT NOT NULL,
      race_id TEXT NOT NULL,
      viewer_ip_hash TEXT,
      impression_type TEXT NOT NULL DEFAULT 'view' CHECK(impression_type IN ('view','click')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== QUESTIONS (VOTER + PRESS) ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      race_id TEXT NOT NULL REFERENCES races(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      source_type TEXT NOT NULL CHECK(source_type IN ('voter','press')),
      question_text TEXT NOT NULL,
      media_url TEXT,
      vote_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden','answered')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    db.prepare(`CREATE TABLE IF NOT EXISTS question_votes (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(question_id, user_id)
    )`),

    // ========== PRESS CREDENTIALS ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS press_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      outlet_name TEXT NOT NULL,
      outlet_type TEXT NOT NULL CHECK(outlet_type IN ('newspaper','tv','radio','digital','freelance')),
      proof_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== RATE LIMITING ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      reset_at TEXT NOT NULL
    )`),

    // ========== CREDIT TRANSACTIONS ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      amount INTEGER NOT NULL,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('grant','deduction','refund')),
      description TEXT,
      reference_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),

    // ========== MEDIA UPLOAD INDEX ==========
    db.prepare(`CREATE TABLE IF NOT EXISTS media_uploads (
      file_id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      candidate_id TEXT REFERENCES candidates(id),
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      original_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
  ]);

  await runRuntimeMigrations(db);

  // ========== INDEXES ==========
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, is_active)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_races_status ON races(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_races_state ON races(state)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_candidates_race ON candidates(race_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_candidates_user ON candidates(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_candidates_verification ON candidates(verification_status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_links_user ON candidate_staff_links(user_id, is_active)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_links_candidate ON candidate_staff_links(candidate_id, is_active)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ads_race ON ad_flights(race_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ads_candidate ON ad_flights(candidate_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ads_status ON ad_flights(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rebuttals_parent ON rebuttal_ads(parent_ad_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rebuttals_candidate ON rebuttal_ads(candidate_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_challenges_race ON challenges(race_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_challenges_target ON challenges(target_candidate_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_challenges_deadline ON challenges(response_deadline, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_challenges_receipt ON challenges(public_receipt_slug)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_challenge_responses_challenge ON challenge_responses(challenge_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_cooldowns_pair ON challenge_cooldowns(challenger_candidate_id, target_candidate_id, race_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_public_statements_candidate ON public_statements(candidate_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_public_statements_claim ON public_statements(claim_key, candidate_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_public_statements_review ON public_statements(truth_status, answer_status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_reactions_content ON reactions(content_type, content_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_recites_content ON recites(content_type, content_id, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_recites_user ON recites(user_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_recites_status ON recites(status, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notif_subs_user ON notification_subscriptions(user_id, is_active)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notif_subs_target ON notification_subscriptions(subscription_type, target_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_voter_priorities_user ON voter_issue_priorities(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_voter_priorities_race ON voter_issue_priorities(race_id, issue_category_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_voter_priorities_party ON voter_issue_priorities(party_affiliation, jurisdiction_state)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_voter_writeins_user ON voter_writeins(user_id, race_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_voter_writeins_race ON voter_writeins(race_id, normalized_text)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_voter_writeins_party ON voter_writeins(party_affiliation, jurisdiction_state)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vsr_user_survey_question ON voter_survey_responses(user_id, survey_id, question_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_events_race ON analytics_events(race_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_analytics_agg_period ON analytics_aggregates(period_type, period_start, metric_name)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_mod_queue_status ON moderation_queue(status, priority)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, created_at)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_entity_seq_unique
      ON audit_log(entity_type, entity_id, chain_seq)
      WHERE chain_seq IS NOT NULL`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_entity_prev_hash_unique
      ON audit_log(entity_type, entity_id, prev_hash)
      WHERE chain_seq IS NOT NULL AND entry_hash IS NOT NULL AND prev_hash IS NOT NULL`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_impression_logs_ad ON impression_logs(ad_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_impression_logs_date ON impression_logs(created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_impression_budgets_candidate ON impression_budgets(candidate_id, race_id)`),
    // Questions indexes
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_questions_race ON questions(race_id, source_type, status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_questions_votes ON questions(race_id, vote_count DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_question_votes_question ON question_votes(question_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_question_votes_user ON question_votes(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_press_creds_user ON press_credentials(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_credit_tx_candidate ON credit_transactions(candidate_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_challenges_candidate_created ON challenges(challenger_candidate_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_password_reset ON users(password_reset_token_hash, password_reset_expires_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_media_uploads_key ON media_uploads(key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_media_uploads_candidate ON media_uploads(candidate_id, created_at)`),
  ]);

  initializedDbs.add(db);
  console.log('Arena database initialized: 32 tables + 57 indexes');
}

// Seed issue categories (idempotent)
export async function seedIssueCategories(db) {
  const categories = [
    { id: 'cat-1', name: 'Healthcare', slug: 'healthcare', description: 'Health insurance, medical costs, public health', icon: 'heart-pulse', display_order: 1 },
    { id: 'cat-2', name: 'Economy & Jobs', slug: 'economy', description: 'Employment, wages, economic growth', icon: 'trending-up', display_order: 2 },
    { id: 'cat-3', name: 'Education', slug: 'education', description: 'Public schools, higher education, student debt', icon: 'graduation-cap', display_order: 3 },
    { id: 'cat-4', name: 'Immigration', slug: 'immigration', description: 'Border policy, visa programs, citizenship', icon: 'globe', display_order: 4 },
    { id: 'cat-5', name: 'Climate & Environment', slug: 'climate', description: 'Climate change, clean energy, conservation', icon: 'leaf', display_order: 5 },
    { id: 'cat-6', name: 'Housing', slug: 'housing', description: 'Affordable housing, rent, homeownership', icon: 'home', display_order: 6 },
    { id: 'cat-7', name: 'Defense & Security', slug: 'defense', description: 'Military, national security, foreign policy', icon: 'shield', display_order: 7 },
    { id: 'cat-8', name: 'Taxes', slug: 'taxes', description: 'Tax policy, government spending, fiscal responsibility', icon: 'receipt', display_order: 8 },
    { id: 'cat-9', name: 'Criminal Justice', slug: 'criminal-justice', description: 'Policing, courts, prison reform', icon: 'scale', display_order: 9 },
    { id: 'cat-10', name: 'Technology & AI', slug: 'technology', description: 'Tech regulation, AI policy, digital privacy', icon: 'cpu', display_order: 10 },
    { id: 'cat-11', name: 'Infrastructure', slug: 'infrastructure', description: 'Roads, bridges, broadband, public transit', icon: 'construction', display_order: 11 },
    { id: 'cat-12', name: 'Social Security & Retirement', slug: 'social-security', description: 'Social Security, Medicare, retirement benefits', icon: 'shield-check', display_order: 12 },
    { id: 'cat-13', name: 'Democracy & Elections', slug: 'democracy-elections', description: 'Voting rights, election administration, election integrity', icon: 'vote', display_order: 13 },
    { id: 'cat-14', name: 'Abortion & Reproductive Policy', slug: 'reproductive-policy', description: 'Abortion, contraception, reproductive health policy', icon: 'stethoscope', display_order: 14 },
    { id: 'cat-15', name: 'Cost of Living', slug: 'cost-of-living', description: 'Prices, inflation, household expenses, affordability', icon: 'wallet', display_order: 15 },
  ];

  for (const cat of categories) {
    await db.prepare(
      `INSERT INTO issue_categories (id, name, slug, description, icon, display_order, parent_category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         description = excluded.description,
         icon = excluded.icon,
         display_order = excluded.display_order,
         parent_category_id = excluded.parent_category_id,
         is_active = 1`
    ).bind(cat.id, cat.name, cat.slug, cat.description, cat.icon, cat.display_order, cat.parent_category_id || null).run();
  }
}

async function repairDemoMediaData(db) {
  await db.batch([
    db.prepare(`UPDATE ad_flights SET media_url = ?, media_type = 'image', updated_at = datetime('now') WHERE id = 'ad-1'`)
      .bind(DEMO_MEDIA.healthcareAdImage),
    db.prepare(`UPDATE ad_flights SET media_url = ?, media_type = 'image', updated_at = datetime('now') WHERE id = 'ad-2'`)
      .bind(DEMO_MEDIA.texasEnergyImage),
    db.prepare(`UPDATE ad_flights SET media_url = ?, media_type = 'image', updated_at = datetime('now') WHERE id = 'ad-3'`)
      .bind(DEMO_MEDIA.aiRegulationImage),
    db.prepare(`UPDATE rebuttal_ads SET media_url = ?, updated_at = datetime('now') WHERE id = 'reb-1'`)
      .bind(DEMO_MEDIA.healthcareRebuttalImage),
    db.prepare(`UPDATE challenge_responses SET media_url = ? WHERE id = 'resp-1'`)
      .bind(DEMO_MEDIA.debateResponseImage),
    db.prepare(`UPDATE challenge_responses SET media_url = ? WHERE id = 'resp-2'`)
      .bind(DEMO_MEDIA.educationResponseImage),
    db.prepare(
      `UPDATE ad_flights
       SET media_url = ?, source_url = ?, media_type = 'video', updated_at = datetime('now')
       WHERE source_type = 'external'
         AND (
           media_url LIKE 'http://example.com/%.mp4'
           OR media_url LIKE 'https://example.com/%.mp4'
           OR source_url LIKE 'http://example.com/%.mp4'
           OR source_url LIKE 'https://example.com/%.mp4'
         )`
    ).bind(DEMO_MEDIA.outsideAdVideo, DEMO_MEDIA.outsideAdVideo),
    db.prepare(
      `UPDATE rebuttal_ads
       SET media_url = ?, updated_at = datetime('now')
       WHERE media_url LIKE 'http://example.com/%.mp4'
          OR media_url LIKE 'https://example.com/%.mp4'`
    ).bind(DEMO_MEDIA.outsideResponseVideo),
  ]);
}

// Seed demo races and candidates from store.ts data
export async function seedDemoData(db) {
  // Check if fully seeded (races + ads)
  const raceCount = await db.prepare(`SELECT COUNT(*) as count FROM races`).first();
  const adCount = await db.prepare(`SELECT COUNT(*) as count FROM ad_flights`).first();

  // If ads exist, keep existing demo rows but repair stale placeholder media.
  if (adCount.count > 0) {
    await repairDemoMediaData(db);
    return;
  }

  // Create system user for seed data (FK constraint requires valid user)
  await db.prepare(
    `INSERT OR IGNORE INTO users (id, email, username, display_name, password_hash, role, email_verified, verification_status, is_active)
     VALUES ('system', 'system@arena.internal', 'system', 'System', 'no-login', 'super_admin', 1, 'verified', 1)`
  ).run();

  // Races (skip if already exist)
  if (raceCount.count === 0) {
    await db.batch([
      db.prepare(`INSERT INTO races (id, name, office, state, district, status) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind('race-1', '2026 Alabama Senate Race', 'Senate', 'AL', '', 'active'),
      db.prepare(`INSERT INTO races (id, name, office, state, district, status) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind('race-2', '2026 Texas Governor Race', 'Governor', 'TX', '', 'active'),
      db.prepare(`INSERT INTO races (id, name, office, state, district, status) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind('race-3', '2026 California 12th District', 'House', 'CA', '12th', 'active'),
    ]);
  }

  // Candidates (INSERT OR IGNORE — safe to re-run)
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO candidates (id, race_id, name, party, biography, issue_positions, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('cand-1', 'race-1', 'Jane Doe', 'Democrat', 'Jane is a lifelong Alabamian dedicated to improving education and healthcare access for all families.', '["Education","Healthcare","Infrastructure"]', 'verified'),
    db.prepare(`INSERT OR IGNORE INTO candidates (id, race_id, name, party, biography, issue_positions, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('cand-2', 'race-1', 'John Smith', 'Republican', 'John is a business owner focused on economic growth, reducing regulations, and strengthening national security.', '["Economy","Deregulation","Defense"]', 'verified'),
    db.prepare(`INSERT OR IGNORE INTO candidates (id, race_id, name, party, biography, issue_positions, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('cand-3', 'race-2', 'Maria Garcia', 'Democrat', 'Maria is a former teacher and state representative fighting for working families, affordable housing, and clean energy.', '["Jobs","Education","Clean Energy"]', 'verified'),
    db.prepare(`INSERT OR IGNORE INTO candidates (id, race_id, name, party, biography, issue_positions, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('cand-4', 'race-2', 'Robert Johnson', 'Republican', 'Robert is a rancher and entrepreneur who wants to lower taxes, secure the border, and expand energy production.', '["Taxes","Security","Energy"]', 'verified'),
    db.prepare(`INSERT OR IGNORE INTO candidates (id, race_id, name, party, biography, issue_positions, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('cand-5', 'race-3', 'Lisa Chen', 'Democrat', 'Lisa is a tech executive turned public servant focused on AI regulation, housing, and climate action.', '["Tech Policy","Housing","Climate"]', 'verified'),
    db.prepare(`INSERT OR IGNORE INTO candidates (id, race_id, name, party, biography, issue_positions, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind('cand-6', 'race-3', 'Mark Williams', 'Republican', 'Mark is a retired Marine and small business owner championing veterans\' affairs and fiscal responsibility.', '["Veterans","Fiscal Policy","Small Business"]', 'verified'),
  ]);

  // Seed demo ads (INSERT OR IGNORE — safe to re-run)
  const now = new Date().toISOString();
  const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const rebuttalWindow = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO ad_flights (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, status, start_date, end_date, rebuttal_window_expires, media_type, media_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('ad-1', 'race-1', 'cand-1', 'system', 'Healthcare for Alabama', 'My healthcare plan saves families an average of $2,000 a year while expanding coverage to every Alabamian.', 'Paid for by Jane Doe for Senate', 'active', now, weekFromNow, rebuttalWindow, 'image', DEMO_MEDIA.healthcareAdImage),
    db.prepare(`INSERT OR IGNORE INTO ad_flights (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, status, start_date, end_date, rebuttal_window_expires, media_type, media_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('ad-2', 'race-2', 'cand-4', 'system', 'Texas Energy Independence', 'As Governor, I will expand energy production and lower your utility bills by cutting red tape.', 'Paid for by Robert Johnson for Texas', 'active', now, weekFromNow, rebuttalWindow, 'image', DEMO_MEDIA.texasEnergyImage),
    db.prepare(`INSERT OR IGNORE INTO ad_flights (id, race_id, candidate_id, created_by, title, ad_content_text, disclaimer_text, status, start_date, end_date, rebuttal_window_expires, media_type, media_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('ad-3', 'race-3', 'cand-5', 'system', 'AI Regulation Now', 'Silicon Valley needs responsible AI regulation. As your representative, I will fight for transparency and accountability.', 'Paid for by Lisa Chen for Congress', 'active', now, weekFromNow, rebuttalWindow, 'image', DEMO_MEDIA.aiRegulationImage),
  ]);

  // Seed a rebuttal
  await db.prepare(`INSERT OR IGNORE INTO rebuttal_ads (id, parent_ad_id, race_id, candidate_id, created_by, response_text, disclaimer_text, status, slot_claimed_at, media_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('reb-1', 'ad-1', 'race-1', 'cand-2', 'system', "My opponent's healthcare plan will bankrupt our state. Here are the facts.", 'Paid for by John Smith for Senate', 'active', now, DEMO_MEDIA.healthcareRebuttalImage).run();

  // Seed challenges
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO challenges (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, response_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('chal-1', 'race-1', 'cand-2', 'cand-1', 'system', 'I challenge my opponent to debate the economic impact of their proposed healthcare policies.', 'debate_request', 'responded', threeDaysFromNow),
    db.prepare(`INSERT OR IGNORE INTO challenges (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, response_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('chal-2', 'race-2', 'cand-3', 'cand-4', 'system', 'Will you commit to fully funding our public schools without raising property taxes?', 'policy_question', 'open', threeDaysFromNow),
    db.prepare(`INSERT OR IGNORE INTO challenges (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, response_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('chal-3', 'race-1', 'cand-1', 'cand-2', 'system', 'I challenge my opponent to explain how their deregulation plan won\'t harm our local environment.', 'policy_question', 'open', threeDaysFromNow),
    db.prepare(`INSERT OR IGNORE INTO challenges (id, race_id, challenger_candidate_id, target_candidate_id, created_by, challenge_text, challenge_type, status, response_deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('chal-4', 'race-1', 'cand-1', 'cand-2', 'system', 'I challenge my opponent to explain their position on public school funding and why they voted against the Education Investment Act.', 'policy_question', 'responded', threeDaysFromNow),
  ]);

  // Seed challenge responses with media
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO challenge_responses (id, challenge_id, candidate_id, created_by, response_text, media_url) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('resp-1', 'chal-1', 'cand-1', 'system', "I'm happy to debate. My plan saves families an average of $2,000 a year.", DEMO_MEDIA.debateResponseImage),
    db.prepare(`INSERT OR IGNORE INTO challenge_responses (id, challenge_id, candidate_id, created_by, response_text, media_url) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('resp-2', 'chal-4', 'cand-2', 'system', "I support public schools. My plan increases funding by redirecting wasteful spending while keeping taxes low.", DEMO_MEDIA.educationResponseImage),
  ]);

  // Seed credits (10 credits for new seed candidates only — uses INSERT OR IGNORE IDs)
  await db.batch([
    db.prepare(`UPDATE candidates SET credit_balance = 10 WHERE id = 'cand-1' AND credit_balance = 0`),
    db.prepare(`UPDATE candidates SET credit_balance = 10 WHERE id = 'cand-2' AND credit_balance = 0`),
    db.prepare(`UPDATE candidates SET credit_balance = 10 WHERE id = 'cand-3' AND credit_balance = 0`),
    db.prepare(`UPDATE candidates SET credit_balance = 10 WHERE id = 'cand-4' AND credit_balance = 0`),
    db.prepare(`UPDATE candidates SET credit_balance = 10 WHERE id = 'cand-5' AND credit_balance = 0`),
    db.prepare(`UPDATE candidates SET credit_balance = 10 WHERE id = 'cand-6' AND credit_balance = 0`),
  ]);

  console.log('Arena demo data seeded: 3 races, 6 candidates, 3 ads, 1 rebuttal, 4 challenges, 2 responses, 10 credits each');
}

// Generate unique IDs with crypto-grade randomness
export function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes).map(b => b.toString(36).padStart(2, '0')).join('').substring(0, 10);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}
