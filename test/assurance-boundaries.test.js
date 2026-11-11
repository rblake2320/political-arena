import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

async function request(method, path, body, token) {
  const res = await SELF.fetch(`https://example.com${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}
it('email confirmation enables participation without granting identity or campaign authority', async () => {
  const reg = await request('POST','/api/auth/register', {
    email: 'assurance-boundary@example.com', username: 'assurance_boundary',
    display_name: 'Assurance fixture', password: 'Str0ng!Passw0rd',
    role: 'admin', email_verified: true, verification_status: 'verified',
  });
  expect(reg.status).toBe(200);
  const { token, user, dev_verification_token } = reg.body.data;
  expect(user.role).toBe('voter');
  expect(user.email_verified).toBe(false);
  const verify = await request('POST','/api/auth/verify-email',{token: dev_verification_token});
  expect(verify.status).toBe(200);
  const stored = await env.ARENA_DB.prepare('SELECT email_verified, verification_status, role FROM users WHERE id = ?').bind(user.id).first();
  expect(stored).toEqual({ email_verified: 1, verification_status: 'unverified', role: 'voter' });
  expect((await request('POST','/api/surveys/my-priorities',{ priorities: [{issue_category_id:'cat-1',priority_rank:1}] },token)).status).toBe(200);
  expect((await request('POST','/api/candidates/cand-1/verify',{action:'verify'},token)).status).toBe(403);
  expect((await request('PUT','/api/users/me',{role:'admin',email_verified:1,verification_status:'verified'},token)).status).toBe(400);
  expect((await request('POST','/api/auth/verify-email',{token:dev_verification_token})).status).toBe(400);
});
it('legacy generic verification cannot bypass email confirmation', async () => {
  const reg = await request('POST','/api/auth/register', {email:'legacy-assurance@example.com',username:'legacy_assurance',display_name:'Fixture',password:'Str0ng!Passw0rd'});
  expect(reg.status).toBe(200);
  await env.ARENA_DB.prepare("UPDATE users SET verification_status = 'verified', email_verified = 0 WHERE id = ?").bind(reg.body.data.user.id).run();
  expect((await request('POST','/api/surveys/my-priorities',{ priorities: [{issue_category_id:'cat-1',priority_rank:1}] },reg.body.data.token)).status).toBe(403);
});
it('directory pagination has stable tie ordering and no overlaps', async () => {
  await request('GET','/api/health');
  const ids = ['z-boundary-3','z-boundary-1','z-boundary-2'];
  await env.ARENA_DB.batch(ids.map(id => env.ARENA_DB.prepare("INSERT INTO races (id,name,office,state,status,created_at) VALUES (?, 'Tie fixture', 'Other', 'ZZ', 'active', '2026-01-01')").bind(id)));
  for (const sort of ['name','trending','newest']) {
    const pages = await Promise.all([1,2,3].map(page => request('GET',`/api/races?state=ZZ&status=all&sort=${sort}&limit=1&page=${page}`)));
    expect(pages.every(p => p.status === 200 && p.body.data.total === 3)).toBe(true);
    expect(pages.map(p => p.body.data.races[0].id)).toEqual([...ids].sort());
  }
  await env.ARENA_DB.batch(ids.map(id => env.ARENA_DB.prepare('DELETE FROM races WHERE id = ?').bind(id)));
});
