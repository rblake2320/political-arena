/**
 * Arena — Media Upload Routes
 * YouTube Shorts-style video uploads for candidates
 * Supports: video (mp4, webm, mov), images (jpg, png, gif, webp), audio
 * Only registered candidates (with staff links) can upload
 *
 * Flow:
 * 1. Client calls POST /api/uploads/presign with filename + content_type
 * 2. Server returns a presigned URL for direct R2 upload
 * 3. Client uploads directly to R2 via the presigned URL
 * 4. Client uses the returned public URL in ad/rebuttal/challenge forms
 *
 * Fallback (no R2): Direct upload to worker, stored as base64 in D1
 * (temporary, for development before R2 is enabled)
 */

import { Router } from 'itty-router';
import { generateId } from '../db.js';
import { requireAuth, errorResponse, successResponse, parseBody, getClientIP } from '../middleware.js';
import { auditLog } from '../audit.js';
import { resolveUploadType, r2MediaResponse, supportedMediaTypes } from '../media.js';

const router = Router({ base: '/api/uploads' });

// POST /api/uploads/presign — Get presigned URL for R2 upload (candidate staff only)
router.post('/presign', async (request, env, ctx) => {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  const body = await parseBody(request);
  if (!body) return errorResponse('Invalid request body');

  const { filename, content_type, candidate_id } = body;
  if (!filename) return errorResponse('filename required');

  // Verify content type. Some mobile browsers provide an empty MIME type, so
  // infer from filename extension when needed.
  const typeConfig = resolveUploadType(content_type, filename);
  if (!typeConfig) {
    return errorResponse(`Unsupported file type. Allowed: ${supportedMediaTypes().map(t => t.mime).join(', ')}`);
  }

  // Verify candidate staff authorization
  if (candidate_id) {
    const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
    if (!isAdmin) {
      const link = await env.ARENA_DB.prepare(
        `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
      ).bind(request.user.id, candidate_id).first();
      if (!link) return errorResponse('Only registered candidate staff can upload media', 403);
    }
  }

  const fileId = generateId('media');
  const key = `uploads/${candidate_id || request.user.id}/${fileId}.${typeConfig.ext}`;

  // If R2 is available, upload goes through the worker proxy endpoint
  if (env.ARENA_MEDIA) {
    return successResponse({
      upload_url: `/uploads/direct`,
      method: 'PUT',
      key,
      max_size: typeConfig.maxSize,
      content_type: typeConfig.mime,
      media_kind: typeConfig.kind,
      public_url: `/media/${key}`,
      file_id: fileId,
    });
  }

  // Fallback: direct upload endpoint (no R2)
  return successResponse({
    upload_url: `/uploads/direct`,
    method: 'POST',
    key,
    max_size: typeConfig.maxSize,
    content_type: typeConfig.mime,
    media_kind: typeConfig.kind,
    public_url: `/api/uploads/serve/${fileId}`,
    file_id: fileId,
    note: 'R2 not enabled — using direct upload fallback',
  });
});

// PUT/POST /api/uploads/direct — Direct upload through worker (proxy to R2 or fallback)
router.put('/direct', handleDirectUpload);
router.post('/direct', handleDirectUpload);

async function handleDirectUpload(request, env, ctx) {
  const authError = await requireAuth(request, env);
  if (authError) return authError;

  // Handle multipart form data
  const formData = await request.formData().catch(() => null);
  if (!formData) return errorResponse('Multipart form data required');

  const file = formData.get('file');
  const key = formData.get('key');
  const candidateId = formData.get('candidate_id');
  const candidateIdStr = candidateId ? String(candidateId) : '';

  if (!file || !key) return errorResponse('file and key required');

  // Validate key format — must be uploads/{userId_or_candidateId}/{media_xxx}.{ext}
  const keyStr = String(key);
  const keyPattern = /^uploads\/[a-zA-Z0-9_-]+\/media_[a-zA-Z0-9_-]+\.[a-z0-9]+$/;
  if (!keyPattern.test(keyStr)) {
    return errorResponse('Invalid upload key format', 400);
  }
  // Verify the key belongs to this user or their candidate
  const keyOwner = keyStr.split('/')[1];
  const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
  if (candidateIdStr && keyOwner !== candidateIdStr) {
    return errorResponse('Upload key does not match candidate', 403);
  }
  if (!isAdmin && keyOwner !== request.user.id && keyOwner !== candidateIdStr) {
    return errorResponse('Upload key does not match your identity', 403);
  }

  // Verify content type. Fall back to filename/key extension for mobile files
  // that arrive without a MIME type.
  const typeConfig = resolveUploadType(file.type, file.name || keyStr);
  if (!typeConfig) return errorResponse('Unsupported file type');

  // Verify size
  if (file.size > typeConfig.maxSize) {
    return errorResponse(`File too large. Max: ${Math.round(typeConfig.maxSize / 1024 / 1024)}MB`);
  }

  // Verify candidate staff
  if (candidateIdStr) {
    const isAdmin = ['admin', 'super_admin'].includes(request.user.role);
    if (!isAdmin) {
      const link = await env.ARENA_DB.prepare(
        `SELECT id FROM candidate_staff_links WHERE user_id = ? AND candidate_id = ? AND is_active = 1`
      ).bind(request.user.id, candidateIdStr).first();
      if (!link) return errorResponse('Only registered candidate staff can upload media', 403);
    }
  }

  if (env.ARENA_MEDIA) {
    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await env.ARENA_MEDIA.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: typeConfig.mime,
      },
      customMetadata: {
        uploadedBy: request.user.id,
        candidateId: candidateIdStr,
        originalName: file.name || 'unknown',
      },
    });

    const filename = keyStr.split('/').pop() || '';
    const fileId = filename.split('.')[0];
    await env.ARENA_DB.prepare(
      `INSERT OR REPLACE INTO media_uploads
       (file_id, key, uploaded_by, candidate_id, content_type, size_bytes, original_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(fileId, keyStr, request.user.id, candidateIdStr || null, typeConfig.mime, file.size, file.name || 'unknown').run();

    auditLog(env.ARENA_DB, ctx, {
      actorId: request.user.id,
      action: 'media.upload',
      entityType: 'media',
      entityId: key,
      afterState: { type: typeConfig.mime, size: file.size, candidate: candidateIdStr || null },
      ipAddress: getClientIP(request),
    });

    return successResponse({
      key,
      url: `/media/${key}`,
      type: typeConfig.mime,
      media_kind: typeConfig.kind,
      size: file.size,
    });
  }

  // No R2 binding available
  return errorResponse('Media storage is temporarily unavailable. Please try again later.', 503);
}

// GET /api/uploads/serve/:fileId — Serve file from R2
router.get('/serve/:fileId', async (request, env) => {
  if (!env.ARENA_MEDIA) return errorResponse('Media storage not available', 503);

  const { fileId } = request.params;
  if (!/^media_[a-zA-Z0-9_-]+$/.test(fileId)) {
    return errorResponse('Invalid file id', 400);
  }

  const upload = await env.ARENA_DB.prepare(
    `SELECT key, content_type FROM media_uploads WHERE file_id = ?`
  ).bind(fileId).first();
  if (!upload) return errorResponse('File not found', 404);

  const response = await r2MediaResponse(env.ARENA_MEDIA, upload.key, request, upload.content_type, 'public, max-age=31536000');
  if (!response) return errorResponse('File not found', 404);
  return response;
});

// GET /api/uploads/info — Get upload limits and supported types
router.get('/info', async (request, env) => {
  return successResponse({
    r2_enabled: !!env.ARENA_MEDIA,
    supported_types: supportedMediaTypes(),
    video_guidelines: {
      recommended_format: 'mp4 (H.264)',
      max_duration_seconds: 60,
      recommended_aspect_ratio: '9:16 (vertical, like YouTube Shorts)',
      max_resolution: '1080x1920',
      audio: 'included, supported',
    },
  });
});

export default router;
