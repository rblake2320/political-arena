/**
 * Arena — API-backed reactive store
 * Zustand store that fetches from the real /api/ backend.
 * Keeps the same interface the existing components expect.
 */

import { create } from 'zustand';
import * as api from './api';

// ---- Types (matching API response shapes) ----

export interface Race {
  id: string;
  name: string;
  office: string;
  district: string;
  state: string;
  status: string;
  candidate_count?: number;
  challenge_count?: number;
  ad_count?: number;
  question_count?: number;
  response_count?: number;
  activity_score?: number;
}

export interface Candidate {
  id: string;
  name: string;
  party: string;
  race_id: string;
  biography: string;
  issue_positions: string[];
  photo_url?: string | null;
  verification_status?: string;
}

export interface AdFlight {
  id: string;
  race_id: string;
  candidate_id: string;
  title: string;
  media_url: string | null;
  media_type: string;
  ad_content_text: string;
  start_date: string;
  end_date: string;
  disclaimer_text: string;
  budget_cents: number;
  status: string;
  rebuttal_window_expires: string | null;
}

export interface RebuttalAd {
  id: string;
  parent_ad_id: string;
  race_id: string;
  candidate_id: string;
  media_url: string | null;
  response_text: string;
  disclaimer_text: string;
  status: string;
}

export interface Challenge {
  id: string;
  race_id: string;
  challenger_candidate_id: string;
  target_candidate_id: string;
  challenge_text: string;
  media_url: string | null;
  challenge_type: string;
  created_at: string;
  deadline_business_days: number;
  response_deadline: string;
  expired_at: string | null;
  refused_at: string | null;
  refusal_reason: string | null;
  status: string;
}

export interface ChallengeResponse {
  id: string;
  challenge_id: string;
  candidate_id: string;
  media_url: string | null;
  response_text: string;
  created_at: string;
}

export interface Question {
  id: string;
  race_id: string;
  user_id: string;
  source_type: 'voter' | 'press';
  question_text: string;
  media_url: string | null;
  vote_count: number;
  status: string;
  created_at: string;
  author_name?: string;
  has_voted?: boolean;
  is_top?: boolean;
}

export interface RaceDetail extends Race {
  candidates: Candidate[];
  ads: AdFlight[];
  rebuttals: RebuttalAd[];
  challenges: Challenge[];
  challengeResponses: ChallengeResponse[];
}

// ---- Store ----

interface ArenaStore {
  // Cached data
  races: (Race & { candidate_count: number })[];
  raceDetails: Record<string, RaceDetail>;
  allCandidates: (Candidate & { race_name: string; race_state: string })[];
  loading: boolean;
  _loadCount: number;

  // Actions
  fetchRaces: (sort?: string) => Promise<void>;
  fetchRace: (id: string) => Promise<RaceDetail | null>;
  fetchAllCandidates: () => Promise<void>;
  invalidate: () => void;

  // Compat shims for existing components
  getRaces: () => (Race & { candidate_count: number })[];
  getRace: (id: string) => RaceDetail | null;
  getCandidates: () => (Candidate & { race_name: string; race_state: string })[];
}

export const useArenaStore = create<ArenaStore>((set, get) => ({
  races: [],
  raceDetails: {},
  allCandidates: [],
  loading: false,
  _loadCount: 0,

  fetchRaces: async (sort?: string) => {
    try {
      const { races } = await api.getRaces(sort);
      set({ races: races as any[] });
    } catch (err) {
      console.error('Failed to fetch races:', err);
    }
  },

  fetchRace: async (id: string) => {
    try {
      set((s) => ({ loading: true, _loadCount: s._loadCount + 1 }));
      const data = await api.getRace(id);
      // Parse issue_positions safely (bug #4 fix)
      if (data.candidates) {
        data.candidates = data.candidates.map((c: any) => {
          let positions = c.issue_positions || [];
          if (typeof positions === 'string') {
            try { positions = JSON.parse(positions); } catch { positions = []; }
          }
          return { ...c, issue_positions: positions };
        });
      }
      set((s) => {
        const count = s._loadCount - 1;
        return {
          raceDetails: { ...s.raceDetails, [id]: data },
          loading: count > 0,
          _loadCount: count,
        };
      });
      return data;
    } catch (err) {
      console.error('Failed to fetch race:', err);
      set((s) => {
        const count = s._loadCount - 1;
        return { loading: count > 0, _loadCount: count };
      });
      return null;
    }
  },

  fetchAllCandidates: async () => {
    try {
      // Build from cached races
      const { races, raceDetails } = get();
      // If we have race details, build candidate list
      const allCandidates: (Candidate & { race_name: string; race_state: string })[] = [];
      for (const race of races) {
        const detail = raceDetails[race.id];
        if (detail) {
          for (const c of detail.candidates) {
            allCandidates.push({
              ...c,
              race_name: race.name,
              race_state: race.state,
            });
          }
        }
      }
      set({ allCandidates });
    } catch (err) {
      console.error('Failed to build candidates:', err);
    }
  },

  invalidate: () => set({ raceDetails: {} }),

  // Compat shims
  getRaces: () => get().races,
  getRace: (id: string) => get().raceDetails[id] || null,
  getCandidates: () => get().allCandidates,
}));

// Legacy export for components that import { store }
// This bridges old useSyncExternalStore pattern to zustand
const _listeners = new Set<() => void>();
export const store = {
  subscribe(fn: () => void) {
    // Subscribe to zustand changes
    const unsub = useArenaStore.subscribe(fn);
    _listeners.add(fn);
    return () => { unsub(); _listeners.delete(fn); };
  },
  getRaces: () => useArenaStore.getState().getRaces(),
  getRace: (id: string) => useArenaStore.getState().getRace(id),
  getCandidates: () => useArenaStore.getState().getCandidates(),

  // Write operations now go through API
  async createChallenge(data: { race_id: string; challenger_candidate_id: string; target_candidate_id: string; challenge_text: string; media_url?: string }) {
    await api.createChallenge({
      race_id: data.race_id,
      challenger_candidate_id: data.challenger_candidate_id,
      target_candidate_id: data.target_candidate_id,
      challenge_text: data.challenge_text,
      media_url: data.media_url,
    });
  },
  async respondToChallenge(challengeId: string, data: { candidate_id: string; response_text: string; media_url?: string }) {
    await api.respondToChallenge(challengeId, {
      response_text: data.response_text,
      media_url: data.media_url,
    });
  },
  async createAd(data: { race_id: string; candidate_id: string; title?: string; ad_content_text?: string; disclaimer_text: string; budget?: number; media_url?: string; media_type?: string }) {
    await api.createAd({
      race_id: data.race_id,
      candidate_id: data.candidate_id,
      title: data.title || 'New Ad',
      ad_content_text: data.ad_content_text || '',
      disclaimer_text: data.disclaimer_text,
      media_url: data.media_url,
      media_type: data.media_type,
    });
  },
  async createRace(data: { name: string; office: string; state: string; district?: string }) {
    await api.createRace(data);
  },
  async addReaction(data: { content_type: string; content_id: string; reaction_type: string }) {
    await api.addReaction(data);
  },
  async createRebuttal(data: { parent_ad_id: string; race_id: string; candidate_id: string; response_text: string; disclaimer_text?: string; media_url?: string }) {
    await api.createRebuttal({
      parent_ad_id: data.parent_ad_id,
      race_id: data.race_id,
      candidate_id: data.candidate_id,
      response_text: data.response_text,
      disclaimer_text: data.disclaimer_text || '',
      media_url: data.media_url,
    });
  },
};
