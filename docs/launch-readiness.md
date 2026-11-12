# Political Arena Launch Readiness

This document tracks operational gates that cannot be proven by code alone.

## Current hard gate: transactional email

Transactional email is required for password reset and served-notice delivery. Configure exactly one provider.

### Resend

```powershell
wrangler secret put RESEND_API_KEY
wrangler secret put EMAIL_FROM
```

Optional explicit provider setting:

```toml
EMAIL_PROVIDER = "resend"
```

`EMAIL_FROM` must be a verified sender/domain in Resend.

### Postmark

```powershell
wrangler secret put POSTMARK_SERVER_TOKEN
wrangler secret put EMAIL_FROM
```

Optional explicit provider setting:

```toml
EMAIL_PROVIDER = "postmark"
POSTMARK_MESSAGE_STREAM = "outbound"
```

`EMAIL_FROM` must be a verified sender/domain in Postmark.

## Production verification

After setting secrets and deploying, create or use an admin session and call:

```http
POST /api/stats/readiness/email-test
Authorization: Bearer <admin-token>
Content-Type: application/json

{}
```

Expected result:

```json
{
  "success": true,
  "data": {
    "delivered": true,
    "provider": "resend",
    "provider_message_id": "...",
    "recipient": "admin@example.com"
  }
}
```

Then confirm:

```http
GET /api/stats/readiness
Authorization: Bearer <admin-token>
```

`launch_ready` should be `true` only when all gates are green.

## Audit anchor WORM gate

Already configured:

- R2 bucket: `political-arena-media`
- Lock rule: `arena-audit-anchors`
- Prefix: `audit-anchors/`
- Retention: indefinite
- Worker var: `AUDIT_ANCHOR_WORM_CONFIRMED = "true"`

Verify with:

```powershell
wrangler r2 bucket lock list political-arena-media
```

## Receipt signing gate

Public receipt bundles are signed with an Ed25519 key held as a Worker secret.
Without it the `receipt_signing` gate is red and bundles are returned unsigned.

```powershell
node scripts/generate-receipt-key.mjs
npx wrangler secret put RECEIPT_SIGNING_KEY
```

Paste the PRIVATE line when prompted. The script writes the key nowhere; if
the terminal scrollback is the only copy, that is intended. Confirm:

```powershell
curl.exe https://<your-host>/api/transparency/keys
```

`signing_configured` should be `true` and the `key_id` should match the one
the script printed. Record that key id somewhere outside the platform (a
press release, an archive snapshot) so readers have an independent reference.

Rotation: generate a new key, replace the secret, and append the old PUBLIC
key to the `RECEIPT_RETIRED_PUBLIC_KEYS` variable so earlier bundles still verify.

### Troubleshooting

- `/api/transparency/keys` returns 503: the secret is not a valid Ed25519
  PKCS#8 key. Paste only the base64 line, with no quotes or line breaks.
- A bundle verifies as "consistent, but the signer is not confirmed": the
  verifier was not given the platform key. Pass `--key <public key>` to the
  offline script.
- A bundle shows "Included in a published anchor: not checked": no anchor
  covers that receipt yet. Publish one with `POST /api/audit/anchors`.
