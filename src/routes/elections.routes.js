/**
 * Public election-action resources.
 * Links stay neutral and source-first; state pages are selected on the source
 * sites rather than mirrored here, so launch copy does not drift out of date.
 */

import { Router } from 'itty-router';
import { errorResponse, successResponse } from '../middleware.js';

const router = Router({ base: '/api/elections' });

const STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const RESOURCES = [
  {
    type: 'register_or_update',
    label: 'Register or update voter registration',
    url: 'https://vote.gov/register',
    provider: 'Vote.gov',
    authority: 'U.S. Election Assistance Commission',
    official: true,
    description: 'Select a state or territory to register, update registration, check status, or get a registration card.',
  },
  {
    type: 'registration_status',
    label: 'Check voter registration status',
    url: 'https://www.nass.org/can-I-vote/voter-registration-status',
    provider: 'Can I Vote',
    authority: 'National Association of Secretaries of State',
    official: false,
    description: 'Nonpartisan state-election-official selector for checking registration status.',
  },
  {
    type: 'polling_place',
    label: 'Find polling place',
    url: 'https://www.nass.org/can-i-vote/find-your-polling-place',
    provider: 'Can I Vote',
    authority: 'National Association of Secretaries of State',
    official: false,
    description: 'Selector that links to state polling-place lookup tools or local election-office contact information.',
  },
  {
    type: 'voter_id',
    label: 'Check voter ID rules',
    url: 'https://www.nass.org/can-i-vote/valid-forms-id',
    provider: 'Can I Vote',
    authority: 'National Association of Secretaries of State',
    official: false,
    description: 'Selector for state voter-identification requirements.',
  },
  {
    type: 'absentee_early_voting',
    label: 'Absentee and early voting',
    url: 'https://www.nass.org/can-i-vote/absentee-early-voting',
    provider: 'Can I Vote',
    authority: 'National Association of Secretaries of State',
    official: false,
    description: 'Selector for absentee, mail, and early-voting rules by state.',
  },
];

function normalizeState(rawState) {
  if (!rawState) return null;
  const value = rawState.trim();
  if (!value) return null;

  const upper = value.toUpperCase();
  if (STATE_NAMES[upper]) return { code: upper, name: STATE_NAMES[upper] };

  const found = Object.entries(STATE_NAMES).find(([, name]) => name.toLowerCase() === value.toLowerCase());
  if (!found) return undefined;
  return { code: found[0], name: found[1] };
}

// GET /api/elections/voter-resources — Public neutral voting-action links
router.get('/voter-resources', request => {
  const url = new URL(request.url);
  const state = normalizeState(url.searchParams.get('state'));
  if (state === undefined) return errorResponse('Unknown state. Use a USPS state code or full state name.', 400);

  return successResponse({
    state,
    resources: RESOURCES,
    source_note: 'Arena links voters to official or state-election-official selectors; it does not collect voter registration data.',
    updated_at: '2026-07-06',
  });
});

export default router;
