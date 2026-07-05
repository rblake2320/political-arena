import { describe, expect, it } from 'vitest';

const sourceFiles = {
  ...import.meta.glob('../src/routes/*.js', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../src/pages/*.tsx', { query: '?raw', import: 'default', eager: true }),
};

const publicAccountabilityFiles = [
  'src/routes/ads.routes.js',
  'src/routes/candidates.routes.js',
  'src/routes/challenges.routes.js',
  'src/routes/questions.routes.js',
  'src/routes/races.routes.js',
  'src/routes/recites.routes.js',
  'src/routes/statements.routes.js',
  'src/routes/surveys.routes.js',
  'src/pages/CandidateProfilePage.tsx',
  'src/pages/ChallengeReceiptPage.tsx',
  'src/pages/Race.tsx',
  'src/pages/WhatMattersPage.tsx',
];

const commercialAccessInputs = [
  'campaign_analytics_access',
  'access_tier',
  'billing_status',
  'invoice_status',
  'subscription_status',
  'subscription_tier',
  'plan_id',
  'price_id',
  'stripe_customer',
  'stripe_subscription',
  'payment_status',
  'checkout_session',
  'premium',
  'enterprise',
];

describe('neutrality invariants', () => {
  it('keeps commercial access inputs out of public accountability surfaces', () => {
    const violations = [];

    for (const file of publicAccountabilityFiles) {
      const source = String(sourceFiles[`../${file}`] || '').toLowerCase();
      expect(source, `${file} should be included in the invariant scan`).not.toBe('');
      for (const term of commercialAccessInputs) {
        if (source.includes(term.toLowerCase())) {
          violations.push(`${file}: ${term}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
