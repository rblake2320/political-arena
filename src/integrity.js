/**
 * Arena — Participation integrity helpers
 *
 * Keeps the public "unanswered" record from being manufactured by a
 * coordinated group: duplicate detection, surge limits for brand-new
 * accounts, and a self-reported jurisdiction label on voter actions.
 *
 * Jurisdiction here is SELF-REPORTED profile data. It is a label for readers,
 * never proof of residency or voter eligibility, and it never blocks an action.
 */

export const JURISDICTION_LABELS = ['in_jurisdiction', 'in_state', 'outside', 'not_stated'];

// Offices decided by a whole state: any resident of the state is a constituent.
const STATEWIDE_OFFICES = new Set(['Senate', 'Governor']);

function normalizeState(value) {
  const state = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(state) ? state : '';
}

/**
 * District numbers arrive as "7", "07", "TX-07", "At-Large", "AL", "00".
 * Reduce to a comparable token; '' means unknown.
 */
export function normalizeDistrict(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (/^(AL|AT[- ]?LARGE|0+)$/.test(raw)) return '0';
  const digits = raw.match(/(\d+)\s*$/);
  if (!digits) return '';
  return String(parseInt(digits[1], 10));
}

/**
 * Compare a user's self-reported location with a race.
 * @returns {'in_jurisdiction'|'in_state'|'outside'|'not_stated'}
 */
export function jurisdictionMatch(user, race) {
  const userState = normalizeState(user?.jurisdiction_state);
  const raceState = normalizeState(race?.state);
  if (!userState || !raceState) return 'not_stated';
  if (userState !== raceState) return 'outside';
  if (STATEWIDE_OFFICES.has(race.office)) return 'in_jurisdiction';

  const raceDistrict = normalizeDistrict(race.district);
  // A race with no district recorded is treated as covering the state.
  if (!raceDistrict && !String(race.district || '').trim()) return 'in_jurisdiction';
  const userDistrict = normalizeDistrict(user.jurisdiction_district);
  if (!userDistrict || !raceDistrict) return 'in_state';
  return userDistrict === raceDistrict ? 'in_jurisdiction' : 'in_state';
}

/**
 * Collapse a question to the form used for duplicate detection: Unicode
 * compatibility folding, lowercase, punctuation and spacing removed. Two
 * postings that differ only by case, spacing, punctuation or look-alike
 * full-width characters produce the same text.
 */
export function normalizeQuestionText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export async function questionFingerprint(text) {
  const normalized = normalizeQuestionText(text);
  if (!normalized) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function positiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Tunable limits; every value has a safe default and can be set per deployment. */
export function integrityLimits(env) {
  return {
    questionsPerUserPerDay: positiveInt(env?.QUESTION_MAX_PER_USER_PER_DAY, 15),
    questionsPerUserPerRacePerDay: positiveInt(env?.QUESTION_MAX_PER_USER_PER_RACE_PER_DAY, 5),
    raceSurgePerHour: positiveInt(env?.QUESTION_RACE_SURGE_PER_HOUR, 30),
    newAccountDays: positiveInt(env?.QUESTION_NEW_ACCOUNT_DAYS, 7),
    inboundChallengesPerTargetPerDay: positiveInt(env?.MAX_INBOUND_CHALLENGES_PER_TARGET_PER_DAY, 6),
  };
}

/** Empty vote breakdown, one counter per jurisdiction label. */
export function emptyVoteBreakdown() {
  return { in_jurisdiction: 0, in_state: 0, outside: 0, not_stated: 0 };
}
