import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Real Worker -> local HTTP receiver -> real local D1 delivery ledger.
// Requires the synthetic email settings documented in README; never use
// real provider keys or a production database with this acceptance script.
const base = new URL(process.argv[2] || 'http://127.0.0.1:8787');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('Local Wrangler URL required');
let mode = 'accepted';
const calls = [];
const server = http.createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/emails');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer synthetic-test-only');
    let body = '';
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    assert.ok(message.to.every(email => email.endsWith('@example.com')));
    const id = `fixture-${crypto.randomUUID()}`;
    calls.push({ mode, subject: message.subject, id: mode === 'accepted' ? id : null, has_text: !!message.text, has_html: !!message.html });
    res.writeHead(mode === 'rejected' ? 422 : 200, { 'Content-Type': 'application/json' });
    res.end(mode === 'accepted' ? JSON.stringify({ id }) : mode === 'empty' ? '{}' : '{"message":"private-reset-token-fixture"}');
  } catch {
    res.writeHead(400); res.end('{}');
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8799, '127.0.0.1', resolve); });
const receipt = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), checks: [] };
function rows(email) {
  const result = execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'ARENA_DB', '--local', '--json', '--command', `SELECT status, provider_message_id, error_message, sent_at FROM email_deliveries WHERE recipient_email = '${email}' AND template_key = 'password_reset' ORDER BY rowid`], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  return JSON.parse(result)[0].results;
}
async function post(path, body) {
  const res = await fetch(new URL(path, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);
}
try {
  const nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `provider-${nonce}@example.com`;
  await post('/api/auth/register', { email, username: `provider_${nonce}`, display_name: 'Local email fixture', password: `Test-${nonce}-9!aA` });
  // Drain the verification request before changing the response contract.
  const until = Date.now() + 10000;
  while (!calls.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(calls.length, 'Worker never reached the local receiver; check .dev.vars endpoint and key');
  for (const scenario of ['accepted', 'empty', 'rejected']) {
    mode = scenario;
    const before = rows(email).length;
    await post('/api/auth/forgot-password', { email });
    let records;
    const deadline = Date.now() + 15000;
    do { records = rows(email); } while (records.length === before && Date.now() < deadline);
    const row = records.at(-1);
    assert.equal(records.length, before + 1);
    assert.equal(row.status, scenario === 'accepted' ? 'sent' : 'failed');
    if (scenario === 'accepted') {
      assert.equal(row.provider_message_id, calls.findLast(call => call.subject === 'Reset your Arena password').id);
      assert.ok(row.sent_at);
    } else {
      assert.equal(row.provider_message_id, null);
      assert.equal(row.sent_at, null);
      assert.ok(!row.error_message.includes('private-reset-token-fixture'));
    }
    receipt.checks.push({ name: scenario, status: 'Worked', observed: row });
  }
} catch (error) {
  receipt.checks.push({ name: mode, status: 'Failed', error: error.message });
  process.exitCode = 1;
} finally {
  await new Promise(resolve => server.close(resolve));
  receipt.requests = calls;
  receipt.finished = new Date().toISOString();
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
}
