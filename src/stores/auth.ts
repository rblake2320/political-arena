/**
 * Arena — Auth Store (Zustand)
 * Manages user authentication state across the app.
 */

import { create } from 'zustand';
import * as api from '../api';

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  party_affiliation: string | null;
  jurisdiction_state: string | null;
  verification_status: string;
  email_verified: number;
  staff_links: any[];
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  initialized: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; password: string; display_name?: string; party_affiliation?: string; jurisdiction_state?: string }) => Promise<void>;
  logout: () => Promise<void>;
  init: () => Promise<void>;
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: api.getStoredToken(),
  loading: false,
  initialized: false,

  init: async () => {
    // Deduplication guard: prevent double init in StrictMode
    const state = get();
    if (state.initialized || state.loading) return;

    const token = api.getStoredToken();
    if (!token) {
      set({ initialized: true, user: null, token: null });
      return;
    }
    try {
      set({ loading: true });
      const data = await api.getMe();
      set({ user: data, token, initialized: true, loading: false });
    } catch {
      api.clearStoredToken();
      set({ user: null, token: null, initialized: true, loading: false });
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const { user, token } = await api.login({ email, password });
      api.setStoredToken(token);
      set({ user, token, loading: false });
    } catch (err: any) {
      set({ loading: false });
      throw new Error(err.response?.data?.error || err.message || 'Login failed');
    }
  },

  register: async (data) => {
    set({ loading: true });
    try {
      const { user, token } = await api.register({ ...data, display_name: data.display_name || data.username });
      api.setStoredToken(token);
      set({ user, token, loading: false });
    } catch (err: any) {
      set({ loading: false });
      throw new Error(err.response?.data?.error || err.message || 'Registration failed');
    }
  },

  logout: async () => {
    await api.logout();
    set({ user: null, token: null });
  },

  setUser: (user) => set({ user }),
}));
