import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sendAndRecordTransactionalEmail, sendTransactionalEmail } from '../src/email.js';

describe('transactional email provider adapter', () => {
  beforeAll(async () => {
    await SELF.fetch('https://example.com/api/health');
  });

  it('sends Resend email with bearer auth and normalized payload', async () => {
    let request;
    const result = await sendTransactionalEmail({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Arena <noreply@example.com>',
    }, {
      to: 'recipient@example.com',
      subject: 'Resend test',
      text: 'Plain text',
      html: '<p>Plain text</p>',
      tag: 'password_reset',
      metadata: { user_id: 'usr_test' },
      idempotencyKey: 'idem-resend-test',
    }, async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ id: 'resend-message-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    expect(result).toMatchObject({
      delivered: true,
      provider: 'resend',
      provider_message_id: 'resend-message-id',
    });
    expect(request.url).toBe('https://api.resend.com/emails');
    expect(request.init.headers.Authorization).toBe('Bearer re_test');
    expect(request.init.headers['Idempotency-Key']).toBe('idem-resend-test');
    expect(request.body).toMatchObject({
      from: 'Arena <noreply@example.com>',
      to: ['recipient@example.com'],
      subject: 'Resend test',
      text: 'Plain text',
      html: '<p>Plain text</p>',
      tags: [{ name: 'type', value: 'password_reset' }],
    });
  });

  it('sends Postmark email with server token and message stream', async () => {
    let request;
    const result = await sendTransactionalEmail({
      EMAIL_PROVIDER: 'postmark',
      POSTMARK_SERVER_TOKEN: 'postmark-token',
      POSTMARK_MESSAGE_STREAM: 'outbound',
      EMAIL_FROM: 'Arena <noreply@example.com>',
    }, {
      to: 'recipient@example.com',
      subject: 'Postmark test',
      text: 'Plain text',
      html: '<p>Plain text</p>',
      tag: 'challenge_tagged',
      metadata: { challenge_id: 'chal_test' },
    }, async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ MessageID: 'postmark-message-id', ErrorCode: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    expect(result).toMatchObject({
      delivered: true,
      provider: 'postmark',
      provider_message_id: 'postmark-message-id',
    });
    expect(request.url).toBe('https://api.postmarkapp.com/email');
    expect(request.init.headers['X-Postmark-Server-Token']).toBe('postmark-token');
    expect(request.body).toMatchObject({
      From: 'Arena <noreply@example.com>',
      To: 'recipient@example.com',
      Subject: 'Postmark test',
      TextBody: 'Plain text',
      HtmlBody: '<p>Plain text</p>',
      Tag: 'challenge_tagged',
      MessageStream: 'outbound',
    });
  });

  it('bounds every provider call with an abort signal so outages cannot hang the worker', async () => {
    const providers = [
      { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Arena <noreply@example.com>' },
      { EMAIL_PROVIDER: 'postmark', POSTMARK_SERVER_TOKEN: 'postmark-token', EMAIL_FROM: 'Arena <noreply@example.com>' },
      { EMAIL_PROVIDER: 'webhook', PASSWORD_RESET_WEBHOOK_URL: 'https://hooks.example.com/email' },
    ];

    for (const providerEnv of providers) {
      let request;
      await sendTransactionalEmail(providerEnv, {
        to: 'recipient@example.com',
        subject: 'Timeout test',
        text: 'Plain text',
      }, async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ id: 'ok', MessageID: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      expect(request.init.signal, `${providerEnv.EMAIL_PROVIDER} must pass an abort signal`).toBeInstanceOf(AbortSignal);
    }
  });

  it('records sent and skipped delivery outcomes', async () => {
    const suffix = Date.now().toString(36);
    const sentSubject = `Sent email ${suffix}`;
    const skippedSubject = `Skipped email ${suffix}`;

    await sendAndRecordTransactionalEmail(env.ARENA_DB, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Arena <noreply@example.com>',
    }, {
      to: 'recipient@example.com',
      subject: sentSubject,
      text: 'Delivery record',
      tag: 'password_reset',
      metadata: { test_id: suffix },
    }, {
      recipient_user_id: null,
      related_entity_type: 'user',
      related_entity_id: `usr-${suffix}`,
      template_key: 'password_reset',
    }, async () => new Response(JSON.stringify({ id: `provider-${suffix}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await sendAndRecordTransactionalEmail(env.ARENA_DB, {}, {
      to: 'recipient@example.com',
      subject: skippedSubject,
      text: 'Delivery record',
      tag: 'challenge_tagged',
      metadata: { test_id: suffix },
    }, {
      related_entity_type: 'challenge',
      related_entity_id: `chal-${suffix}`,
      template_key: 'challenge_tagged',
    }, async () => {
      throw new Error('fetch should not be called when unconfigured');
    });

    const sent = await env.ARENA_DB.prepare(
      `SELECT provider, provider_message_id, status, subject, template_key
       FROM email_deliveries WHERE subject = ?`
    ).bind(sentSubject).first();
    expect(sent).toMatchObject({
      provider: 'resend',
      provider_message_id: `provider-${suffix}`,
      status: 'sent',
      subject: sentSubject,
      template_key: 'password_reset',
    });

    const skipped = await env.ARENA_DB.prepare(
      `SELECT provider, status, error_message, subject, template_key
       FROM email_deliveries WHERE subject = ?`
    ).bind(skippedSubject).first();
    expect(skipped).toMatchObject({
      provider: null,
      status: 'skipped',
      error_message: 'Transactional email provider not configured',
      subject: skippedSubject,
      template_key: 'challenge_tagged',
    });
  });
});
