/**
 * Arena — Validation Module
 * Zod schemas for all endpoint inputs + XSS sanitization
 */

import { z } from 'zod';

// ===== XSS Note =====
// Do NOT HTML-encode on write. React escapes on render, so encoding here
// would cause double-encoding (&amp; displayed instead of &).
// Zod validation + React JSX escaping = safe by default.

// ===== Auth Schemas =====

const passwordPolicy = z.string().min(8).max(128).regex(
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:,.<>?])/,
  'Password must include uppercase, lowercase, number, and special character'
);

export const registerSchema = z.object({
  email: z.string().email().max(255),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
  password: passwordPolicy,
  display_name: z.string().min(1).max(100),
  party_affiliation: z.string().max(50).optional(),
  jurisdiction_state: z.string().max(2).optional(),
  jurisdiction_district: z.string().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordPolicy,
});

// ===== Race Schemas =====

export const createRaceSchema = z.object({
  name: z.string().min(3).max(200),
  office: z.enum(['Senate', 'House', 'Governor', 'Mayor', 'State Senate', 'State House', 'Other']),
  state: z.string().min(2).max(2),
  district: z.string().max(20).optional().default(''),
  jurisdiction_level: z.enum(['federal', 'state', 'local']).optional().default('federal'),
  election_date: z.string().optional(),
  filing_deadline: z.string().optional(),
  description: z.string().max(2000).optional(),
});

export const updateRaceSchema = createRaceSchema.partial();

// ===== Candidate Schemas =====

export const createCandidateSchema = z.object({
  race_id: z.string().min(1),
  name: z.string().min(1).max(100),
  party: z.string().min(1).max(50),
  biography: z.string().max(5000).optional(),
  issue_positions: z.array(z.string().max(100)).max(10).optional(),
  website_url: z.string().url().max(500).optional(),
});

export const updateCandidateSchema = z.object({
  biography: z.string().max(5000).optional(),
  issue_positions: z.array(z.string().max(100)).max(10).optional(),
  website_url: z.string().url().max(500).optional(),
});

export const verifyCandidateSchema = z.object({
  action: z.enum(['verify', 'reject']),
});

export const addCandidateStaffSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(['primary', 'staff', 'viewer']).optional().default('staff'),
});

// ===== Ad Schemas =====

export const createAdSchema = z.object({
  race_id: z.string().min(1),
  candidate_id: z.string().min(1),
  title: z.string().min(1).max(200),
  ad_content_text: z.string().min(1).max(5000),
  disclaimer_text: z.string().min(1).max(500),
  media_url: z.string().url().max(1000).optional(),
  media_type: z.enum(['image', 'video', 'text']).optional().default('text'),
  budget_cents: z.number().int().min(0).optional().default(0),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const updateAdSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  ad_content_text: z.string().min(1).max(5000).optional(),
  disclaimer_text: z.string().min(1).max(500).optional(),
  media_url: z.string().url().max(1000).optional(),
  media_type: z.enum(['image', 'video', 'text']).optional(),
  budget_cents: z.number().int().min(0).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const reviewAdSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejection_reason: z.string().max(1000).optional(),
});

// ===== Rebuttal Schemas =====

export const createRebuttalSchema = z.object({
  parent_ad_id: z.string().min(1),
  candidate_id: z.string().min(1),
  response_text: z.string().min(1).max(5000),
  disclaimer_text: z.string().min(1).max(500),
  media_url: z.string().url().max(1000).optional(),
});

export const createExternalAdResponseSchema = z.object({
  race_id: z.string().min(1),
  source_candidate_id: z.string().min(1),
  responder_candidate_id: z.string().min(1),
  source_title: z.string().min(1).max(200),
  source_media_url: z.string().url().max(1000),
  source_description: z.string().max(5000).optional(),
  source_disclaimer_text: z.string().max(500).optional(),
  response_text: z.string().min(1).max(5000),
  response_media_url: z.string().url().max(1000).optional(),
  disclaimer_text: z.string().min(1).max(500),
});

export const createExternalAdSourceSchema = z.object({
  race_id: z.string().min(1),
  source_candidate_id: z.string().min(1),
  posting_candidate_id: z.string().min(1),
  source_title: z.string().min(1).max(200),
  source_media_url: z.string().url().max(1000),
  source_description: z.string().max(5000).optional(),
  source_disclaimer_text: z.string().max(500).optional(),
});

// ===== Challenge Schemas =====

const reciteEvidenceSchema = z.object({
  url: z.string().url().max(1000).refine(
    (url) => /^https?:\/\//i.test(url),
    { message: 'URL must use http or https' }
  ),
  title: z.string().min(1).max(240),
  publisher: z.string().max(120).optional(),
  source_type: z.enum(['official_record', 'public_document', 'court_record', 'research', 'news', 'campaign_material', 'other']).optional().default('other'),
  stance: z.enum(['supports', 'refutes', 'context']).optional().default('supports'),
  claim_text: z.string().max(500).optional(),
  quote: z.string().max(1000).optional(),
  source_published_at: z.string().max(50).optional(),
  accessed_at: z.string().max(50).optional(),
  archive_url: z.string().url().max(1000).optional(),
  evidence_media_url: z.string().url().max(1000).optional(),
});

export const createChallengeSchema = z.object({
  race_id: z.string().min(1),
  target_candidate_id: z.string().min(1),
  challenger_candidate_id: z.string().min(1),
  challenge_text: z.string().min(10).max(2000),
  claim_text: z.string().max(500).optional(),
  dispute_summary: z.string().max(1000).optional(),
  requested_response: z.string().max(500).optional(),
  challenge_type: z.enum(['open', 'debate_request', 'fact_check', 'policy_question']).optional().default('open'),
  media_url: z.string().url().max(1000).optional(),
  deadline_business_days: z.number().int().min(3).max(10).optional().default(3),
  initial_recites: z.array(reciteEvidenceSchema).max(5).optional().default([]),
}).superRefine((data, ctx) => {
  if (data.challenge_type === 'fact_check' && data.initial_recites.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['initial_recites'],
      message: 'Fact-check callouts require at least one recite',
    });
  }
  if (data.challenge_type === 'fact_check' && (!data.claim_text || data.claim_text.trim().length < 10)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['claim_text'],
      message: 'Fact-check callouts require a specific claim',
    });
  }
});

export const respondToChallengeSchema = z.object({
  response_text: z.string().min(1).max(5000),
  media_url: z.string().url().max(1000).optional(),
});

export const refuseChallengeSchema = z.object({
  refusal_reason: z.string().max(1000).optional(),
});

// ===== Public Statement / Trust Ledger Schemas =====

export const createStatementSchema = z.object({
  candidate_id: z.string().min(1),
  race_id: z.string().min(1).optional(),
  statement_text: z.string().min(5).max(5000),
  question_text: z.string().max(2000).optional(),
  response_text: z.string().max(5000).optional(),
  context_text: z.string().max(5000).optional(),
  topic: z.string().max(100).optional(),
  source_type: z.enum(['youtube', 'video', 'audio', 'article', 'debate', 'social', 'press_release', 'other']).optional().default('other'),
  source_url: z.string().url().max(1000),
  source_title: z.string().max(240).optional(),
  transcript_url: z.string().url().max(1000).optional(),
  transcript_text: z.string().max(20000).optional(),
  quote_start_seconds: z.number().int().min(0).max(86400).optional(),
  quote_end_seconds: z.number().int().min(0).max(86400).optional(),
  statement_at: z.string().max(50).optional(),
}).superRefine((data, ctx) => {
  if (data.quote_start_seconds !== undefined && data.quote_end_seconds !== undefined && data.quote_end_seconds < data.quote_start_seconds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quote_end_seconds'],
      message: 'End timestamp must be after start timestamp',
    });
  }
});

export const reviewStatementSchema = z.object({
  truth_status: z.enum(['unreviewed', 'supported', 'disputed', 'false', 'mixed', 'context_needed']).optional(),
  answer_status: z.enum(['answered', 'partial', 'dodged', 'not_applicable', 'unclear']).optional(),
  evasion_score: z.number().int().min(0).max(100).optional(),
  confidence_score: z.number().int().min(0).max(100).optional(),
  review_note: z.string().max(1000).optional(),
});

// ===== Correction / Appeal Schemas =====

export const createCorrectionRequestSchema = z.object({
  content_type: z.enum(['statement', 'recite', 'challenge', 'challenge_response', 'candidate', 'ad', 'rebuttal']),
  content_id: z.string().min(1).max(120),
  candidate_id: z.string().min(1).max(120).optional(),
  reason: z.enum(['factual_error', 'missing_context', 'source_error', 'identity_error', 'score_dispute', 'other']).optional().default('factual_error'),
  requested_change: z.string().min(10).max(3000),
  evidence_url: z.string().url().max(1000).optional(),
});

export const reviewCorrectionRequestSchema = z.object({
  status: z.enum(['under_review', 'upheld', 'revised', 'rejected']),
  resolution_note: z.string().min(5).max(3000),
  public_note: z.string().min(5).max(3000).optional(),
});

// ===== Reaction Schemas =====

export const createReactionSchema = z.object({
  content_type: z.enum(['ad', 'rebuttal', 'challenge', 'challenge_response']),
  content_id: z.string().min(1),
  reaction_type: z.enum(['helpful', 'misleading', 'agree', 'disagree', 'important']),
});

export const createReciteSchema = z.object({
  content_type: z.enum(['ad', 'rebuttal', 'challenge', 'challenge_response']),
  content_id: z.string().min(1),
  url: z.string().url().max(1000).refine(
    (url) => /^https?:\/\//i.test(url),
    { message: 'URL must use http or https' }
  ),
  title: z.string().min(1).max(240),
  publisher: z.string().max(120).optional(),
  source_type: z.enum(['official_record', 'public_document', 'court_record', 'research', 'news', 'campaign_material', 'other']).optional().default('other'),
  stance: z.enum(['supports', 'refutes', 'context']),
  claim_text: z.string().max(500).optional(),
  quote: z.string().max(1000).optional(),
  source_published_at: z.string().max(50).optional(),
  accessed_at: z.string().max(50).optional(),
  archive_url: z.string().url().max(1000).optional(),
  evidence_media_url: z.string().url().max(1000).optional(),
});

export const reviewReciteSchema = z.object({
  status: z.enum(['verified', 'rejected', 'pending']),
  review_note: z.string().max(1000).optional(),
});

// ===== Notification Schemas =====

export const subscribeSchema = z.object({
  subscription_type: z.enum(['race', 'candidate', 'challenge']),
  target_id: z.string().min(1),
  notify_on: z.array(z.string()).optional().default(['challenge_issued', 'challenge_responded', 'challenge_expired']),
  channel: z.enum(['in_app', 'email', 'both']).optional().default('in_app'),
});

export const favoriteSchema = z.object({
  favorite_type: z.enum(['race', 'candidate', 'challenge']),
  target_id: z.string().min(1),
});

export const launchEmailTestSchema = z.object({
  to_email: z.string().email().max(255).optional(),
});

// ===== Survey Schemas =====

export const submitPrioritiesSchema = z.object({
  race_id: z.string().optional().nullable(),
  priorities: z.array(z.object({
    issue_category_id: z.string().min(1),
    priority_rank: z.number().int().min(1).max(5),
  })).min(1).max(5),
  write_ins: z.array(z.string().trim().min(3).max(200)).max(3).optional().default([]),
}).superRefine((data, ctx) => {
  const issueIds = new Set();
  const ranks = new Set();
  data.priorities.forEach((priority, index) => {
    if (issueIds.has(priority.issue_category_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorities', index, 'issue_category_id'],
        message: 'Issue categories must be unique',
      });
    }
    issueIds.add(priority.issue_category_id);

    if (ranks.has(priority.priority_rank)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priorities', index, 'priority_rank'],
        message: 'Priority ranks must be unique',
      });
    }
    ranks.add(priority.priority_rank);
  });

  const writeIns = new Set();
  data.write_ins.forEach((writeIn, index) => {
    const normalized = writeIn.toLowerCase().replace(/\s+/g, ' ').trim();
    if (writeIns.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['write_ins', index],
        message: 'Write-in issues must be unique',
      });
    }
    writeIns.add(normalized);
  });
});

export const submitWriteinsSchema = z.object({
  race_id: z.string().optional().nullable(),
  writeins: z.array(z.object({
    writein_text: z.string().trim().min(3).max(200),
    writein_rank: z.number().int().min(1).max(3),
  })).max(3),
}).superRefine((data, ctx) => {
  const ranks = new Set();
  const writeIns = new Set();

  data.writeins.forEach((writeIn, index) => {
    if (ranks.has(writeIn.writein_rank)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['writeins', index, 'writein_rank'],
        message: 'Write-in ranks must be unique',
      });
    }
    ranks.add(writeIn.writein_rank);

    const normalized = writeIn.writein_text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (writeIns.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['writeins', index, 'writein_text'],
        message: 'Write-in issues must be unique',
      });
    }
    writeIns.add(normalized);
  });
});

// ===== Question Schemas =====

export const submitQuestionSchema = z.object({
  source_type: z.enum(['voter', 'press']),
  question_text: z.string().min(10).max(2000),
  media_url: z.string().url().max(1000).optional(),
});

// ===== Press Credential Schemas =====

export const registerPressSchema = z.object({
  outlet_name: z.string().min(1).max(200),
  outlet_type: z.enum(['newspaper', 'tv', 'radio', 'digital', 'freelance']),
  proof_url: z.string().url().max(1000).refine(
    (url) => /^https?:\/\//i.test(url),
    { message: 'URL must use http or https' }
  ).optional(),
});

// ===== Credit Schemas =====

export const grantCreditsSchema = z.object({
  amount: z.number().int().min(1).max(1000),
  description: z.string().max(500).optional(),
});

// ===== Admin Survey Schemas =====

export const createSurveySchema = z.object({
  race_id: z.string().min(1).optional().nullable(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  target_audience: z.enum(['all', 'race_voters', 'party_specific']).optional().default('all'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  questions: z.array(z.object({
    question_text: z.string().min(1).max(2000),
    question_type: z.enum(['ranking', 'multiple_choice', 'scale', 'free_text']).optional().default('multiple_choice'),
    options: z.array(z.string().max(500)).max(20).optional(),
    is_required: z.boolean().optional(),
  })).max(50).optional(),
});

const surveyResponseValueSchema = z.union([
  z.string().max(5000),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(50),
]);

export const respondToSurveySchema = z.object({
  responses: z.array(z.object({
    question_id: z.string().min(1),
    response_value: surveyResponseValueSchema,
  })).min(1).max(100),
});

// ===== User Profile Schemas =====

export const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  party_affiliation: z.string().max(50).optional(),
  jurisdiction_state: z.string().max(2).optional(),
  jurisdiction_district: z.string().max(20).optional(),
});

// ===== Validation Helper =====

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors, data: null };
  }
  return { valid: true, errors: null, data: result.data };
}
