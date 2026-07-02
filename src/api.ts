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

// ---- Ads ----
export async function createAd(data: {
  race_id: string; candidate_id: string; title: string; ad_content_text: string;
  disclaimer_text: string; media_url?: string; media_type?: string; budget_cents?: number;
}) {
  return unwrap<any>(await api.post('/ads', data));
}

// ---- Rebuttals ----
export async function createRebuttal(data: {
  parent_ad_id: string; race_id: string; candidate_id: string;
  response_text: string; disclaimer_text: string; media_url?: string;
}) {
  return unwrap<any>(await api.post('/ads/rebuttals', data));
}

// ---- Challenges ----
export async function createChallenge(data: {
  race_id: string; challenger_candidate_id: string; target_candidate_id: string;
  challenge_text: string; challenge_type?: string;
  media_url?: string; deadline_business_days?: number;
}) {
  return unwrap<any>(await api.post('/challenges', data));
}

export async function respondToChallenge(challengeId: string, data: { response_text: string; media_url?: string }) {
  return unwrap<any>(await api.post(`/challenges/${challengeId}/respond`, data));
}

// ---- Media Uploads ----
export async function uploadMedia(file: File, candidateId?: string) {
  // First get a presigned key
  const presign = unwrap<{ key: string; upload_url: string; public_url: string; file_id: string }>(
    await api.post('/uploads/presign', { filename: file.name, content_type: file.type, candidate_id: candidateId })
  );
  // Then upload via direct endpoint
  const uploadForm = new FormData();
  uploadForm.append('file', file);
  uploadForm.append('key', presign.key);
  if (candidateId) uploadForm.append('candidate_id', candidateId);
  const result = unwrap<{ key: string; url: string; type: string; size: number }>(
    await api.post(presign.upload_url, uploadForm)
  );
  return result;
}

// ---- Reactions ----
export async function addReaction(data: { content_type: string; content_id: string; reaction_type: string }) {
  return unwrap<any>(await api.post('/reactions', data));
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

// ---- Surveys / What Matters ----
export async function getIssueCategories() {
  return unwrap<{ categories: any[] }>(await api.get('/surveys/issue-categories'));
}

export async function submitPriorities(data: { race_id?: string; priorities: { issue_category_id: string; priority_rank: number }[] }) {
  return unwrap<any>(await api.post('/surveys/my-priorities', data));
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
  return unwrap<any>(await api.put(`/notifications/${id}/read`));
}

export async function markAllNotificationsRead() {
  return unwrap<any>(await api.put('/notifications/read-all'));
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
  return unwrap<any>(await api.post(`/questions/${raceId}`, data));
}

export async function voteQuestion(questionId: string) {
  return unwrap<{ voted: boolean; vote_count: number }>(await api.post(`/questions/${questionId}/vote`));
}

// ---- Press Credentials ----
export async function registerPress(data: { outlet_name: string; outlet_type: string; proof_url?: string }) {
  return unwrap<any>(await api.post('/press/register', data));
}

export async function getPressStatus() {
  return unwrap<{ credential: any }>(await api.get('/press/my-status'));
}

// ---- Credits ----
export async function getCreditBalance(candidateId: string) {
  return unwrap<any>(await api.get(`/credits/${candidateId}`));
}

export async function grantCredits(candidateId: string, data: { amount: number; description?: string }) {
  return unwrap<any>(await api.post(`/credits/${candidateId}/grant`, data));
}

// ---- Analytics ----
export async function trackEvent(data: { event_type: string; event_data?: any; race_id?: string; candidate_id?: string }) {
  try { await api.post('/analytics/events', { events: [data] }); } catch {}
}

export default api;
