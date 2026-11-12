#!/usr/bin/env node
// Offline verifier for Political Arena receipt bundles.
//
// Checks a downloaded bundle on your own machine with no network access and
// no dependencies (Node 20+). You do not have to trust the website: this
// script and src/receipt-verify.js are the whole verifier and are short
// enough to read.
//
// Usage (PowerShell or any shell):
//   node scripts/verify-receipt-bundle.mjs <bundle.json> [--key <publicKeyBase64Url>]... [--json]
//
//   --key   A platform public key you already trust (repeatable). Take it from
//           /api/transparency/keys at a time you trusted the site, from a news
//           archive, or from a copy you saved earlier. Without --key the script
//           still checks the signature and chain but cannot tell you WHO signed.
//   --json  Print the machine-readable result.
//
// Exit code: 0 = verified against a trusted key, 2 = consistent but key not
// confirmed, 1 = failed or unreadable.
import { readFile } from 'node:fs/promises';
import { verifyReceiptBundle, unwrapBundle } from '../src/receipt-verify.js';

const args = process.argv.slice(2);
const keys = [];
let file = null;
let asJson = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--key') keys.push(args[++i]);
  else if (args[i] === '--json') asJson = true;
  else if (!file) file = args[i];
}
if (!file) {
  console.error('Usage: node scripts/verify-receipt-bundle.mjs <bundle.json> [--key <publicKeyBase64Url>]... [--json]');
  process.exit(1);
}

let bundle;
try {
  // Strip a UTF-8 byte-order mark: Windows editors and PowerShell redirection add one.
  bundle = unwrapBundle(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
} catch (error) {
  console.error(`Cannot read bundle: ${error.message}`);
  process.exit(1);
}

const result = await verifyReceiptBundle(bundle, keys.length ? { trustedKeys: keys } : {});
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const challenge = bundle?.payload?.receipt?.challenge;
  if (challenge) {
    console.log(`Receipt : ${challenge.public_receipt_slug || challenge.id}`);
    console.log(`Claim   : ${challenge.claim_text || challenge.challenge_text}`);
    console.log(`Status  : ${challenge.status}`);
    console.log(`Issued  : ${bundle.payload.generated_at}`);
  }
  console.log(`Key id  : ${result.key_id ?? '(unsigned)'}\n`);
  const mark = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP' };
  for (const c of result.checks) console.log(`[${mark[c.status]}] ${c.label}\n       ${c.detail}`);
  console.log(`\nVerdict : ${result.verdict.toUpperCase()}`);
  if (result.verdict === 'consistent_untrusted_key') {
    console.log('The bundle is internally consistent, but nothing here confirms the signing key is the platform\'s. Re-run with --key.');
  }
}
process.exit(result.verdict === 'verified' ? 0 : result.verdict === 'consistent_untrusted_key' ? 2 : 1);
