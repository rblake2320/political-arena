/**
 * Arena — Survey / "What Matters" Routes
 * Issue priority system + surveys + cross-party overlap
 * PATENT CORE: Verified voter issue priority aggregation replacing biased polling
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { requireAuth, requireVerifiedVoter, requireRole, errorResponse, successResponse, parseBody, parsePagination } from '../middleware.js';
import { validate, submitPrioritiesSchema, submitWriteinsSchema, createSurveySchema, respondToSurveySchema } from '../validation.js';

const router = Router({ base: '/api/surveys' });

function normalizeWriteIn(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanWriteIns(writeIns = []) {
  return writeIns.map(text => text.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

// GET /api/surveys/issue-categories — Public list
router.get('/issue-categories', async (request, env) => {
  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM issue_categories WHERE is_active = 1 ORDER BY display_order`
  ).all();
  return successResponse({ categories: result.results || [] });
});

// POST /api/surveys/my-priorities — Submit/update issue rankings (verified voter)
router.post('/my-priorities', async (request, env) => {
  const authError = await requireVerifiedVoter(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(submitPrioritiesSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const raceId = data.race_id || null;
  const writeIns = cleanWriteIns(data.write_ins);
  if (writeIns.length > 3) {
    return errorResponse('A voter may submit at most 3 write-in issues', 400);
  }
  const normalizedWriteIns = writeIns.map(normalizeWriteIn);
  if (new Set(normalizedWriteIns).size !== normalizedWriteIns.length) {
    return errorResponse('Write-in issues must be unique', 400);
  }
  const invalidWriteIn = writeIns.find(text => text.length < 3 || text.length > 200);
  if (invalidWriteIn) {
    return errorResponse('Write-in issues must be between 3 and 200 characters after trimming', 400);
  }

  if (raceId) {
    const race = await env.ARENA_DB.prepare(`SELECT id FROM races WHERE id = ?`).bind(raceId).first();
    if (!race) return errorResponse('Race not found', 404);
  }

  const issueIds = data.priorities.map(p => p.issue_category_id);
  const placeholders = issueIds.map(() => '?').join(',');
  const categories = await env.ARENA_DB.prepare(
    `SELECT id FROM issue_categories WHERE id IN (${placeholders}) AND is_active = 1`
  ).bind(...issueIds).all();
  const validIssueIds = new Set((categories.results || []).map(c => c.id));
  const missingIssueIds = issueIds.filter(id => !validIssueIds.has(id));
  if (missingIssueIds.length > 0) {
    return errorResponse(`Unknown issue categories: ${missingIssueIds.join(', ')}`, 400);
  }

  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `DELETE FROM voter_issue_priorities WHERE user_id = ? AND (race_id = ? OR (race_id IS NULL AND ? IS NULL))`
    ).bind(request.user.id, raceId, raceId),
    env.ARENA_DB.prepare(
      `DELETE FROM voter_writeins WHERE user_id = ? AND (race_id = ? OR (race_id IS NULL AND ? IS NULL))`
    ).bind(request.user.id, raceId, raceId),
  ]);

  const priorityInserts = data.priorities.map(p => {
    const id = generateId('vip');
    return env.ARENA_DB.prepare(
      `INSERT INTO voter_issue_priorities (id, user_id, race_id, issue_category_id, priority_rank, party_affiliation, jurisdiction_state, jurisdiction_district)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, request.user.id, raceId, p.issue_category_id, p.priority_rank,
      request.user.party_affiliation || null, request.user.jurisdiction_state || null, request.user.jurisdiction_district || null);
  });

  const writeInInserts = writeIns.map((text, index) => {
    const id = generateId('vwi');
    return env.ARENA_DB.prepare(
      `INSERT INTO voter_writeins (id, user_id, race_id, writein_text, writein_rank, normalized_text, party_affiliation, jurisdiction_state, jurisdiction_district)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, request.user.id, raceId, text, index + 1, normalizedWriteIns[index],
      request.user.party_affiliation || null, request.user.jurisdiction_state || null, request.user.jurisdiction_district || null);
  });

  const inserts = [...priorityInserts, ...writeInInserts];
  if (inserts.length > 0) await env.ARENA_DB.batch(inserts);

  return successResponse({ saved: data.priorities.length, write_ins_saved: writeIns.length });
});

// GET /api/surveys/my-priorities — Get current user's rankings
router.get('/my-priorities', async (request, env) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const raceId = url.searchParams.get('race_id') || null;

  let sql = `SELECT vip.*, ic.name as category_name, ic.slug, ic.icon
     FROM voter_issue_priorities vip
     JOIN issue_categories ic ON vip.issue_category_id = ic.id
     WHERE vip.user_id = ?`;
  const binds = [request.user.id];

  if (raceId) { sql += ` AND vip.race_id = ?`; binds.push(raceId); }
  else { sql += ` AND vip.race_id IS NULL`; }

  sql += ` ORDER BY vip.priority_rank`;
  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();

  let writeInSql = `SELECT id, race_id, writein_text, writein_rank, normalized_text, party_affiliation, jurisdiction_state, jurisdiction_district, created_at
     FROM voter_writeins
     WHERE user_id = ?`;
  const writeInBinds = [request.user.id];
  if (raceId) { writeInSql += ` AND race_id = ?`; writeInBinds.push(raceId); }
  else { writeInSql += ` AND race_id IS NULL`; }
  writeInSql += ` ORDER BY writein_rank ASC, created_at ASC`;
  const writeIns = await env.ARENA_DB.prepare(writeInSql).bind(...writeInBinds).all();

  return successResponse({ priorities: result.results || [], write_ins: writeIns.results || [] });
});

// POST /api/surveys/my-writeins — Submit/update ranked write-in issues (verified voter)
router.post('/my-writeins', async (request, env) => {
  const authError = await requireVerifiedVoter(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  const { valid, errors, data } = validate(submitWriteinsSchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const raceId = data.race_id || null;
  if (raceId) {
    const race = await env.ARENA_DB.prepare(`SELECT id FROM races WHERE id = ?`).bind(raceId).first();
    if (!race) return errorResponse('Race not found', 404);
  }

  await env.ARENA_DB.prepare(
    `DELETE FROM voter_writeins WHERE user_id = ? AND (race_id = ? OR (race_id IS NULL AND ? IS NULL))`
  ).bind(request.user.id, raceId, raceId).run();

  const inserts = data.writeins.map(writeIn => {
    const text = writeIn.writein_text.trim().replace(/\s+/g, ' ');
    return env.ARENA_DB.prepare(
      `INSERT INTO voter_writeins (id, user_id, race_id, writein_text, writein_rank, normalized_text, party_affiliation, jurisdiction_state, jurisdiction_district)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId('vwi'),
      request.user.id,
      raceId,
      text,
      writeIn.writein_rank,
      normalizeWriteIn(text),
      request.user.party_affiliation || null,
      request.user.jurisdiction_state || null,
      request.user.jurisdiction_district || null,
    );
  });

  if (inserts.length > 0) await env.ARENA_DB.batch(inserts);

  return successResponse({ saved: inserts.length });
});

// GET /api/surveys/my-writeins — Get current user's ranked write-in issues
router.get('/my-writeins', async (request, env) => {
  const authError = await requireVerifiedVoter(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const raceId = url.searchParams.get('race_id') || null;
  let sql = `SELECT id, race_id, writein_text, writein_rank, normalized_text, party_affiliation, jurisdiction_state, jurisdiction_district, created_at
     FROM voter_writeins
     WHERE user_id = ?`;
  const binds = [request.user.id];

  if (raceId) { sql += ` AND race_id = ?`; binds.push(raceId); }
  else { sql += ` AND race_id IS NULL`; }

  sql += ` ORDER BY writein_rank ASC, created_at ASC`;
  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();

  return successResponse({ writeins: result.results || [] });
});

// GET /api/surveys/priorities/aggregate — Public aggregated results
router.get('/priorities/aggregate', async (request, env) => {
  const url = new URL(request.url);
  const raceId = url.searchParams.get('race_id') || null;
  const party = url.searchParams.get('party') || null;
  const state = url.searchParams.get('state') || null;

  let sql = `SELECT ic.id, ic.name, ic.slug, ic.icon,
    COUNT(*) as voter_count,
    AVG(vip.priority_rank) as avg_rank,
    vip.party_affiliation
    FROM voter_issue_priorities vip
    JOIN issue_categories ic ON vip.issue_category_id = ic.id
    WHERE 1=1`;
  const binds = [];

  if (raceId) { sql += ` AND vip.race_id = ?`; binds.push(raceId); }
  if (party) { sql += ` AND vip.party_affiliation = ?`; binds.push(party); }
  if (state) { sql += ` AND vip.jurisdiction_state = ?`; binds.push(state); }

  sql += ` GROUP BY ic.id, vip.party_affiliation ORDER BY avg_rank ASC`;
  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();

  let writeInSql = `SELECT normalized_text, MIN(writein_text) as writein_text,
    COUNT(*) as voter_count,
    party_affiliation
    FROM voter_writeins
    WHERE 1=1`;
  const writeInBinds = [];
  if (raceId) { writeInSql += ` AND race_id = ?`; writeInBinds.push(raceId); }
  if (party) { writeInSql += ` AND party_affiliation = ?`; writeInBinds.push(party); }
  if (state) { writeInSql += ` AND jurisdiction_state = ?`; writeInBinds.push(state); }
  writeInSql += ` GROUP BY normalized_text, party_affiliation ORDER BY voter_count DESC, writein_text ASC LIMIT 50`;
  const writeIns = await env.ARENA_DB.prepare(writeInSql).bind(...writeInBinds).all();

  // Compute cross-party overlap
  const byParty = {};
  (result.results || []).forEach(r => {
    if (!byParty[r.party_affiliation]) byParty[r.party_affiliation] = [];
    byParty[r.party_affiliation].push(r);
  });

  // Find issues that are top-3 for both major parties
  const demTop3 = (byParty['Democrat'] || []).slice(0, 3).map(r => r.id);
  const repTop3 = (byParty['Republican'] || []).slice(0, 3).map(r => r.id);
  const overlap = demTop3.filter(id => repTop3.includes(id));

  return successResponse({
    priorities: result.results || [],
    write_ins: writeIns.results || [],
    by_party: byParty,
    cross_party_overlap: overlap,
    total_voters: (result.results || []).reduce((sum, r) => sum + r.voter_count, 0),
  });
});

// GET /api/surveys/cross-party-overlap — Public "what both sides agree on"
router.get('/cross-party-overlap', async (request, env) => {
  const url = new URL(request.url);
  const raceId = url.searchParams.get('race_id') || null;
  const state = url.searchParams.get('state') || null;

  // Get top issues by party
  let baseFilter = `WHERE 1=1`;
  const binds = [];
  if (raceId) { baseFilter += ` AND vip.race_id = ?`; binds.push(raceId); }
  if (state) { baseFilter += ` AND vip.jurisdiction_state = ?`; binds.push(state); }

  const sql = `SELECT ic.id, ic.name, ic.slug, ic.icon,
    vip.party_affiliation as party,
    COUNT(*) as voter_count,
    AVG(vip.priority_rank) as avg_rank
    FROM voter_issue_priorities vip
    JOIN issue_categories ic ON vip.issue_category_id = ic.id
    ${baseFilter}
    AND vip.party_affiliation IN ('Democrat', 'Republican')
    GROUP BY ic.id, vip.party_affiliation
    ORDER BY avg_rank ASC`;

  const result = await env.ARENA_DB.prepare(sql).bind(...binds).all();

  const writeInSql = `SELECT normalized_text, MIN(writein_text) as writein_text,
    party_affiliation as party,
    COUNT(*) as voter_count
    FROM voter_writeins vwi
    ${baseFilter.replaceAll('vip.', 'vwi.')}
    AND vwi.party_affiliation IN ('Democrat', 'Republican')
    GROUP BY normalized_text, vwi.party_affiliation
    ORDER BY voter_count DESC, writein_text ASC`;
  const writeInResult = await env.ARENA_DB.prepare(writeInSql).bind(...binds).all();

  const democrat = (result.results || []).filter(r => r.party === 'Democrat');
  const republican = (result.results || []).filter(r => r.party === 'Republican');
  const democratWriteIns = (writeInResult.results || []).filter(r => r.party === 'Democrat');
  const republicanWriteIns = (writeInResult.results || []).filter(r => r.party === 'Republican');

  // Find overlap: issues in top-5 for both parties
  const demTop5 = democrat.slice(0, 5).map(r => r.id);
  const repTop5 = republican.slice(0, 5).map(r => r.id);
  const overlapIds = demTop5.filter(id => repTop5.includes(id));
  const demWriteInTop5 = democratWriteIns.slice(0, 5).map(r => r.normalized_text);
  const repWriteInTop5 = republicanWriteIns.slice(0, 5).map(r => r.normalized_text);
  const writeInOverlapIds = demWriteInTop5.filter(id => repWriteInTop5.includes(id));

  const overlapIssues = overlapIds.map(id => {
    const demEntry = democrat.find(r => r.id === id);
    const repEntry = republican.find(r => r.id === id);
    return {
      id,
      name: demEntry?.name,
      slug: demEntry?.slug,
      icon: demEntry?.icon,
      democrat: { rank: demEntry?.avg_rank, voters: demEntry?.voter_count },
      republican: { rank: repEntry?.avg_rank, voters: repEntry?.voter_count },
    };
  });

  const writeInOverlap = writeInOverlapIds.map(normalizedText => {
    const demEntry = democratWriteIns.find(r => r.normalized_text === normalizedText);
    const repEntry = republicanWriteIns.find(r => r.normalized_text === normalizedText);
    return {
      normalized_text: normalizedText,
      writein_text: demEntry?.writein_text || repEntry?.writein_text,
      democrat: { voters: demEntry?.voter_count },
      republican: { voters: repEntry?.voter_count },
    };
  });

  return successResponse({
    overlap: overlapIssues,
    write_in_overlap: writeInOverlap,
    democrat_top5: democrat.slice(0, 5),
    republican_top5: republican.slice(0, 5),
    democrat_write_ins_top5: democratWriteIns.slice(0, 5),
    republican_write_ins_top5: republicanWriteIns.slice(0, 5),
    message: overlapIssues.length > 0
      ? `Both parties agree on ${overlapIssues.length} top issues`
      : 'No overlap found in top-5 priorities',
  });
});

// POST /api/surveys — Create survey (admin)
router.post('/', async (request, env) => {
  const authError = await requireRole('admin', 'super_admin')(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { valid, errors, data } = validate(createSurveySchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  if (data.race_id) {
    const race = await env.ARENA_DB.prepare(`SELECT id FROM races WHERE id = ?`).bind(data.race_id).first();
    if (!race) return errorResponse('Race not found', 404);
  }

  const surveyId = generateId('srv');
  await env.ARENA_DB.prepare(
    `INSERT INTO surveys (id, race_id, title, description, created_by, target_audience, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(surveyId, data.race_id || null, data.title, data.description || null, request.user.id, data.target_audience, data.start_date || null, data.end_date || null).run();

  // Create questions if provided
  if (data.questions && Array.isArray(data.questions)) {
    const questionInserts = data.questions.map((q, i) => {
      const qId = generateId('sq');
      return env.ARENA_DB.prepare(
        `INSERT INTO survey_questions (id, survey_id, question_text, question_type, options, display_order, is_required) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(qId, surveyId, q.question_text, q.question_type || 'multiple_choice', q.options ? JSON.stringify(q.options) : null, i + 1, q.is_required !== false ? 1 : 0);
    });
    if (questionInserts.length > 0) await env.ARENA_DB.batch(questionInserts);
  }

  return successResponse({ id: surveyId });
});

// GET /api/surveys — List active surveys
router.get('/', async (request, env) => {
  const result = await env.ARENA_DB.prepare(
    `SELECT * FROM surveys WHERE status = 'active' ORDER BY created_at DESC`
  ).all();
  return successResponse({ surveys: result.results || [] });
});

// GET /api/surveys/:id — Survey detail with questions
router.get('/:id', async (request, env) => {
  const { id } = request.params;
  const survey = await env.ARENA_DB.prepare(`SELECT * FROM surveys WHERE id = ?`).bind(id).first();
  if (!survey) return errorResponse('Survey not found', 404);

  const questions = await env.ARENA_DB.prepare(
    `SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY display_order`
  ).bind(id).all();

  return successResponse({
    ...survey,
    questions: (questions.results || []).map(q => ({
      ...q,
      options: q.options ? JSON.parse(q.options) : null,
    })),
  });
});

// POST /api/surveys/:id/respond — Submit survey responses (verified voter)
router.post('/:id/respond', async (request, env) => {
  const authError = await requireVerifiedVoter(request, env);
  if (authError) return authError;

  const { id } = request.params;
  const body = await parseBody(request);
  const { valid, errors, data } = validate(respondToSurveySchema, body);
  if (!valid) return errorResponse(errors.join('; '));

  const survey = await env.ARENA_DB.prepare(
    `SELECT id FROM surveys WHERE id = ? AND status = 'active'`
  ).bind(id).first();
  if (!survey) return errorResponse('Survey not found', 404);

  const questionIds = data.responses.map(r => r.question_id);
  const uniqueQuestionIds = [...new Set(questionIds)];
  if (uniqueQuestionIds.length !== questionIds.length) {
    return errorResponse('responses cannot contain duplicate question_id entries', 400);
  }

  const placeholders = uniqueQuestionIds.map(() => '?').join(',');
  const questions = await env.ARENA_DB.prepare(
    `SELECT id FROM survey_questions WHERE survey_id = ? AND id IN (${placeholders})`
  ).bind(id, ...uniqueQuestionIds).all();
  const validQuestionIds = new Set((questions.results || []).map(q => q.id));
  const missingQuestionIds = uniqueQuestionIds.filter(questionId => !validQuestionIds.has(questionId));
  if (missingQuestionIds.length > 0) {
    return errorResponse(`Unknown survey questions: ${missingQuestionIds.join(', ')}`, 400);
  }

  const inserts = data.responses.map(r => {
    const respId = generateId('vsr');
    const responseValue = typeof r.response_value === 'string'
      ? r.response_value
      : JSON.stringify(r.response_value);
    return env.ARENA_DB.prepare(
      `INSERT INTO voter_survey_responses
       (id, user_id, survey_id, question_id, response_value, party_affiliation, jurisdiction_state)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, survey_id, question_id) DO UPDATE SET
         response_value = excluded.response_value,
         party_affiliation = excluded.party_affiliation,
         jurisdiction_state = excluded.jurisdiction_state,
         created_at = datetime('now')`
    ).bind(respId, request.user.id, id, r.question_id, responseValue,
      request.user.party_affiliation || null, request.user.jurisdiction_state || null);
  });

  if (inserts.length > 0) await env.ARENA_DB.batch(inserts);

  return successResponse({ submitted: inserts.length });
});

export default router;
