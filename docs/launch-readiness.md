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
