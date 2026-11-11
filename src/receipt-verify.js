/**
 * Arena — Receipt bundle verifier (dependency-free, runs anywhere)
 *
 * The SAME file verifies a bundle in the Worker tests, in the browser
 * (/verify page) and offline in Node (scripts/verify-receipt-bundle.mjs).
 * It uses only WebCrypto and makes no network calls, so a reader does not
 * have to trust this website to check a receipt.
 *
 * What each check does and does NOT prove is stated in its `detail` text.
 */

export const BUNDLE_SCHEMA = 'arena.receipt-bundle/v1';

// ---------- canonical JSON (must match src/audit.js exactly) ----------

function normalizeForHash(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeForHash);
  return Object.keys(value).sort().reduce((normalized, key) => {
    normalized[key] = normalizeForHash(value[key]);
    return normalized;
  }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeForHash(value));
}

// ---------- encoding + hashing ----------

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/** Key id = first 16 hex characters of SHA-256 over the raw 32-byte public key. */
export async function keyIdForPublicKey(publicKeyBase64Url) {
  return (await sha256Hex(base64UrlToBytes(publicKeyBase64Url))).slice(0, 16);
}

// ---------- audit entry + Merkle math (must match src/audit.js) ----------

export async function computeEntryHash(prevHash, event) {
  return sha256Hex(canonicalJson({
    prev_hash: prevHash ?? null,
    timestamp: event.created_at,
    event_data: {
      id: event.id,
      actor_id: event.actor_id ?? null,
      actor_type: event.actor_type,
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      before_state: event.before_state ?? null,
      after_state: event.after_state ?? null,
      metadata: event.metadata ?? null,
      ip_address: event.ip_address ?? null,
      created_at: event.created_at,
    },
  }));
}

export async function merkleParent(left, right) {
  return sha256Hex(canonicalJson({ left, right }));
}

/** Build the inclusion path for leaf `index`; an odd last node pairs with itself. */
export async function merkleProof(leaves, index) {
  if (!Array.isArray(leaves) || index < 0 || index >= leaves.length) throw new Error('Leaf index out of range');
  const path = [];
  let layer = [...leaves];
  let position = index;
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      if (i === position || i + 1 === position) {
        path.push(position === i ? { side: 'right', hash: right } : { side: 'left', hash: left });
      }
      next.push(await merkleParent(left, right));
    }
    position = Math.floor(position / 2);
    layer = next;
  }
  return { root: layer[0], path };
}

export async function merkleRootFromProof(leaf, path) {
  let hash = leaf;
  for (const step of path) {
    if (!step || typeof step.hash !== 'string' || !['left', 'right'].includes(step.side)) {
      throw new Error('Malformed proof step');
    }
    hash = step.side === 'left' ? await merkleParent(step.hash, hash) : await merkleParent(hash, step.hash);
  }
  return hash;
}

// ---------- verification ----------

const HEX64 = /^[0-9a-f]{64}$/;

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

async function verifySignature(bundle, trustedKeys) {
  const sig = bundle.signature;
  if (!sig) {
    return [check('signature', 'Signed by the platform key', 'fail',
      'This bundle is unsigned. Nothing proves it came from the platform or is unaltered.')];
  }
  const results = [];
  let signatureValid = false;
  try {
    if (sig.alg !== 'Ed25519') throw new Error(`Unsupported algorithm ${sig.alg}`);
    const publicKeyBytes = base64UrlToBytes(sig.public_key);
    if (publicKeyBytes.length !== 32) throw new Error('Public key must be 32 bytes');
    const key = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']);
    signatureValid = await crypto.subtle.verify(
      { name: 'Ed25519' }, key, base64UrlToBytes(sig.value),
      new TextEncoder().encode(canonicalJson(bundle.payload)),
    );
    results.push(check('signature', 'Signed by the stated key', signatureValid ? 'pass' : 'fail', signatureValid
      ? 'The Ed25519 signature matches every byte of the bundle contents. Any edit would break it.'
      : 'The signature does not match the contents. The bundle was altered or the signature is forged.'));
    const expectedKeyId = await keyIdForPublicKey(sig.public_key);
    if (sig.key_id !== expectedKeyId) {
      results.push(check('key_id', 'Key id matches the key', 'fail', 'The stated key id does not belong to the public key in the bundle.'));
    }
  } catch (error) {
    results.push(check('signature', 'Signed by the stated key', 'fail', `Signature could not be checked: ${error.message}`));
  }

  if (!Array.isArray(trustedKeys)) {
    results.push(check('key_trust', 'Key belongs to the platform', 'skipped',
      'No trusted key list was supplied. Compare the key id below with the keys the platform publishes, or with a copy you saved earlier.'));
  } else {
    const trusted = signatureValid && trustedKeys.includes(sig.public_key);
    results.push(check('key_trust', 'Key belongs to the platform', trusted ? 'pass' : 'fail', trusted
      ? 'The signing key is in the trusted key list you supplied.'
      : 'The signing key is NOT in the trusted key list. Anyone can sign a bundle with their own key.'));
  }
  return results;
}

async function verifyChain(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [check('chain', 'Audit chain is unbroken', 'skipped', 'The bundle contains no hash-chained audit entries.')];
  }
  const problems = [];
  let previousHash = null;
  let recomputed = 0;
  let attested = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const where = `entry ${i + 1}`;
    if (!HEX64.test(entry.entry_hash || '')) { problems.push(`${where}: malformed hash`); continue; }
    if (entry.chain_seq !== i + 1) problems.push(`${where}: sequence is ${entry.chain_seq}, expected ${i + 1} (an entry is missing or reordered)`);
    if ((entry.prev_hash ?? null) !== previousHash) problems.push(`${where}: does not link to the entry before it`);

    const withheld = Array.isArray(entry.withheld) ? entry.withheld : [];
    if (withheld.length === 0 && entry.event) {
      const expected = await computeEntryHash(entry.prev_hash ?? null, entry.event);
      if (expected !== entry.entry_hash) problems.push(`${where}: contents do not produce its hash`);
      else recomputed += 1;
    } else {
      attested += 1;
    }
    previousHash = entry.entry_hash;
  }

  const results = [check('chain', 'Audit chain is unbroken', problems.length ? 'fail' : 'pass', problems.length
    ? problems.join('; ')
    : `All ${entries.length} entries link in order with no gaps.`)];
  results.push(check('entry_hashes', 'Entry contents match their hashes', problems.length ? 'fail' : recomputed > 0 ? 'pass' : 'skipped',
    `${recomputed} of ${entries.length} entries were recomputed from their full contents. `
    + `${attested} include private fields (such as a network address) that are withheld, so their hashes are covered by the signature and the chain links but cannot be recomputed by you.`));
  return results;
}

async function verifyAnchor(payload) {
  const anchor = payload.anchor;
  if (!anchor) {
    return [check('anchor', 'Included in a published anchor', 'skipped',
      'No external anchor covers this receipt yet. The chain is internally consistent but has no outside witness.')];
  }
  const problems = [];
  if (!HEX64.test(anchor.merkle_root || '')) problems.push('malformed anchor root');
  const chainHashes = new Set((payload.audit_entries || []).map(e => e.entry_hash));
  const proofs = Array.isArray(anchor.proofs) ? anchor.proofs : [];
  if (proofs.length === 0) {
    return [check('anchor', 'Included in a published anchor', problems.length ? 'fail' : 'skipped',
      problems.join('; ') || `Anchor ${anchor.anchor_id} is referenced but inclusion proofs were not attached${anchor.proof_omitted_reason ? ` (${anchor.proof_omitted_reason})` : ''}.`)];
  }
  for (const proof of proofs) {
    if (!chainHashes.has(proof.entry_hash)) { problems.push('a proof refers to an entry that is not in this bundle'); continue; }
    try {
      const root = await merkleRootFromProof(proof.entry_hash, proof.path || []);
      if (root !== anchor.merkle_root) problems.push(`entry ${proof.entry_hash.slice(0, 12)}… is not under the anchor root`);
    } catch (error) {
      problems.push(error.message);
    }
  }
  return [check('anchor', 'Included in a published anchor', problems.length ? 'fail' : 'pass', problems.length
    ? problems.join('; ')
    : `${proofs.length} entries are provably included under anchor root ${anchor.merkle_root.slice(0, 16)}… (anchored ${anchor.anchored_at}). `
      + 'To rule out a rewritten history, compare that root with one recorded independently at the time (the public anchor list, a news archive, or your own saved copy).')];
}

/** Accept either the bare bundle or the API envelope `{ success, data }` a download contains. */
export function unwrapBundle(value) {
  if (value && typeof value === 'object' && !value.payload && value.data && typeof value.data === 'object' && value.data.payload) {
    return value.data;
  }
  return value;
}

/**
 * Verify a receipt bundle.
 * @param {object} bundle - parsed bundle JSON
 * @param {{trustedKeys?: string[]}} [options] - base64url public keys you already trust
 * @returns {Promise<{ok: boolean, verdict: string, key_id: string|null, checks: object[]}>}
 */
export async function verifyReceiptBundle(bundle, options = {}) {
  const checks = [];
  bundle = unwrapBundle(bundle);
  if (!bundle || typeof bundle !== 'object' || !bundle.payload || typeof bundle.payload !== 'object') {
    return { ok: false, verdict: 'invalid', key_id: null, checks: [check('format', 'Recognized bundle format', 'fail', 'This is not an Arena receipt bundle.')] };
  }
  const payload = bundle.payload;
  if (payload.schema !== BUNDLE_SCHEMA) {
    return { ok: false, verdict: 'invalid', key_id: null, checks: [check('format', 'Recognized bundle format', 'fail', `Unknown bundle schema: ${String(payload.schema)}`)] };
  }
  checks.push(check('format', 'Recognized bundle format', 'pass', BUNDLE_SCHEMA));

  checks.push(...await verifySignature(bundle, options.trustedKeys));

  const digest = await sha256Hex(canonicalJson(payload.receipt ?? null));
  checks.push(check('receipt_digest', 'Receipt text matches its digest', digest === payload.receipt_digest ? 'pass' : 'fail',
    digest === payload.receipt_digest
      ? `The claim, sources, scores and response hash to ${digest.slice(0, 16)}…`
      : 'The receipt contents do not match the digest stated in the bundle.'));

  checks.push(...await verifyChain(payload.audit_entries));
  checks.push(...await verifyAnchor(payload));

  const failed = checks.some(c => c.status === 'fail');
  const signed = checks.find(c => c.id === 'signature')?.status === 'pass';
  const trust = checks.find(c => c.id === 'key_trust')?.status;
  const verdict = failed ? 'failed' : signed && trust === 'pass' ? 'verified' : 'consistent_untrusted_key';
  return { ok: !failed, verdict, key_id: bundle.signature?.key_id ?? null, checks };
}
