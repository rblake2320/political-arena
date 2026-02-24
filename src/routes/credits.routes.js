/**
 * Arena — Credits Routes
 * Check balance, admin grant credits
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import {
  requireAuth, requireRole, requireCandidateStaff,
  successResponse, errorResponse, parseBody,
} from '../middleware.js';
import { validate, grantCreditsSchema } from '../validation.js';

const router = Router({ base: '/api/credits' });

/**
 * GET /api/credits/:candidateId — Get credit balance
 * Requires candidate staff or admin
 */
router.get('/:candidateId', async (request, env) => {
  const { candidateId } = request.params;
  const err = await requireCandidateStaff(request, env, candidateId);
  if (err) return err;

  const candidate = await env.ARENA_DB.prepare(
    `SELECT id, name, credit_balance FROM candidates WHERE id = ?`
  ).bind(candidateId).first();
  if (!candidate) return errorResponse('Candidate not found', 404);

  // Also get recent transactions
  const transactions = await env.ARENA_DB.prepare(
    `SELECT id, amount, transaction_type, description, reference_id, created_at FROM credit_transactions WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(candidateId).all();

  return successResponse({
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    credit_balance: candidate.credit_balance,
    transactions: transactions.results,
  });
});

/**
 * POST /api/credits/:candidateId/grant — Admin grants credits
 * Body: { amount, description? }
 */
router.post('/:candidateId/grant', async (request, env) => {
  const roleCheck = requireRole('admin', 'super_admin');
  const err = await roleCheck(request, env);
  if (err) return err;

  const { candidateId } = request.params;
  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid JSON body');

  const { valid, errors, data } = validate(grantCreditsSchema, body);
  if (!valid) return errorResponse(errors.join(', '));

  const candidate = await env.ARENA_DB.prepare(
    `SELECT id, credit_balance FROM candidates WHERE id = ?`
  ).bind(candidateId).first();
  if (!candidate) return errorResponse('Candidate not found', 404);

  const txId = generateId('ctx');
  await env.ARENA_DB.batch([
    env.ARENA_DB.prepare(
      `UPDATE candidates SET credit_balance = credit_balance + ? WHERE id = ?`
    ).bind(data.amount, candidateId),
    env.ARENA_DB.prepare(
      `INSERT INTO credit_transactions (id, candidate_id, amount, transaction_type, description) VALUES (?, ?, ?, 'grant', ?)`
    ).bind(txId, candidateId, data.amount, data.description || `Admin grant by ${request.user.display_name}`),
  ]);

  return successResponse({
    candidate_id: candidateId,
    credit_balance: candidate.credit_balance + data.amount,
    transaction_id: txId,
  });
});

// 404
router.all('*', () => errorResponse('Credits endpoint not found', 404));

export default router;
