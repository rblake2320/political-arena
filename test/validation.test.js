/**
 * Validation unit tests — exercise the real Zod schemas used by the worker.
 */
import { describe, it, expect } from 'vitest';
import {
  validate, registerSchema, createChallengeSchema, createAdSchema, grantCreditsSchema,
} from '../src/validation.js';

describe('registerSchema', () => {
  const base = {
    email: 'user@example.com',
    username: 'user_1',
    password: 'Str0ng!Passw0rd',
    display_name: 'User One',
  };

  it('accepts a valid registration', () => {
    expect(validate(registerSchema, base).valid).toBe(true);
  });

  it('rejects passwords missing complexity', () => {
    for (const password of ['alllowercase1!', 'ALLUPPERCASE1!', 'NoDigits!!', 'NoSpecial123A', 'Sh0r!t']) {
      const result = validate(registerSchema, { ...base, password });
      expect(result.valid, `should reject: ${password}`).toBe(false);
    }
  });

  it('rejects malformed emails and usernames', () => {
    expect(validate(registerSchema, { ...base, email: 'not-an-email' }).valid).toBe(false);
    expect(validate(registerSchema, { ...base, username: 'a' }).valid).toBe(false);
    expect(validate(registerSchema, { ...base, username: 'has spaces' }).valid).toBe(false);
  });
});

describe('createChallengeSchema', () => {
  const base = {
    race_id: 'race-1',
    challenger_candidate_id: 'cand-1',
    target_candidate_id: 'cand-2',
    challenge_text: 'This is a sufficiently long challenge question.',
  };

  it('accepts a valid challenge and applies defaults', () => {
    const result = validate(createChallengeSchema, base);
    expect(result.valid).toBe(true);
    expect(result.data.challenge_type).toBe('open');
    expect(result.data.deadline_business_days).toBe(3);
  });

  it('rejects too-short challenge text', () => {
    expect(validate(createChallengeSchema, { ...base, challenge_text: 'short' }).valid).toBe(false);
  });

  it('bounds deadline_business_days to 3..10', () => {
    expect(validate(createChallengeSchema, { ...base, deadline_business_days: 2 }).valid).toBe(false);
    expect(validate(createChallengeSchema, { ...base, deadline_business_days: 11 }).valid).toBe(false);
    expect(validate(createChallengeSchema, { ...base, deadline_business_days: 10 }).valid).toBe(true);
  });
});

describe('createAdSchema', () => {
  it('requires a disclaimer', () => {
    const result = validate(createAdSchema, {
      race_id: 'r', candidate_id: 'c', title: 'T', ad_content_text: 'Content', disclaimer_text: '',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects non-URL media', () => {
    const result = validate(createAdSchema, {
      race_id: 'r', candidate_id: 'c', title: 'T', ad_content_text: 'Content',
      disclaimer_text: 'Paid for by T', media_url: 'not a url',
    });
    expect(result.valid).toBe(false);
  });
});

describe('grantCreditsSchema', () => {
  it('bounds grants to 1..1000 whole credits', () => {
    expect(validate(grantCreditsSchema, { amount: 0 }).valid).toBe(false);
    expect(validate(grantCreditsSchema, { amount: 1001 }).valid).toBe(false);
    expect(validate(grantCreditsSchema, { amount: 2.5 }).valid).toBe(false);
    expect(validate(grantCreditsSchema, { amount: 500 }).valid).toBe(true);
  });
});
