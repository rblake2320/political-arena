/**
 * Arena — Public transparency routes
 * Signed receipt bundles, the keys that sign them, and published audit roots.
 * Everything here is public and read-only: a voter should be able to check
 * the record without an account and without trusting this server.
 */

import { Router } from 'itty-router';
import { errorResponse, json, parsePagination, successResponse } from '../middleware.js';
import { buildReceiptBundle, listReceiptKeys } from '../receipt-bundle.js';

const router = Router({ base: '/api/transparency' });

// GET /api/transparency/keys — public keys that sign receipt bundles
router.get('/keys', async (request, env) => {
  let keys;
  try {
    keys = await listReceiptKeys(env);
  } catch (error) {
    console.error('Receipt signing key error:', error);
    return errorResponse('Receipt signing key is misconfigured', 503);
  }
  return successResponse({
    signing_configured: keys.some(k => k.status === 'active'),
    key_id_rule: 'First 16 hex characters of SHA-256 over the raw 32-byte Ed25519 public key.',
    keys,
  });
});

// GET /api/transparency/anchors — published audit roots (no ledger contents)
router.get('/anchors', async (request, env) => {
  const { limit, offset, page } = parsePagination(new URL(request.url));
  const result = await env.ARENA_DB.prepare(
    `SELECT id as anchor_id, scope_type, entry_count, from_created_at, through_created_at,
            merkle_root, manifest_hash, anchored_at
     FROM audit_anchors
     WHERE scope_type = 'global'
     ORDER BY anchored_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return successResponse({
    anchors: result.results || [],
    page,
    limit,
    note: 'Save or archive these roots. A receipt bundle that proves inclusion under a root you recorded earlier cannot have been rewritten since.',
  });
});

// GET /api/transparency/receipts/:id/bundle — signed evidence bundle for one receipt
router.get('/receipts/:id/bundle', async (request, env) => {
  let bundle;
  try {
    bundle = await buildReceiptBundle(env, request.params.id, { origin: new URL(request.url).origin });
  } catch (error) {
    console.error('Receipt bundle error:', error);
    return errorResponse('Receipt bundle is unavailable', 503);
  }
  if (!bundle) return errorResponse('Challenge receipt not found', 404);

  const slug = bundle.payload.receipt.challenge.public_receipt_slug || bundle.payload.receipt.challenge.id;
  const response = json({ success: true, data: bundle });
  response.headers.set('Content-Disposition', `inline; filename="arena-receipt-${String(slug).replace(/[^A-Za-z0-9_-]/g, '_')}.json"`);
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

router.all('*', () => errorResponse('Transparency endpoint not found', 404));

export default router;
