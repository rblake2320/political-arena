/**
 * Arena — API Service Layer
 * All calls go through axios with automatic auth token injection.
 */

import axios from 'axios';

// localStorage can throw (Safari private mode, storage disabled) — never let
// that take down the app. All token access goes through these helpers.
const TOKEN_KEY = 'arena_token';
export function getStoredToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setStoredToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}
export function clearStoredToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Inject auth token on every request; fix Content-Type for FormData uploads
api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Let browser set multipart boundary for FormData — don't force application/json
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// On 401, clear token and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearStoredToken();
      // Only redirect if not already on auth pages
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/register')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

// Helper to extract data from API response envelope
function unwrap<T>(res: { data: { success: boolean; data: T; error?: string } }): T {
  if (!res.data.success) {
    const err: any = new Error(res.data.error || 'API error');
    err.response = res; // Bug #5 fix: preserve response for callers
    throw err;
  }
  return res.data.data;
}

// ---- Auth ----
export async function register(data: { email: string; username: string; password: string; display_name: string; party_affiliation?: string; jurisdiction_state?: string }) {
  return unwrap<{ user: any; token: string }>(await api.post('/auth/register', data));
}

export async function login(data: { email: string; password: string }) {
  return unwrap<{ user: any; token: string }>(await api.post('/auth/login', data));
}

export async function forgotPassword(data: { email: string }) {
  return unwrap<{ message: string; dev_reset_token?: string; reset_url?: string }>(await api.post('/auth/forgot-password', data));
}

export async function resetPassword(data: { token: string; password: string }) {
  return unwrap<{ message: string }>(await api.post('/auth/reset-password', data));
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch {}
  clearStoredToken();
}

export async function getMe() {
  return unwrap<any>(await api.get('/users/me'));
}

// ---- Races ----
export async function getRaces(sort?: string) {
  const params = sort ? `?sort=${sort}` : '';
  return unwrap<{ races: any[]; total: number }>(await api.get(`/races${params}`));
}

export async function getRace(id: string) {
  return unwrap<any>(await api.get(`/races/${id}`));
}

export async function createRace(data: { name: string; office: string; state: string; district?: string }) {
  return unwrap<any>(await api.post('/races', data));
}

// ---- Candidates ----
export async function getCandidates(raceId?: string) {
  if (raceId) {
    return unwrap<{ candidates: any[] }>(await api.get(`/candidates/races/${raceId}`));
  }
  // No race filter — not supported by backend, return empty
  return { candidates: [] };
}

export async function getCandidatePublicProfile(candidateId: string) {
  return unwrap<any>(await api.get(`/candidates/${candidateId}/public-profile`));
}

export async function createCandidate(data: {
  race_id: string;
  name: string;
  party: string;
  biography?: string;
  issue_positions?: string[];
  website_url?: string;
}) {
  const result = unwrap<any>(await api.post('/candidates', data));
  void trackEvent({
    event_type: 'candidate_registered',
    race_id: data.race_id,
    candidate_id: result.id,
    content_type: 'candidate',
    content_id: result.id,
    metadata: { verification_status: result.verification_status || 'pending' },
  });
  return result;
}

// ---- Ads ----
export async function createAd(data: {
  race_id: string; candidate_id: string; title: string; ad_content_text: string;
  disclaimer_text: string; media_url?: string; media_type?: string; budget_cents?: number;
}) {
  const result = unwrap<any>(await api.post('/ads', data));
  void trackEvent({
    event_type: 'ad_created',
    race_id: data.race_id,
    candidate_id: data.candidate_id,
    content_type: 'ad',
    content_id: result.id,
    metadata: { status: result.status, media_type: data.media_type || 'text' },
  });
  return result;
}

// ---- Rebuttals ----
export async function createRebuttal(data: {
  parent_ad_id: string; race_id: string; candidate_id: string;
  response_text: string; disclaimer_text: string; media_url?: string;
}) {
  const result = unwrap<any>(await api.post('/ads/rebuttals', data));
  void trackEvent({
    event_type: 'rebuttal_created',
    race_id: data.race_id,
    candidate_id: data.candidate_id,
    content_type: 'rebuttal',
    content_id: result.id,
    metadata: { parent_ad_id: data.parent_ad_id, status: result.status },
  });
  return result;
}

export async function createExternalAdResponse(data: {
  race_id: string;
  source_candidate_id: string;
  responder_candidate_id: string;
  source_title: string;
  source_media_url: string;
  source_description?: string;
  source_disclaimer_text?: string;
  response_text: string;
  response_media_url?: string;
  disclaimer_text: string;
}) {
  const result = unwrap<{ ad_id: string; rebuttal_id: string; status: string }>(await api.post('/ads/external-response', data));
  void trackEvents([
    {
      event_type: 'external_ad_response_created',
      race_id: data.race_id,
      candidate_id: data.responder_candidate_id,
      content_type: 'ad',
      content_id: result.ad_id,
      metadata: { rebuttal_id: result.rebuttal_id, source_candidate_id: data.source_candidate_id },
    },
  ]);
  return result;
}

// ---- Challenges ----
export async function createChallenge(data: {
  race_id: string; challenger_candidate_id: string; target_candidate_id: string;
  challenge_text: string; challenge_type?: string;
  claim_text?: string; dispute_summary?: string; requested_response?: string;
  media_url?: string; deadline_business_days?: number;
  initial_recites?: {
    url: string;
    title: string;
    publisher?: string;
    source_type?: ReciteSourceType;
    stance?: ReciteStance;
    claim_text?: string;
    quote?: string;
    source_published_at?: string;
    accessed_at?: string;
    archive_url?: string;
    evidence_media_url?: string;
  }[];
}) {
  const result = unwrap<any>(await api.post('/challenges', data));
  void trackEvent({
    event_type: 'challenge_created',
    race_id: data.race_id,
    candidate_id: data.challenger_candidate_id,
    content_type: 'challenge',
    content_id: result.id,
    metadata: {
      challenge_type: data.challenge_type || 'open',
      target_candidate_id: data.target_candidate_id,
      initial_recites: data.initial_recites?.length || 0,
    },
  });
  return result;
}

export async function respondToChallenge(challengeId: string, data: { response_text: string; media_url?: string }) {
  const result = unwrap<any>(await api.post(`/challenges/${challengeId}/respond`, data));
  void trackEvent({
    event_type: 'challenge_responded',
    content_type: 'challenge',
    content_id: challengeId,
    metadata: { response_id: result.response_id, has_media: Boolean(data.media_url) },
  });
  return result;
}

export async function refuseChallenge(challengeId: string, data: { refusal_reason?: string }) {
  const result = unwrap<any>(await api.post(`/challenges/${challengeId}/refuse`, data));
  void trackEvent({
    event_type: 'challenge_refused',
    content_type: 'challenge',
    content_id: challengeId,
    metadata: { has_reason: Boolean(data.refusal_reason) },
  });
  return result;
}

export async function withdrawChallenge(challengeId: string) {
  const result = unwrap<any>(await api.post(`/challenges/${challengeId}/withdraw`, {}));
  void trackEvent({
    event_type: 'challenge_withdrawn',
    content_type: 'challenge',
    content_id: challengeId,
    metadata: { credit_refunded: Boolean(result.credit_refunded) },
  });
  return result;
}

// ---- Media Uploads ----
export async function uploadMedia(file: File, candidateId?: string) {
  // First get a presigned key
  const presign = unwrap<{ key: string; upload_url: string; public_url: string; file_id: string; content_type: string; media_kind: string }>(
    await api.post('/uploads/presign', { filename: file.name, content_type: file.type, candidate_id: candidateId })
  );
  // Then upload via direct endpoint
  const uploadForm = new FormData();
  uploadForm.append('file', file);
  uploadForm.append('key', presign.key);
  if (candidateId) uploadForm.append('candidate_id', candidateId);
  const result = unwrap<{ key: string; url: string; type: string; media_kind: string; size: number }>(
    await api.post(presign.upload_url, uploadForm)
  );
  void trackEvent({
    event_type: 'media_uploaded',
    candidate_id: candidateId,
    content_type: 'media',
    content_id: presign.file_id,
    metadata: { media_kind: result.media_kind, content_type: result.type, size: result.size },
  });
  return result;
}

// ---- Reactions ----
export async function addReaction(data: { content_type: string; content_id: string; reaction_type: string }) {
  const result = unwrap<any>(await api.post('/reactions', data));
  void trackEvent({
    event_type: 'reaction_added',
    content_type: data.content_type,
    content_id: data.content_id,
    metadata: { reaction_type: data.reaction_type },
  });
  return result;
}

export async function getReactions(contentType: string, contentId: string) {
  return unwrap<any>(await api.get('/reactions/counts', { params: { content_type: contentType, content_id: contentId } }));
}

export async function getMyReactions(contentType?: string, contentId?: string) {
  const params: Record<string, string> = {};
  if (contentType) params.content_type = contentType;
  if (contentId) params.content_id = contentId;
  return unwrap<any>(await api.get('/reactions/mine', { params }));
}

// ---- Recites / Fact Checks ----
export type ReciteContentType = 'ad' | 'rebuttal' | 'challenge' | 'challenge_response';
export type ReciteSourceType = 'official_record' | 'public_document' | 'court_record' | 'research' | 'news' | 'campaign_material' | 'other';
export type ReciteStance = 'supports' | 'refutes' | 'context';

export async function getRecites(contentType: ReciteContentType, contentId: string) {
  return unwrap<any>(await api.get('/recites', { params: { content_type: contentType, content_id: contentId } }));
}

export async function addRecite(data: {
  content_type: ReciteContentType;
  content_id: string;
  url: string;
  title: string;
  publisher?: string;
  source_type?: ReciteSourceType;
  stance: ReciteStance;
  claim_text?: string;
  quote?: string;
  source_published_at?: string;
  accessed_at?: string;
  archive_url?: string;
  evidence_media_url?: string;
}) {
  const result = unwrap<any>(await api.post('/recites', data));
  void trackEvent({
    event_type: 'recite_added',
    content_type: data.content_type,
    content_id: data.content_id,
    metadata: { recite_id: result.id, source_type: data.source_type || 'other', stance: data.stance },
  });
  return result;
}

export async function reviewRecite(id: string, status: 'pending' | 'verified' | 'rejected', review_note?: string) {
  const result = unwrap<any>(await api.put(`/recites/${id}/review`, { status, review_note }));
  void trackEvent({
    event_type: 'recite_reviewed',
    metadata: { recite_id: id, status },
  });
  return result;
}

export async function getPendingRecites(params?: { status?: 'pending' | 'verified' | 'rejected'; page?: number }) {
  return unwrap<any>(await api.get('/recites/pending', { params }));
}

export async function getChallengeReceipt(id: string) {
  return unwrap<any>(await api.get(`/challenges/${id}/receipt`));
}

// ---- Public Statement Ledger ----
export async function getCandidateStatements(candidateId: string, params?: { topic?: string; page?: number }) {
  return unwrap<any>(await api.get(`/statements/candidates/${candidateId}`, { params }));
}

export async function createStatement(data: {
  candidate_id: string;
  race_id?: string;
  statement_text: string;
  question_text?: string;
  response_text?: string;
  context_text?: string;
  topic?: string;
  source_type?: 'youtube' | 'video' | 'audio' | 'article' | 'debate' | 'social' | 'press_release' | 'other';
  source_url: string;
  source_title?: string;
  transcript_url?: string;
  transcript_text?: string;
  quote_start_seconds?: number;
  quote_end_seconds?: number;
  statement_at?: string;
}) {
  const result = unwrap<any>(await api.post('/statements', data));
  void trackEvent({
    event_type: 'statement_created',
    race_id: data.race_id,
    candidate_id: data.candidate_id,
    content_type: 'statement',
    content_id: result.id,
    metadata: { claim_key: result.claim_key, source_type: data.source_type || 'other', topic: data.topic || null },
  });
  return result;
}

export async function reviewStatement(id: string, data: {
  truth_status?: 'unreviewed' | 'supported' | 'disputed' | 'false' | 'mixed' | 'context_needed';
  answer_status?: 'answered' | 'partial' | 'dodged' | 'not_applicable' | 'unclear';
  evasion_score?: number;
  confidence_score?: number;
  review_note?: string;
}) {
  const result = unwrap<any>(await api.put(`/statements/${id}/review`, data));
  void trackEvent({
    event_type: 'statement_reviewed',
    content_type: 'statement',
    content_id: id,
    metadata: {
      truth_status: data.truth_status,
      answer_status: data.answer_status,
      evasion_score: data.evasion_score,
      confidence_score: data.confidence_score,
    },
  });
  return result;
}

// ---- Surveys / What Matters ----
export async function getIssueCategories() {
  return unwrap<{ categories: any[] }>(await api.get('/surveys/issue-categories'));
}

export async function submitPriorities(data: { race_id?: string; priorities: { issue_category_id: string; priority_rank: number }[]; write_ins?: string[] }) {
  const result = unwrap<any>(await api.post('/surveys/my-priorities', data));
  void trackEvent({
    event_type: 'issue_priorities_submitted',
    race_id: data.race_id,
    metadata: { count: data.priorities.length, write_ins_count: data.write_ins?.length || 0 },
  });
  return result;
}

export async function getMyPriorities(raceId?: string) {
  const params = raceId ? { race_id: raceId } : {};
  return unwrap<any>(await api.get('/surveys/my-priorities', { params }));
}

export async function getAggregatePriorities(params?: { state?: string; party?: string; race_id?: string }) {
  return unwrap<any>(await api.get('/surveys/priorities/aggregate', { params }));
}

export async function getCrossPartyOverlap(params?: { state?: string; race_id?: string }) {
  return unwrap<any>(await api.get('/surveys/cross-party-overlap', { params }));
}

// ---- Notifications ----
export async function subscribe(data: { subscription_type: 'race' | 'candidate' | 'challenge'; target_id: string; channel?: string; notify_on?: string[] }) {
  return unwrap<any>(await api.post('/notifications/subscribe', data));
}

export async function getNotifications(page?: number) {
  const params = page ? { page } : {};
  return unwrap<any>(await api.get('/notifications', { params }));
}

export async function getUnreadCount() {
  return unwrap<{ count: number }>(await api.get('/notifications/unread-count'));
}

export async function markNotificationRead(id: string) {
  const result = unwrap<any>(await api.put(`/notifications/${id}/read`));
  void trackEvent({ event_type: 'notification_read', content_type: 'notification', content_id: id });
  return result;
}

export async function markAllNotificationsRead() {
  const result = unwrap<any>(await api.put('/notifications/read-all'));
  void trackEvent({ event_type: 'notifications_read_all' });
  return result;
}

// ---- Questions ----
export async function getQuestions(raceId: string, sourceType?: string, page?: number) {
  const params: Record<string, string | number> = {};
  if (sourceType) params.source_type = sourceType;
  if (page) params.page = page;
  return unwrap<any>(await api.get(`/questions/${raceId}`, { params }));
}

export async function getTopQuestions(raceId: string) {
  return unwrap<{ voter_questions: any[]; press_questions: any[] }>(await api.get(`/questions/${raceId}/top`));
}

export async function submitQuestion(raceId: string, data: { source_type: string; question_text: string; media_url?: string }) {
  const result = unwrap<any>(await api.post(`/questions/${raceId}`, data));
  void trackEvent({
    event_type: 'question_submitted',
    race_id: raceId,
    content_type: 'question',
    content_id: result.id,
    metadata: { source_type: data.source_type, has_media: Boolean(data.media_url) },
  });
  return result;
}

export async function voteQuestion(questionId: string) {
  const result = unwrap<{ voted: boolean; vote_count: number }>(await api.post(`/questions/${questionId}/vote`));
  void trackEvent({
    event_type: result.voted ? 'question_upvoted' : 'question_unvoted',
    content_type: 'question',
    content_id: questionId,
    metadata: { vote_count: result.vote_count },
  });
  return result;
}

// ---- Press Credentials ----
export async function registerPress(data: { outlet_name: string; outlet_type: string; proof_url?: string }) {
  const result = unwrap<any>(await api.post('/press/register', data));
  void trackEvent({
    event_type: 'press_registered',
    content_type: 'press_credential',
    content_id: result.id,
    metadata: { outlet_type: data.outlet_type, has_proof_url: Boolean(data.proof_url) },
  });
  return result;
}

export async function getPressStatus() {
  return unwrap<{ credential: any }>(await api.get('/press/my-status'));
}

// ---- Credits ----
export async function getCreditBalance(candidateId: string) {
  return unwrap<any>(await api.get(`/credits/${candidateId}`));
}

export async function grantCredits(candidateId: string, data: { amount: number; description?: string }) {
  const result = unwrap<any>(await api.post(`/credits/${candidateId}/grant`, data));
  void trackEvent({
    event_type: 'credits_granted',
    candidate_id: candidateId,
    metadata: { amount: data.amount },
  });
  return result;
}

// ---- Analytics ----
export type AnalyticsEvent = {
  event_type: string;
  race_id?: string;
  candidate_id?: string;
  content_type?: string;
  content_id?: string;
  metadata?: any;
  event_data?: any;
};

function normalizeAnalyticsEvent(event: AnalyticsEvent) {
  const { event_data, metadata, ...rest } = event;
  return {
    ...rest,
    metadata: metadata ?? event_data ?? null,
  };
}

export async function trackEvent(data: AnalyticsEvent) {
  try { await api.post('/analytics/events', { events: [normalizeAnalyticsEvent(data)] }); } catch {}
}

export async function trackEvents(events: AnalyticsEvent[]) {
  const normalized = events.map(normalizeAnalyticsEvent);
  if (normalized.length === 0) return;
  try { await api.post('/analytics/events', { events: normalized }); } catch {}
}

export default api;
