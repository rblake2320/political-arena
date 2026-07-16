/**
 * Arena transactional email adapter.
 *
 * Supported providers:
 * - Resend: RESEND_API_KEY + EMAIL_FROM
 * - Postmark: POSTMARK_SERVER_TOKEN + EMAIL_FROM
 *
 * PASSWORD_RESET_WEBHOOK_URL is kept as a legacy fallback for existing setups.
 */

import { generateId } from './db.js';

const DEFAULT_RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

function normalizeProvider(env) {
  const explicit = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (env.RESEND_API_KEY) return 'resend';
  if (env.POSTMARK_SERVER_TOKEN) return 'postmark';
  if (env.PASSWORD_RESET_WEBHOOK_URL) return 'webhook';
  return null;
}

function getEmailFrom(env) {
  return env.EMAIL_FROM || env.TRANSACTIONAL_EMAIL_FROM || '';
}

export function isTransactionalEmailConfigured(env) {
  const provider = normalizeProvider(env);
  if (!provider) return false;
  if (provider === 'webhook') return !!env.PASSWORD_RESET_WEBHOOK_URL;
  if (!getEmailFrom(env)) return false;
  if (provider === 'resend') return !!env.RESEND_API_KEY;
  if (provider === 'postmark') return !!env.POSTMARK_SERVER_TOKEN;
  return false;
}

export function transactionalEmailStatus(env) {
  const provider = normalizeProvider(env);
  const missing = [];
  if (!provider) {
    missing.push('EMAIL_PROVIDER plus provider secret');
    return { configured: false, provider: null, missing };
  }

  if (provider === 'webhook') {
    if (!env.PASSWORD_RESET_WEBHOOK_URL) missing.push('PASSWORD_RESET_WEBHOOK_URL');
    return { configured: missing.length === 0, provider, missing };
  }

  if (!getEmailFrom(env)) missing.push('EMAIL_FROM');
  if (provider === 'resend' && !env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (provider === 'postmark' && !env.POSTMARK_SERVER_TOKEN) missing.push('POSTMARK_SERVER_TOKEN');
  if (!['resend', 'postmark'].includes(provider)) missing.push(`unsupported provider: ${provider}`);
  return { configured: missing.length === 0, provider, missing };
}

function assertProviderConfig(env) {
  const provider = normalizeProvider(env);
  if (!provider) return null;

  if (provider === 'webhook') {
    if (!env.PASSWORD_RESET_WEBHOOK_URL) throw new Error('PASSWORD_RESET_WEBHOOK_URL is not configured');
    return { provider, url: env.PASSWORD_RESET_WEBHOOK_URL };
  }

  const from = getEmailFrom(env);
  if (!from) throw new Error('EMAIL_FROM is not configured');

  if (provider === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
    return { provider, from, url: env.RESEND_API_URL || DEFAULT_RESEND_API_URL };
  }

  if (provider === 'postmark') {
    if (!env.POSTMARK_SERVER_TOKEN) throw new Error('POSTMARK_SERVER_TOKEN is not configured');
    return {
      provider,
      from,
      url: env.POSTMARK_API_URL || DEFAULT_POSTMARK_API_URL,
      messageStream: env.POSTMARK_MESSAGE_STREAM || 'outbound',
    };
  }

  throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return '{}';
  }
}

async function parseProviderResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function compactMetadata(metadata = {}) {
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value).slice(0, 250)]);
  return Object.fromEntries(entries);
}

function htmlToText(html = '') {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cap outbound provider calls so a slow/unresponsive email API cannot pin a
// Worker invocation until the platform kills it.
const EMAIL_PROVIDER_TIMEOUT_MS = 10000;

export async function sendTransactionalEmail(env, message, fetchImpl = fetch) {
  const config = assertProviderConfig(env);
  if (!config) {
    return { delivered: false, skipped: true, provider: null, reason: 'not_configured' };
  }

  const to = Array.isArray(message.to) ? message.to : [message.to];
  const text = message.text || htmlToText(message.html);
  const html = message.html || `<pre>${escapeHtml(text)}</pre>`;
  const metadata = compactMetadata(message.metadata);

  if (config.provider === 'resend') {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: config.from,
        to,
        subject: message.subject,
        html,
        text,
        ...(message.replyTo || env.EMAIL_REPLY_TO ? { reply_to: message.replyTo || env.EMAIL_REPLY_TO } : {}),
        ...(message.tag ? { tags: [{ name: 'type', value: message.tag.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256) }] } : {}),
        ...(Object.keys(metadata).length > 0 ? { headers: Object.fromEntries(
          Object.entries(metadata).map(([key, value]) => [`X-Arena-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`, value])
        ) } : {}),
      }),
    });
    const payload = await parseProviderResponse(response);
    if (!response.ok) throw new Error(`Resend email failed with ${response.status}: ${safeJson(payload)}`);
    return { delivered: true, provider: 'resend', provider_message_id: payload.id || null, response: payload };
  }

  if (config.provider === 'postmark') {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        From: config.from,
        To: to.join(','),
        Subject: message.subject,
        HtmlBody: html,
        TextBody: text,
        ...(message.replyTo || env.EMAIL_REPLY_TO ? { ReplyTo: message.replyTo || env.EMAIL_REPLY_TO } : {}),
        ...(message.tag ? { Tag: message.tag.slice(0, 1000) } : {}),
        ...(Object.keys(metadata).length > 0 ? { Metadata: metadata } : {}),
        MessageStream: config.messageStream,
      }),
    });
    const payload = await parseProviderResponse(response);
    if (!response.ok) throw new Error(`Postmark email failed with ${response.status}: ${safeJson(payload)}`);
    return { delivered: true, provider: 'postmark', provider_message_id: payload.MessageID || null, response: payload };
  }

  const response = await fetchImpl(config.url, {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      ...(env.PASSWORD_RESET_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.PASSWORD_RESET_WEBHOOK_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      type: message.tag || 'transactional',
      to,
      subject: message.subject,
      text,
      html,
      metadata,
    }),
  });
  const payload = await parseProviderResponse(response);
  if (!response.ok) throw new Error(`Email webhook failed with ${response.status}: ${safeJson(payload)}`);
  return { delivered: true, provider: 'webhook', provider_message_id: payload.id || null, response: payload };
}

export async function recordEmailDelivery(db, delivery) {
  await db.prepare(
    `INSERT INTO email_deliveries
       (id, provider, provider_message_id, recipient_user_id, recipient_email, subject, template_key,
        related_entity_type, related_entity_id, status, error_message, metadata, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId('eml'),
    delivery.provider || null,
    delivery.provider_message_id || null,
    delivery.recipient_user_id || null,
    delivery.recipient_email || null,
    delivery.subject,
    delivery.template_key || null,
    delivery.related_entity_type || null,
    delivery.related_entity_id || null,
    delivery.status,
    delivery.error_message || null,
    delivery.metadata ? safeJson(delivery.metadata) : null,
    delivery.status === 'sent' ? new Date().toISOString() : null,
  ).run();
}

export async function sendAndRecordTransactionalEmail(db, env, message, context = {}, fetchImpl = fetch) {
  if (!normalizeProvider(env)) {
    await recordEmailDelivery(db, {
      ...context,
      provider: null,
      recipient_email: Array.isArray(message.to) ? message.to.join(',') : message.to,
      subject: message.subject,
      template_key: message.tag,
      status: 'skipped',
      error_message: 'Transactional email provider not configured',
      metadata: message.metadata,
    });
    return { delivered: false, skipped: true };
  }

  try {
    const result = await sendTransactionalEmail(env, message, fetchImpl);
    await recordEmailDelivery(db, {
      ...context,
      provider: result.provider,
      provider_message_id: result.provider_message_id,
      recipient_email: Array.isArray(message.to) ? message.to.join(',') : message.to,
      subject: message.subject,
      template_key: message.tag,
      status: result.delivered ? 'sent' : 'skipped',
      metadata: message.metadata,
    });
    return result;
  } catch (error) {
    await recordEmailDelivery(db, {
      ...context,
      provider: normalizeProvider(env),
      recipient_email: Array.isArray(message.to) ? message.to.join(',') : message.to,
      subject: message.subject,
      template_key: message.tag,
      status: 'failed',
      error_message: String(error?.message || error).slice(0, 1000),
      metadata: message.metadata,
    });
    throw error;
  }
}
