/**
 * Signed receipt bundles — real worker, real D1, real R2, real Ed25519.
 *
 * Proves a voter can verify a public receipt offline, and that every way of
 * tampering with a bundle (edited claim, swapped key, reordered or dropped
 * audit entries, forged anchor proof) is detected by the verifier.
 */
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUNDLE_SCHEMA, bytesToBase64Url, canonicalJson, computeEntryHash, keyIdForPublicKey,
  merkleProof, merkleRootFromProof, sha256Hex, verifyReceiptBundle,
} from '../src/receipt-verify.js';
import { buildReceiptBundle, getReceiptSigner, listReceiptKeys } from '../src/receipt-bundle.js';
import { verifyAuditChain } from '../src/audit.js';

const BASE = 'https://example.com';
const PASSWORD = 'Str0ng!Passw0rd';
let seq = 0;

async function api(method, path, body, token, ip = '203.0.113.9') {
  const headers = { 'CF-Connecting-IP': ip };
  const init = { method, headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function account(label, role = 'voter') {
  seq += 1;
  const res = await api('POST', '/api/auth/register', {
    email: `rb-${label}-${seq}-${Date.now().toString(36)}@example.com`,
    username: `rb_${label}_${seq}`.slice(0, 30),
    password: PASSWORD,
    display_name: `RB ${label}`,
  }, undefined, `198.51.${Math.floor(seq / 250)}.${seq % 250}`); // registration is rate-limited per address
  expect(res.status).toBe(200);
  const id = res.body.data.user.id;
  await env.ARENA_DB.prepare(`UPDATE users SET email_verified = 1, role = ? WHERE id = ?`).bind(role, id).run();
  return { id, token: res.body.data.token };
}

/** A real fact-check callout, answered through the API, so the audit chain is real. */
async function issueAnsweredCallout() {
  seq += 1;
  const raceId = `race-rb-${seq}`;
  const a = `cand-rb-a-${seq}`;
  const b = `cand-rb-b-${seq}`;
  const staffA = await account('staffa');
  const staffB = await account('staffb');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(`INSERT INTO races (id, name, office, state, district) VALUES (?, ?, 'House', 'NC', '04')`).bind(raceId, `RB race ${seq}`),
    env.ARENA_DB.prepare(`INSERT INTO candidates (id, race_id, name, party, verification_status, credit_balance) VALUES (?, ?, 'Bundle Challenger', 'Independent', 'verified', 5)`).bind(a, raceId),
    env.ARENA_DB.prepare(`INSERT INTO candidates (id, race_id, name, party, verification_status, credit_balance) VALUES (?, ?, 'Bundle Target', 'Independent', 'verified', 5)`).bind(b, raceId),
    env.ARENA_DB.prepare(`INSERT INTO candidate_staff_links (id, user_id, candidate_id, role) VALUES (?, ?, ?, 'primary')`).bind(`csl-rb-a-${seq}`, staffA.id, a),
    env.ARENA_DB.prepare(`INSERT INTO candidate_staff_links (id, user_id, candidate_id, role) VALUES (?, ?, ?, 'primary')`).bind(`csl-rb-b-${seq}`, staffB.id, b),
  ]);

  const created = await api('POST', '/api/challenges', {
    race_id: raceId,
    challenger_candidate_id: a,
    target_candidate_id: b,
    challenge_type: 'fact_check',
    claim_text: 'The target voted against the 2025 bridge repair appropriation.',
    challenge_text: 'Explain your recorded vote against the 2025 bridge repair appropriation.',
    initial_recites: [{
      url: 'https://example.org/roll-call/2025/118',
      title: 'Roll call 118 — bridge repair appropriation',
      source_type: 'official_record',
      stance: 'supports',
      quote: 'Nay',
    }],
  }, staffA.token);
  expect(created.status).toBe(200);
  const id = created.body.data.id;

  const responded = await api('POST', `/api/challenges/${id}/respond`, {
    response_text: 'I voted no because the bill removed the rural bridge set-aside.',
  }, staffB.token);
  expect(responded.status).toBe(200);
  return { id, raceId };
}

const clone = value => JSON.parse(JSON.stringify(value));
const statusOf = (result, id) => result.checks.find(c => c.id === id)?.status;

let trustedKeys;
let admin;

beforeAll(async () => {
  await SELF.fetch(`${BASE}/api/health`);
  admin = await account('admin', 'admin');
  const keys = await api('GET', '/api/transparency/keys');
  expect(keys.status).toBe(200);
  expect(keys.body.data.signing_configured).toBe(true);
  trustedKeys = keys.body.data.keys.map(k => k.public_key);
});

describe('receipt keys', () => {
  it('publishes the active public key with a derivable key id and never the private key', async () => {
    const res = await api('GET', '/api/transparency/keys');
    const [key] = res.body.data.keys;
    expect(key.status).toBe('active');
    expect(key.alg).toBe('Ed25519');
    expect(key.key_id).toBe(await keyIdForPublicKey(key.public_key));
    expect(JSON.stringify(res.body)).not.toContain(env.RECEIPT_SIGNING_KEY);
    expect(JSON.stringify(res.body)).not.toContain(env.RECEIPT_SIGNING_KEY.slice(-20));
  });

  it('lists retired keys, skips malformed ones, and never duplicates the active key', async () => {
    const signer = await getReceiptSigner(env);
    const retired = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const keys = await listReceiptKeys({
      ...env,
      RECEIPT_RETIRED_PUBLIC_KEYS: `${retired}, not-a-key!!, ${bytesToBase64Url(new Uint8Array(8))}, ${signer.publicKey}`,
    });
    expect(keys.map(k => k.status)).toEqual(['active', 'retired']);
    expect(keys[1].public_key).toBe(retired);
  });

  it('fails loudly on a corrupt signing secret instead of issuing unsigned receipts', async () => {
    await expect(getReceiptSigner({ RECEIPT_SIGNING_KEY: 'bm90LWEta2V5' })).rejects.toThrow(/not a valid Ed25519/);
  });
});

describe('signed bundle', () => {
  it('verifies end to end: signature, trusted key, digest and an unbroken chain', async () => {
    const { id } = await issueAnsweredCallout();
    const res = await api('GET', `/api/transparency/receipts/${id}/bundle`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const bundle = res.body.data;

    expect(bundle.payload.schema).toBe(BUNDLE_SCHEMA);
    expect(bundle.payload.receipt.challenge.claim_text).toContain('bridge repair');
    expect(bundle.payload.receipt.response.response_text).toContain('rural bridge');
    expect(bundle.payload.receipt.recites).toHaveLength(1);
    expect(bundle.payload.audit_entries.length).toBeGreaterThanOrEqual(2);

    const result = await verifyReceiptBundle(bundle, { trustedKeys });
    expect(result.checks.filter(c => c.status === 'fail')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('verified');
    expect(statusOf(result, 'signature')).toBe('pass');
    expect(statusOf(result, 'key_trust')).toBe('pass');
    expect(statusOf(result, 'chain')).toBe('pass');
    expect(statusOf(result, 'receipt_digest')).toBe('pass');
    // No anchor has been published for this receipt yet: reported honestly, not as a pass.
    expect(statusOf(result, 'anchor')).toBe('skipped');
  });

  it('resolves by public slug and returns 404 for hidden or unknown receipts', async () => {
    const { id } = await issueAnsweredCallout();
    const row = await env.ARENA_DB.prepare(`SELECT public_receipt_slug FROM challenges WHERE id = ?`).bind(id).first();
    expect((await api('GET', `/api/transparency/receipts/${row.public_receipt_slug}/bundle`)).status).toBe(200);
    expect((await api('GET', '/api/transparency/receipts/does-not-exist/bundle')).status).toBe(404);

    await env.ARENA_DB.prepare(`UPDATE challenges SET is_visible = 0 WHERE id = ?`).bind(id).run();
    expect((await api('GET', `/api/transparency/receipts/${id}/bundle`)).status).toBe(404);
  });

  it('never leaks network addresses, user emails or internal metadata', async () => {
    const { id } = await issueAnsweredCallout();
    const stored = await env.ARENA_DB.prepare(
      `SELECT COUNT(*) as cnt FROM audit_log WHERE entity_type = 'challenge' AND entity_id = ? AND ip_address IS NOT NULL`
    ).bind(id).first();
    expect(stored.cnt).toBeGreaterThan(0); // the private data exists server-side…

    const text = JSON.stringify((await api('GET', `/api/transparency/receipts/${id}/bundle`)).body);
    expect(text).not.toContain('203.0.113.9'); // …and is not in the bundle
    expect(text).not.toContain('@example.com');
    expect(text).not.toContain('password');
    const bundle = JSON.parse(text).data;
    for (const entry of bundle.payload.audit_entries.filter(e => e.withheld.length)) {
      expect(entry.event).not.toHaveProperty('ip_address');
      expect(entry.event).not.toHaveProperty('metadata');
    }
  });

  it('lets a reader recompute entry hashes whenever nothing private is withheld', async () => {
    const { id } = await issueAnsweredCallout();
    const bundle = (await api('GET', `/api/transparency/receipts/${id}/bundle`)).body.data;
    const open = bundle.payload.audit_entries.filter(e => e.withheld.length === 0);
    for (const entry of open) {
      expect(await computeEntryHash(entry.prev_hash, entry.event)).toBe(entry.entry_hash);
    }
    // The bundle's chain agrees with the server's own chain verification.
    const serverSide = await verifyAuditChain(env.ARENA_DB, { entityType: 'challenge', entityId: id });
    expect(serverSide.status).toBe('verified');
    expect(bundle.payload.audit_entries.at(-1).entry_hash).toBe(serverSide.latest_hash);
  });

  it('returns an explicitly unsigned bundle when no key is configured, and the verifier rejects it', async () => {
    const { id } = await issueAnsweredCallout();
    const bundle = await buildReceiptBundle({ ARENA_DB: env.ARENA_DB }, id, { origin: BASE });
    expect(bundle.signature).toBeNull();
    expect(bundle.signing.configured).toBe(false);
    const result = await verifyReceiptBundle(bundle, { trustedKeys });
    expect(result.ok).toBe(false);
    expect(statusOf(result, 'signature')).toBe('fail');
  });
});

describe('tampering is detected', () => {
  let bundle;
  beforeAll(async () => {
    const { id } = await issueAnsweredCallout();
    bundle = (await api('GET', `/api/transparency/receipts/${id}/bundle`)).body.data;
    expect((await verifyReceiptBundle(bundle, { trustedKeys })).verdict).toBe('verified');
  });

  it('edited claim text', async () => {
    const forged = clone(bundle);
    forged.payload.receipt.challenge.claim_text = 'The target voted FOR the appropriation.';
    const result = await verifyReceiptBundle(forged, { trustedKeys });
    expect(result.ok).toBe(false);
    expect(statusOf(result, 'signature')).toBe('fail');
    expect(statusOf(result, 'receipt_digest')).toBe('fail');
  });

  it('edited claim with the digest recomputed to match still fails the signature', async () => {
    const forged = clone(bundle);
    forged.payload.receipt.challenge.status = 'expired';
    forged.payload.receipt_digest = await sha256Hex(canonicalJson(forged.payload.receipt));
    const result = await verifyReceiptBundle(forged, { trustedKeys });
    expect(statusOf(result, 'receipt_digest')).toBe('pass');
    expect(statusOf(result, 'signature')).toBe('fail');
    expect(result.ok).toBe(false);
  });

  it('removed response (hiding that the target answered)', async () => {
    const forged = clone(bundle);
    forged.payload.receipt.response = null;
    expect((await verifyReceiptBundle(forged, { trustedKeys })).ok).toBe(false);
  });

  it('fact score altered', async () => {
    const forged = clone(bundle);
    forged.payload.receipt.fact_score = { ...forged.payload.receipt.fact_score, score: 0 };
    expect((await verifyReceiptBundle(forged, { trustedKeys })).ok).toBe(false);
  });

  it('dropped audit entry', async () => {
    const forged = clone(bundle);
    forged.payload.audit_entries.shift();
    const result = await verifyReceiptBundle(forged, { trustedKeys });
    expect(statusOf(result, 'chain')).toBe('fail');
  });

  it('reordered audit entries', async () => {
    const forged = clone(bundle);
    forged.payload.audit_entries.reverse();
    expect(statusOf(await verifyReceiptBundle(forged, { trustedKeys }), 'chain')).toBe('fail');
  });

  it('re-signed with an attacker key: signature is valid but the key is not trusted', async () => {
    const attacker = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const publicKey = bytesToBase64Url(await crypto.subtle.exportKey('raw', attacker.publicKey));
    const forged = clone(bundle);
    forged.payload.receipt.challenge.claim_text = 'Forged claim signed by someone else.';
    forged.payload.receipt_digest = await sha256Hex(canonicalJson(forged.payload.receipt));
    forged.signature = {
      alg: 'Ed25519',
      key_id: await keyIdForPublicKey(publicKey),
      public_key: publicKey,
      signed: 'canonical-json(payload), UTF-8',
      value: bytesToBase64Url(await crypto.subtle.sign({ name: 'Ed25519' }, attacker.privateKey, new TextEncoder().encode(canonicalJson(forged.payload)))),
    };

    const withTrust = await verifyReceiptBundle(forged, { trustedKeys });
    expect(statusOf(withTrust, 'signature')).toBe('pass');
    expect(statusOf(withTrust, 'key_trust')).toBe('fail');
    expect(withTrust.ok).toBe(false);

    // Without a trusted key list the verifier refuses to call it verified.
    const withoutTrust = await verifyReceiptBundle(forged);
    expect(statusOf(withoutTrust, 'key_trust')).toBe('skipped');
    expect(withoutTrust.verdict).toBe('consistent_untrusted_key');
  });

  it('key id that does not belong to the key', async () => {
    const forged = clone(bundle);
    forged.signature.key_id = '0000000000000000';
    const result = await verifyReceiptBundle(forged, { trustedKeys });
    expect(statusOf(result, 'key_id')).toBe('fail');
  });

  it('signature stripped, truncated, or wrong algorithm', async () => {
    for (const mutate of [
      b => { b.signature = null; },
      b => { b.signature.value = b.signature.value.slice(0, 40); },
      b => { b.signature.value = '!!not base64!!'; },
      b => { b.signature.alg = 'none'; },
      b => { b.signature.public_key = bytesToBase64Url(new Uint8Array(31)); },
    ]) {
      const forged = clone(bundle);
      mutate(forged);
      const result = await verifyReceiptBundle(forged, { trustedKeys });
      expect(result.ok).toBe(false);
      expect(statusOf(result, 'signature')).toBe('fail');
    }
  });

  it('garbage input never throws', async () => {
    for (const input of [null, undefined, 'text', 42, [], {}, { payload: null }, { payload: { schema: 'other/v9' } }]) {
      const result = await verifyReceiptBundle(input, { trustedKeys });
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe('invalid');
    }
  });
});

describe('anchor inclusion proofs', () => {
  it('Merkle proofs round-trip for every leaf, including odd-sized trees', async () => {
    for (const size of [1, 2, 3, 5, 8, 13]) {
      const leaves = await Promise.all(Array.from({ length: size }, (_, i) => sha256Hex(`leaf-${size}-${i}`)));
      const roots = new Set();
      for (let i = 0; i < size; i++) {
        const { root, path } = await merkleProof(leaves, i);
        roots.add(root);
        expect(await merkleRootFromProof(leaves[i], path)).toBe(root);
        if (size > 1) {
          // A proof for one leaf must not validate a different leaf.
          expect(await merkleRootFromProof(leaves[(i + 1) % size], path)).not.toBe(root);
        }
      }
      expect(roots.size).toBe(1);
    }
    await expect(merkleProof(['a'], 3)).rejects.toThrow();
  });

  it('proves the receipt is under a published anchor root that the public list also shows', async () => {
    const { id } = await issueAnsweredCallout();
    const published = await api('POST', '/api/audit/anchors', {}, admin.token);
    expect(published.status).toBe(200);
    const anchor = published.body.data.anchor;

    const bundle = (await api('GET', `/api/transparency/receipts/${id}/bundle`)).body.data;
    expect(bundle.payload.anchor.anchor_id).toBe(anchor.id);
    expect(bundle.payload.anchor.merkle_root).toBe(anchor.merkle_root);
    expect(bundle.payload.anchor.proofs).toHaveLength(bundle.payload.audit_entries.length);

    const result = await verifyReceiptBundle(bundle, { trustedKeys });
    expect(statusOf(result, 'anchor')).toBe('pass');
    expect(result.verdict).toBe('verified');

    // The same root is on the public, unauthenticated anchor list — with no ledger contents.
    const list = await api('GET', '/api/transparency/anchors');
    expect(list.status).toBe(200);
    const listed = list.body.data.anchors.find(a => a.anchor_id === anchor.id);
    expect(listed.merkle_root).toBe(anchor.merkle_root);
    expect(JSON.stringify(list.body)).not.toContain('storage_key');
    expect(JSON.stringify(list.body)).not.toContain('created_by');
  });

  it('reports entries written after the anchor instead of claiming they are covered', async () => {
    seq += 1;
    const { id } = await issueAnsweredCallout();
    await api('POST', '/api/audit/anchors', {}, admin.token);
    // A later moderation action extends the chain past the anchor.
    const hidden = await api('PUT', `/api/challenges/${id}/visibility`, { is_visible: false, reason: 'test hide after anchor' }, admin.token);
    expect(hidden.status).toBe(200);
    await env.ARENA_DB.prepare(`UPDATE challenges SET is_visible = 1 WHERE id = ?`).bind(id).run();

    const bundle = (await api('GET', `/api/transparency/receipts/${id}/bundle`)).body.data;
    expect(bundle.payload.anchor.entries_after_anchor).toBeGreaterThanOrEqual(1);
    expect(bundle.payload.anchor.proofs.length).toBe(bundle.payload.audit_entries.length - bundle.payload.anchor.entries_after_anchor);
    expect(statusOf(await verifyReceiptBundle(bundle, { trustedKeys }), 'anchor')).toBe('pass');
  });

  it('detects a forged proof, a swapped root, and a proof for an entry not in the bundle', async () => {
    const { id } = await issueAnsweredCallout();
    await api('POST', '/api/audit/anchors', {}, admin.token);
    const bundle = (await api('GET', `/api/transparency/receipts/${id}/bundle`)).body.data;

    const badPath = clone(bundle);
    badPath.payload.anchor.proofs[0].path[0].hash = await sha256Hex('forged sibling');
    expect(statusOf(await verifyReceiptBundle(badPath, { trustedKeys }), 'anchor')).toBe('fail');

    const badRoot = clone(bundle);
    badRoot.payload.anchor.merkle_root = await sha256Hex('a different history');
    expect(statusOf(await verifyReceiptBundle(badRoot, { trustedKeys }), 'anchor')).toBe('fail');

    const foreign = clone(bundle);
    foreign.payload.anchor.proofs[0].entry_hash = await sha256Hex('entry from another receipt');
    expect(statusOf(await verifyReceiptBundle(foreign, { trustedKeys }), 'anchor')).toBe('fail');

    const malformed = clone(bundle);
    malformed.payload.anchor.proofs[0].path = [{ side: 'up', hash: 'x' }];
    expect(statusOf(await verifyReceiptBundle(malformed, { trustedKeys }), 'anchor')).toBe('fail');
  });

  it('withholds the proof rather than attaching one that cannot verify when stored leaves were altered', async () => {
    const { id } = await issueAnsweredCallout();
    const anchor = (await api('POST', '/api/audit/anchors', {}, admin.token)).body.data.anchor;
    // Simulate database tampering with the stored anchor leaves.
    await env.ARENA_DB.prepare(
      `UPDATE audit_anchor_entries SET entry_hash = ? WHERE anchor_id = ? AND entity_id != ? AND rowid = (
         SELECT MIN(rowid) FROM audit_anchor_entries WHERE anchor_id = ? AND entity_id != ?)`
    ).bind(await sha256Hex('tampered leaf'), anchor.id, id, anchor.id, id).run();

    const bundle = (await api('GET', `/api/transparency/receipts/${id}/bundle`)).body.data;
    expect(bundle.payload.anchor.proofs).toEqual([]);
    expect(bundle.payload.anchor.proof_omitted_reason).toContain('do not reproduce');
    expect(statusOf(await verifyReceiptBundle(bundle, { trustedKeys }), 'anchor')).toBe('skipped');
  });
});

describe('launch readiness', () => {
  it('reports the receipt signing gate with the active key id', async () => {
    const res = await api('GET', '/api/stats/readiness', undefined, admin.token);
    expect(res.status).toBe(200);
    const signer = await getReceiptSigner(env);
    expect(res.body.data.gates.receipt_signing.ok).toBe(true);
    expect(res.body.data.gates.receipt_signing.key_id).toBe(signer.keyId);
  });
});
