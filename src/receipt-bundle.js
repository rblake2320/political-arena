/**
 * Arena — Signed receipt evidence bundles
 *
 * A bundle is a self-contained, Ed25519-signed snapshot of one public callout
 * receipt: the claim, its sources and scores, the response, the hash-chained
 * audit trail and (when one exists) a Merkle inclusion proof against a
 * published audit anchor. Anyone can verify it offline with
 * src/receipt-verify.js — no trust in this server required.
 *
 * Signing key: RECEIPT_SIGNING_KEY, a base64 PKCS#8 Ed25519 private key set
 * as a Worker secret. Without it bundles are returned UNSIGNED and say so;
 * the platform never invents a key.
 */

import { computeFactScore, getRecitesForContent } from './routes/recites.routes.js';
import {
  BUNDLE_SCHEMA, base64UrlToBytes, bytesToBase64Url, canonicalJson, keyIdForPublicKey, merkleProof, sha256Hex,
} from './receipt-verify.js';

// Anchors cover the whole ledger; building a proof loads every leaf. Above
// this size the proof is omitted (and the bundle says why) rather than
// risking a slow public endpoint.
const MAX_PROOF_LEAVES = 20000;

const signerCache = new Map();

function decodeBase64Any(text) {
  const cleaned = String(text || '').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return base64UrlToBytes(cleaned.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

/**
 * Load the signing key once per isolate. Returns null when no key is
 * configured; throws when a key is configured but unusable, so a broken
 * secret is loud instead of silently producing unsigned receipts.
 */
export async function getReceiptSigner(env) {
  const secret = env?.RECEIPT_SIGNING_KEY;
  if (!secret) return null;
  if (signerCache.has(secret)) return signerCache.get(secret);

  const promise = (async () => {
    // Extractable only so the public half can be read back; the private key never leaves this function.
    const privateKey = await crypto.subtle.importKey('pkcs8', decodeBase64Any(secret), { name: 'Ed25519' }, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    if (!jwk.x) throw new Error('RECEIPT_SIGNING_KEY has no public component');
    const publicKey = jwk.x;
    return { privateKey, publicKey, keyId: await keyIdForPublicKey(publicKey) };
  })();
  signerCache.set(secret, promise);
  try {
    return await promise;
  } catch (error) {
    signerCache.delete(secret);
    throw new Error(`RECEIPT_SIGNING_KEY is not a valid Ed25519 PKCS#8 key: ${error.message}`);
  }
}

/** Public keys readers may trust: the active key plus any retired ones. */
export async function listReceiptKeys(env) {
  const keys = [];
  const signer = await getReceiptSigner(env);
  if (signer) keys.push({ key_id: signer.keyId, alg: 'Ed25519', public_key: signer.publicKey, status: 'active' });

  for (const raw of String(env?.RECEIPT_RETIRED_PUBLIC_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)) {
    try {
      if (base64UrlToBytes(raw).length !== 32) continue;
      if (keys.some(k => k.public_key === raw)) continue;
      keys.push({ key_id: await keyIdForPublicKey(raw), alg: 'Ed25519', public_key: raw, status: 'retired' });
    } catch {
      // Ignore malformed retired keys; never publish something unverifiable.
    }
  }
  return keys;
}

function publicChallenge(row) {
  return {
    id: row.id,
    public_receipt_slug: row.public_receipt_slug,
    race: { id: row.race_id, name: row.race_name, office: row.race_office, state: row.race_state, district: row.race_district },
    challenger: { candidate_id: row.challenger_candidate_id, name: row.challenger_name, party: row.challenger_party },
    target: { candidate_id: row.target_candidate_id, name: row.target_name, party: row.target_party },
    challenge_type: row.challenge_type,
    claim_text: row.claim_text,
    challenge_text: row.challenge_text,
    dispute_summary: row.dispute_summary,
    requested_response: row.requested_response,
    media_url: row.media_url,
    status: row.status,
    created_at: row.created_at,
    response_deadline: row.response_deadline,
    responded_at: row.responded_at,
    expired_at: row.expired_at,
    refused_at: row.refused_at,
    refusal_reason: row.refusal_reason,
    notice_status: row.notice_status,
    notice_served_at: row.notice_served_at,
  };
}

function publicRecite(r) {
  return {
    id: r.id, url: r.url, title: r.title, publisher: r.publisher ?? null, source_type: r.source_type,
    stance: r.stance, status: r.status, claim_text: r.claim_text ?? null,
    quote: r.quote ?? null, source_published_at: r.source_published_at ?? null, accessed_at: r.accessed_at ?? null,
    archive_url: r.archive_url ?? null, review_note: r.review_note ?? null, created_at: r.created_at,
  };
}

// Fields hashed into each audit entry that must never be published.
const PRIVATE_EVENT_FIELDS = ['ip_address', 'metadata'];

function bundleEntry(row) {
  const withheld = PRIVATE_EVENT_FIELDS.filter(field => row[field] != null);
  const event = {
    id: row.id, actor_id: row.actor_id, actor_type: row.actor_type, action: row.action,
    entity_type: row.entity_type, entity_id: row.entity_id,
    before_state: row.before_state, after_state: row.after_state, created_at: row.created_at,
  };
  // With nothing withheld the reader gets every hashed field and can recompute the hash.
  if (withheld.length === 0) Object.assign(event, { metadata: null, ip_address: null });
  return { chain_seq: row.chain_seq, prev_hash: row.prev_hash ?? null, entry_hash: row.entry_hash, withheld, event };
}

async function buildAnchorSection(db, entries) {
  if (entries.length === 0) return null;
  // Newest anchor that covers the most recent entry of this receipt.
  const latest = entries[entries.length - 1];
  const anchor = await db.prepare(
    `SELECT aa.id, aa.merkle_root, aa.manifest_hash, aa.entry_count, aa.anchored_at, aa.storage_key
     FROM audit_anchors aa
     JOIN audit_anchor_entries aae ON aae.anchor_id = aa.id
     WHERE aae.audit_log_id = ?
     ORDER BY aa.anchored_at DESC LIMIT 1`
  ).bind(latest.id).first()
    // Otherwise the newest anchor that covers any of it.
    || await db.prepare(
      `SELECT DISTINCT aa.id, aa.merkle_root, aa.manifest_hash, aa.entry_count, aa.anchored_at, aa.storage_key
       FROM audit_anchors aa
       JOIN audit_anchor_entries aae ON aae.anchor_id = aa.id
       WHERE aae.entity_type = 'challenge' AND aae.entity_id = ?
       ORDER BY aa.anchored_at DESC LIMIT 1`
    ).bind(latest.entity_id).first();
  if (!anchor) return null;

  const section = {
    anchor_id: anchor.id,
    merkle_root: anchor.merkle_root,
    manifest_hash: anchor.manifest_hash,
    entry_count: anchor.entry_count,
    anchored_at: anchor.anchored_at,
    storage_key: anchor.storage_key,
    proofs: [],
  };
  if (anchor.entry_count > MAX_PROOF_LEAVES) {
    section.proof_omitted_reason = `anchor covers ${anchor.entry_count} entries, above the ${MAX_PROOF_LEAVES} proof limit`;
    return section;
  }

  const leavesResult = await db.prepare(
    `SELECT audit_log_id, entry_hash FROM audit_anchor_entries
     WHERE anchor_id = ? ORDER BY audit_created_at ASC, audit_log_id ASC`
  ).bind(anchor.id).all();
  const leaves = (leavesResult.results || []);
  const hashes = leaves.map(l => l.entry_hash);
  const indexById = new Map(leaves.map((l, i) => [l.audit_log_id, i]));

  for (const entry of entries) {
    const index = indexById.get(entry.id);
    if (index === undefined || hashes[index] !== entry.entry_hash) continue; // written after this anchor
    const { root, path } = await merkleProof(hashes, index);
    if (root !== anchor.merkle_root) {
      // The stored leaves no longer reproduce the anchored root. Say so; never attach a proof that cannot verify.
      section.proofs = [];
      section.proof_omitted_reason = 'stored anchor entries do not reproduce the anchored root';
      return section;
    }
    section.proofs.push({ entry_hash: entry.entry_hash, leaf_index: index, path });
  }
  section.entries_after_anchor = entries.length - section.proofs.length;
  return section;
}

/**
 * Build (and sign, when a key is configured) the bundle for a visible callout.
 * @returns {Promise<object|null>} null when the receipt does not exist or is hidden
 */
export async function buildReceiptBundle(env, idOrSlug, { origin = null } = {}) {
  const db = env.ARENA_DB;
  const challenge = await db.prepare(
    `SELECT ch.*,
      cc.name as challenger_name, cc.party as challenger_party,
      tc.name as target_name, tc.party as target_party,
      r.name as race_name, r.office as race_office, r.state as race_state, r.district as race_district
     FROM challenges ch
     JOIN candidates cc ON ch.challenger_candidate_id = cc.id
     JOIN candidates tc ON ch.target_candidate_id = tc.id
     JOIN races r ON ch.race_id = r.id
     WHERE (ch.id = ? OR ch.public_receipt_slug = ?) AND ch.is_visible = 1`
  ).bind(idOrSlug, idOrSlug).first();
  if (!challenge) return null;

  const [response, challengeRecites, auditResult] = await Promise.all([
    db.prepare(
      `SELECT cr.id, cr.response_text, cr.media_url, cr.created_at, c.name as candidate_name, c.party as candidate_party
       FROM challenge_responses cr JOIN candidates c ON cr.candidate_id = c.id
       WHERE cr.challenge_id = ?`
    ).bind(challenge.id).first(),
    getRecitesForContent(db, 'challenge', challenge.id, false),
    db.prepare(
      `SELECT * FROM audit_log
       WHERE entity_type = 'challenge' AND entity_id = ?
       ORDER BY chain_seq ASC, created_at ASC, id ASC`
    ).bind(challenge.id).all(),
  ]);
  const responseRecites = response ? await getRecitesForContent(db, 'challenge_response', response.id, false) : [];

  const allEntries = auditResult.results || [];
  const chained = allEntries.filter(row => row.chain_seq != null && row.entry_hash);

  const receipt = {
    challenge: publicChallenge(challenge),
    response: response || null,
    recites: challengeRecites.map(publicRecite),
    response_recites: responseRecites.map(publicRecite),
    fact_score: computeFactScore(challengeRecites),
    response_fact_score: computeFactScore(responseRecites),
  };

  const payload = {
    schema: BUNDLE_SCHEMA,
    generated_at: new Date().toISOString(),
    issuer: origin,
    receipt_url: origin ? `${origin}/challenge/${challenge.public_receipt_slug || challenge.id}` : null,
    receipt,
    receipt_digest: await sha256Hex(canonicalJson(receipt)),
    audit_entries: chained.map(bundleEntry),
    legacy_unchained_entries: allEntries.length - chained.length,
    anchor: await buildAnchorSection(db, chained),
    limits: [
      'Fact scores are derived from the listed sources and their review status. They are not a ruling on truth.',
      'Entries marked withheld contain private fields; their hashes are covered by the signature and chain links.',
      'A valid signature proves the platform issued this snapshot. It does not prove the underlying claim.',
    ],
  };

  const signer = await getReceiptSigner(env);
  if (!signer) return { payload, signature: null, signing: { configured: false } };

  const signatureBytes = await crypto.subtle.sign(
    { name: 'Ed25519' }, signer.privateKey, new TextEncoder().encode(canonicalJson(payload)),
  );
  return {
    payload,
    signature: {
      alg: 'Ed25519',
      key_id: signer.keyId,
      public_key: signer.publicKey,
      signed: 'canonical-json(payload), UTF-8',
      value: bytesToBase64Url(signatureBytes),
    },
    signing: { configured: true },
  };
}
