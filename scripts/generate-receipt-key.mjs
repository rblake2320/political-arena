#!/usr/bin/env node
// Generate the Ed25519 key that signs public receipt bundles.
//
// The private key is printed ONCE to this terminal and written nowhere.
// Store it as a Worker secret and nowhere else:
//
//   PowerShell:
//     node scripts/generate-receipt-key.mjs
//     npx wrangler secret put RECEIPT_SIGNING_KEY      # paste the PRIVATE line
//
// Rotation: generate a new key, put it in RECEIPT_SIGNING_KEY, and append the
// OLD public key to the RECEIPT_RETIRED_PUBLIC_KEYS variable (comma-separated)
// so bundles signed before the rotation still verify.
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const privatePkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const publicRaw = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey));
const keyId = Buffer.from(await crypto.subtle.digest('SHA-256', publicRaw)).toString('hex').slice(0, 16);

console.log('PRIVATE (secret RECEIPT_SIGNING_KEY — do not commit, do not share):');
console.log(privatePkcs8);
console.log('\nPUBLIC (safe to publish; shown at /api/transparency/keys):');
console.log(publicRaw.toString('base64url'));
console.log(`\nKEY ID: ${keyId}`);
