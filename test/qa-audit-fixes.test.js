/**
 * QA-audit remediation tests — account management, report-abuse, AI-media
 * disclosure, and the SEO surfaces (robots/sitemap/OG injection).
 */
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const BASE = 'https://example.com';
const VALID_PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await SELF.fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (p, b, t) => req('POST', p, b, t);
const put = (p, b, t) => req('PUT', p, b, t);
const get = (p, t) => req('GET', p, undefined, t);

async function registerUser(label) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const res = await post('/api/auth/register', {
    email: `${label}-${suffix}@example.com`,
    username: `qa_${label}_${suffix}`.slice(0, 30),
    password: VALID_PASSWORD,
    display_name: `QA ${label}`,
  });
  expect(res.status).toBe(200);
  return { token: res.body.data.token, id: res.body.data.user.id, email: res.body.data.user.email };
}

describe('account management', () => {
  it('change-password requires the current password, rotates it, and revokes other sessions', async () => {
    const user = await registerUser('pwchange');
    const otherLogin = await post('/api/auth/login', { email: user.email, password: VALID_PASSWORD });
    const otherToken = otherLogin.body.data.token;

    const wrong = await post('/api/auth/change-password', { current_password: 'Wrong!Pass1', new_password: 'N3w!Passw0rd' }, user.token);
    expect(wrong.status).toBe(403);

    const ok = await post('/api/auth/change-password', { current_password: VALID_PASSWORD, new_password: 'N3w!Passw0rd' }, user.token);
    expect(ok.status).toBe(200);

    // old password no longer works; new one does
    expect((await post('/api/auth/login', { email: user.email, password: VALID_PASSWORD })).status).toBe(401);
    expect((await post('/api/auth/login', { email: user.email, password: 'N3w!Passw0rd' })).status).toBe(200);

    // the other session was revoked; the current one survives
    expect((await get('/api/users/me', otherToken)).status).toBe(401);
    expect((await get('/api/users/me', user.token)).status).toBe(200);
  });

  it('profile update works via PUT /users/me', async () => {
    const user = await registerUser('profileedit');
    const res = await put('/api/users/me', { display_name: 'Renamed Citizen', party_affiliation: 'Independent', jurisdiction_state: 'AL' }, user.token);
    expect(res.status).toBe(200);
    const me = await get('/api/users/me', user.token);
    expect(me.body.data.display_name).toBe('Renamed Citizen');
    expect(me.body.data.jurisdiction_state).toBe('AL');
  });

  it('export returns the user data bundle', async () => {
    const user = await registerUser('exporter');
    const res = await get('/api/users/me/export', user.token);
    expect(res.status).toBe(200);
    expect(res.body.data.profile.id).toBe(user.id);
    expect(Array.isArray(res.body.data.questions)).toBe(true);
    expect(Array.isArray(res.body.data.recites)).toBe(true);
  });

  it('delete anonymizes PII, revokes sessions, and frees nothing silently', async () => {
    const user = await registerUser('deleter');
    const bad = await post('/api/users/me/delete', { password: 'Wrong!Pass1', confirm: 'DELETE' }, user.token);
    expect(bad.status).toBe(403);
    const res = await post('/api/users/me/delete', { password: VALID_PASSWORD, confirm: 'DELETE' }, user.token);
    expect(res.status).toBe(200);

    const row = await env.ARENA_DB.prepare(`SELECT email, username, display_name, is_active FROM users WHERE id = ?`).bind(user.id).first();
    expect(row.email).toContain('@deleted.invalid');
    expect(row.display_name).toBe('Deleted account');
    expect(row.is_active).toBe(0);
    expect((await get('/api/users/me', user.token)).status).toBe(401);
    // old email can no longer log in
    expect((await post('/api/auth/login', { email: user.email, password: VALID_PASSWORD })).status).toBe(401);
  });
});

describe('report abuse', () => {
  it('signed-in users can report content; moderators see and resolve it', async () => {
    const reporter = await registerUser('reporter');
    const modUser = await registerUser('reportmod');
    await env.ARENA_DB.prepare(`UPDATE users SET role = 'moderator', verification_status = 'verified', email_verified = 1 WHERE id = ?`).bind(modUser.id).run();

    const bogus = await post('/api/moderation/reports', { content_type: 'ad', content_id: 'does-not-exist', category: 'spam' }, reporter.token);
    expect(bogus.status).toBe(404);

    const res = await post('/api/moderation/reports', { content_type: 'ad', content_id: 'ad-1', category: 'defamation', details: 'Test report details' }, reporter.token);
    expect(res.status).toBe(200);
    const reportId = res.body.data.id;

    const list = await get('/api/moderation/reports', modUser.token);
    expect(list.status).toBe(200);
    const mine = (list.body.data.reports || []).find(r => r.id === reportId);
    expect(mine).toBeTruthy();
    expect(mine.notes).toContain('[defamation]');

    expect((await get('/api/moderation/reports', reporter.token)).status).toBe(403);

    const resolved = await put(`/api/moderation/reports/${reportId}/resolve`, { outcome: 'overturned', resolution_notes: 'No violation.' }, modUser.token);
    expect(resolved.status).toBe(200);
    const after = await get('/api/moderation/reports', modUser.token);
    expect((after.body.data.reports || []).some(r => r.id === reportId)).toBe(false);
  });
});

describe('AI media disclosure', () => {
  it('ads store and return the ai_disclosure flag', async () => {
    const staff = await registerUser('aistaff');
    await env.ARENA_DB.batch([
      env.ARENA_DB.prepare(`INSERT OR IGNORE INTO candidate_staff_links (id, user_id, candidate_id, role, is_active) VALUES (?, ?, 'cand-1', 'primary', 1)`).bind(`qa-ai-${staff.id}`, staff.id),
      env.ARENA_DB.prepare(`UPDATE candidates SET verification_status = 'verified' WHERE id = 'cand-1'`),
    ]);
    const res = await post('/api/ads', {
      race_id: 'race-1', candidate_id: 'cand-1', title: 'AI disclosure test ad',
      ad_content_text: 'Contains AI-altered content, disclosed.', disclaimer_text: 'Paid for by QA.',
      media_type: 'text', ai_disclosure: true,
    }, staff.token);
    expect(res.status).toBe(200);
    const row = await env.ARENA_DB.prepare(`SELECT ai_disclosure FROM ad_flights WHERE id = ?`).bind(res.body.data.id).first();
    expect(row.ai_disclosure).toBe(1);
  });
});

describe('SEO surfaces', () => {
  it('serves robots.txt referencing the sitemap', async () => {
    const res = await SELF.fetch(`${BASE}/robots.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Sitemap:');
    expect(text).toContain('/sitemap.xml');
  });

  it('serves a sitemap with static, race, and receipt URLs', async () => {
    const res = await SELF.fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain(`${BASE}/what-matters`);
    expect(xml).toContain('/race/race-1');
    expect(xml).toContain('/privacy');
  });

  it('injects receipt metadata into the SPA shell for crawlers', async () => {
    const chal = await env.ARENA_DB.prepare(`SELECT COALESCE(public_receipt_slug, id) as slug FROM challenges WHERE is_visible = 1 LIMIT 1`).first();
    const res = await SELF.fetch(`${BASE}/challenge/${chal.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('og:title');
    expect(html).toContain('calls out');
    expect(html).toContain('Public Callout Receipt');
  });
});
