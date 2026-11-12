import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { sendAndRecordTransactionalEmail } from '../src/email.js';

const config = provider => ({ EMAIL_PROVIDER: provider, EMAIL_FROM: 'Arena <noreply@example.com>', RESEND_API_KEY: 'test', POSTMARK_SERVER_TOKEN: 'test' });

describe('provider acceptance receipts', () => {
  beforeAll(async () => { await SELF.fetch('https://example.com/api/health'); });

  it.each([
    ['resend', ''], ['resend', '<html>proxy error</html>'], ['resend', '{}'],
    ['resend', '{"id":42}'], ['resend', '{"id":"   "}'], ['resend', 'null'],
    ['postmark', '{}'], ['postmark', '{"MessageID":"ok"}'],
    ['postmark', '{"MessageID":"ok","ErrorCode":406}'],
    ['postmark', '{"MessageID":" ","ErrorCode":0}'],
  ])('records malformed %s HTTP 200 as failed: %s', async (provider, body) => {
    const subject = `receipt-${crypto.randomUUID()}`;
    await expect(sendAndRecordTransactionalEmail(env.ARENA_DB, config(provider), {
      to: 'recipient@example.com', subject, text: 'Synthetic receipt check',
    }, {}, async () => new Response(body, { status: 200 }))).rejects.toThrow(/receipt/i);
    expect(await env.ARENA_DB.prepare('SELECT status, provider_message_id, sent_at FROM email_deliveries WHERE subject = ?').bind(subject).first()).toMatchObject({ status: 'failed', provider_message_id: null, sent_at: null });
  });

  it('records a rejected provider without persisting its echoed private body', async () => {
    const subject = `receipt-${crypto.randomUUID()}`;
    await expect(sendAndRecordTransactionalEmail(env.ARENA_DB, config('resend'), {
      to: 'recipient@example.com', subject, text: 'Synthetic receipt check',
    }, {}, async () => new Response('{"message":"private-reset-token-fixture"}', { status: 422 }))).rejects.toThrow('422');
    const row = await env.ARENA_DB.prepare('SELECT status, error_message FROM email_deliveries WHERE subject = ?').bind(subject).first();
    expect(row.status).toBe('failed');
    expect(row.error_message).not.toContain('private-reset-token-fixture');
  });

  it('does not relabel a provider-accepted message when the receipt ledger fails', async () => {
    let attempts = 0;
    const db = { prepare: () => ({ bind: () => ({ run: async () => { attempts++; throw new Error('ledger unavailable'); } }) }) };
    await expect(sendAndRecordTransactionalEmail(db, config('resend'), {
      to: 'recipient@example.com', subject: 'Ledger outage', text: 'Synthetic check',
    }, {}, async () => new Response('{"id":"accepted-id"}'))).rejects.toThrow('ledger unavailable');
    expect(attempts).toBe(1);
  });
});
