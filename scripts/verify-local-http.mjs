import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Intentionally local-only: this script creates a synthetic account and PNG.
const base = new URL(process.argv[2] || 'http://127.0.0.1:8787');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') {
  throw new Error('HTTP acceptance must target a local Wrangler instance');
}
const receipt = { base: base.origin, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), checks: [] };
const request = (path, init = {}) => fetch(new URL(path, base), { ...init, signal: AbortSignal.timeout(15000) });
async function check(name, action) {
  const started = performance.now();
  try {
    const observed = await action();
    receipt.checks.push({ name, status: 'Worked', duration_ms: Math.round(performance.now() - started), observed });
  } catch (error) {
    receipt.checks.push({ name, status: 'Failed', error: error.message });
    throw error;
  }
}

try {
  await check('Worker health', async () => {
    const res = await request('/api/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).database, 'ok');
    return { status: res.status, database: 'ok' };
  });
  await check('Built SPA deep link', async () => {
    const res = await request('/settings');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /assets\/index-.*\.js/);
    assert.ok(res.headers.get('Content-Security-Policy'));
    return { status: 200, built_asset: true, csp: true };
  });
  await check('Race directory', async () => {
    const res = await request('/api/races?status=all&limit=600');
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.ok(data.races.length > 0);
    return { status: 200, races: data.races.length, total: data.total };
  });

  const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  let token, user;
  const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  await check('Synthetic registration', async () => {
    const res = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `http-${nonce}@example.com`, username: `http_${nonce}`, display_name: 'Local acceptance fixture', password: `Test-${nonce}-9!aA` }) });
    assert.ok([200, 201].includes(res.status), `register status ${res.status}`);
    const body = await res.json();
    assert.equal(body.success, true);
    ({ token, user } = body.data);
    assert.ok(token && user.id);
    return { status: res.status, role: user.role };
  });
  await check('Authenticated profile', async () => {
    const res = await request('/api/users/me', { headers: headers() });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.id, user.id);
    return { status: 200 };
  });
  const key = `uploads/${user.id}/media_${nonce}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/p8AAAAASUVORK5CYII=', 'base64');
  await check('Real local R2 image upload', async () => {
    const form = new FormData();
    form.set('key', key);
    form.set('file', new Blob([png], { type: 'image/png' }), 'fixture.png');
    const res = await request('/api/uploads/direct', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    return { status: 200, bytes: png.length };
  });
  let etag;
  await check('Media content and metadata', async () => {
    const res = await request(`/media/${key}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
    etag = res.headers.get('ETag');
    assert.ok(etag);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
    return { status: 200, bytes: png.length, etag };
  });
  await check('HEAD ignores Range and has no body', async () => {
    const res = await request(`/media/${key}`, { method: 'HEAD', headers: { Range: 'bytes=2-4' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Length'), String(png.length));
    assert.equal((await res.arrayBuffer()).byteLength, 0);
    return { status: 200, content_length: png.length, body_bytes: 0 };
  });
  await check('ETag revalidation', async () => {
    const res = await request(`/media/${key}`, { headers: { 'If-None-Match': `W/${etag}` } });
    assert.equal(res.status, 304);
    assert.equal((await res.arrayBuffer()).byteLength, 0);
    return { status: 304, body_bytes: 0 };
  });
  await check('Matching If-Range streams exact bytes', async () => {
    const res = await request(`/media/${key}`, { headers: { Range: 'bytes=2-4', 'If-Range': etag } });
    assert.equal(res.status, 206);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png.subarray(2, 5));
    return { status: 206, body_bytes: 3, content_range: res.headers.get('Content-Range') };
  });
  await check('Stale If-Range returns whole object', async () => {
    const res = await request(`/media/${key}`, { headers: { Range: 'bytes=2-4', 'If-Range': '"old"' } });
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
    return { status: 200, body_bytes: png.length };
  });
  await check('Invalid range is contained', async () => {
    const res = await request(`/media/${key}`, { headers: { Range: 'bytes=999999-' } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    return { status: 416 };
  });
  await check('Public error and crawler security headers', async () => {
    const statuses = {};
    for (const [path, expected] of [['/media/uploads/missing.png', 404], ['/robots.txt', 200], ['/sitemap.xml', 200]]) {
      const res = await request(path);
      assert.equal(res.status, expected);
      assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
      statuses[path] = res.status;
    }
    return statuses;
  });
  await check('Logout revokes the real session', async () => {
    assert.equal((await request('/api/auth/logout', { method: 'POST', headers: headers() })).status, 200);
    assert.equal((await request('/api/users/me', { headers: headers() })).status, 401);
    return { logout: 200, revoked_session: 401 };
  });
} catch {
  process.exitCode = 1;
} finally {
  receipt.finished = new Date().toISOString();
  receipt.passed = receipt.checks.filter(c => c.status === 'Worked').length;
  receipt.failed = receipt.checks.filter(c => c.status === 'Failed').length;
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
