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

// ===== Challenge Schemas =====

export const createChallengeSchema = z.object({
  race_id: z.string().min(1),
  target_candidate_id: z.string().min(1),
  challenger_candidate_id: z.string().min(1),
  challenge_text: z.string().min(10).max(2000),
  challenge_type: z.enum(['open', 'debate_request', 'fact_check', 'policy_question']).optional().default('open'),
  media_url: z.string().url().max(1000).optional(),
  deadline_business_days: z.number().int().min(3).max(10).optional().default(3),
});

export const respondToChallengeSchema = z.object({
  response_text: z.string().min(1).max(5000),
  media_url: z.string().url().max(1000).optional(),
});

export const refuseChallengeSchema = z.object({
  refusal_reason: z.string().max(1000).optional(),
});

// ===== Reaction Schemas =====

export const createReactionSchema = z.object({
  content_type: z.enum(['ad', 'rebuttal', 'challenge', 'challenge_response']),
  content_id: z.string().min(1),
  reaction_type: z.enum(['helpful', 'misleading', 'agree', 'disagree', 'important']),
});

// ===== Notification Schemas =====

export const subscribeSchema = z.object({
  subscription_type: z.enum(['race', 'candidate', 'challenge']),
  target_id: z.string().min(1),
  notify_on: z.array(z.string()).optional().default(['challenge_issued', 'challenge_responded', 'challenge_expired']),
  channel: z.enum(['in_app', 'email', 'both']).optional().default('in_app'),
});

// ===== Survey Schemas =====

export const submitPrioritiesSchema = z.object({
  race_id: z.string().optional().nullable(),
  priorities: z.array(z.object({
    issue_category_id: z.string().min(1),
    priority_rank: z.number().int().min(1).max(5),
  })).min(1).max(5),
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
