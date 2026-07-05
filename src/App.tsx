import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, Navigate } from "react-router";
import React, { useEffect, useState, createContext, useContext, useMemo, useRef } from "react";
import { Home } from "./pages/Home";
import { Race } from "./pages/Race";
import { CandidateDashboard } from "./pages/CandidateDashboard";
import { WhatMattersPage } from "./pages/WhatMattersPage";
import { MyPrioritiesPage } from "./pages/MyPrioritiesPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PressRegistrationPage } from "./pages/PressRegistrationPage";
import { Help } from "./pages/Help";
import { ChallengeReceiptPage } from "./pages/ChallengeReceiptPage";
import { ModerationPage } from "./pages/ModerationPage";
import { CandidateProfilePage } from "./pages/CandidateProfilePage";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { useAuth } from "./stores/auth";
import { useArenaStore } from "./store";
import * as api from "./api";
import { Menu, X, LogOut, User, Bell, BarChart3, Newspaper, HelpCircle, ShieldCheck } from "lucide-react";

interface CandidateContextType {
  candidates: ReturnType<typeof useArenaStore.getState>["allCandidates"];
  activeCandidateId: string | null;
  setActiveCandidateId: (id: string) => void;
}

export const CandidateContext = createContext<CandidateContextType>({
  candidates: [],
  activeCandidateId: null,
  setActiveCandidateId: () => {},
});

type PageTelemetry = {
  route: string;
  race_id?: string;
  candidate_id?: string;
  content_type?: string;
  content_id?: string;
};

function pageTelemetry(pathname: string): PageTelemetry {
  const raceMatch = pathname.match(/^\/race\/([^/]+)/);
  if (raceMatch) {
    return { route: '/race/:id', race_id: raceMatch[1], content_type: 'race', content_id: raceMatch[1] };
  }

  const receiptMatch = pathname.match(/^\/challenge\/([^/]+)/);
  if (receiptMatch) {
    return { route: '/challenge/:id', content_type: 'challenge', content_id: receiptMatch[1] };
  }

  const publicProfileMatch = pathname.match(/^\/profile\/candidate\/([^/]+)/);
  if (publicProfileMatch) {
    return { route: '/profile/candidate/:id', candidate_id: publicProfileMatch[1], content_type: 'candidate', content_id: publicProfileMatch[1] };
  }

  const candidatePortalMatch = pathname.match(/^\/candidate\/([^/]+)/);
  if (candidatePortalMatch) {
    return { route: '/candidate/:id', candidate_id: candidatePortalMatch[1], content_type: 'candidate_portal', content_id: candidatePortalMatch[1] };
  }

  const knownStaticRoutes = new Set([
    '/',
    '/what-matters',
    '/my-priorities',
    '/notifications',
    '/moderation',
    '/press/register',
    '/help',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ]);

  return { route: knownStaticRoutes.has(pathname) ? pathname : 'unknown' };
}

function Navigation() {
  const { candidates, activeCandidateId, setActiveCandidateId } = useContext(CandidateContext);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const canModerate = Boolean(user && ["moderator", "admin", "super_admin"].includes(user.role));

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    const refresh = () => api.getUnreadCount().then(data => setUnreadCount(data.count || 0)).catch(() => {});
    refresh();
    // Poll on an interval instead of refetching on every route change
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [user]);

  const handleCandidateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setActiveCandidateId(id);
    if (location.pathname.startsWith("/candidate")) {
      navigate(`/candidate/${id}`);
    }
    setMobileOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    setMobileOpen(false);
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-tight text-white flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-xs font-black shadow-lg shadow-indigo-500/20">A</span>
          Arena
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link to="/" className="text-zinc-400 hover:text-white transition-colors">Races</Link>
          <Link to="/what-matters" className="text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
            <BarChart3 className="w-3.5 h-3.5" />
            What Matters
          </Link>
          {user && (
            <Link to="/press/register" className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
              <Newspaper className="w-3.5 h-3.5" />
              Press
            </Link>
          )}
          {canModerate && (
            <Link to="/moderation" className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Moderation
            </Link>
          )}
          <Link to="/help" className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5" />
            Help
          </Link>
          {activeCandidateId && (
            <Link to={`/candidate/${activeCandidateId}`} className="text-zinc-400 hover:text-white transition-colors">
              Candidate Portal
            </Link>
          )}

          {user ? (
            <>
              {/* Candidate selector for staff/admin only */}
              {candidates.length > 0 && (
                <>
                  <div className="h-4 w-px bg-zinc-800" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">View As:</span>
                    <select
                      className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
                      value={activeCandidateId || ""}
                      onChange={handleCandidateChange}
                    >
                      {candidates.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.race_state})</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              <div className="h-4 w-px bg-zinc-800" />

              {/* User menu */}
              <div className="flex items-center gap-3">
                <Link to="/notifications" className="text-zinc-400 hover:text-white transition-colors relative">
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Link>
                <div className="flex items-center gap-2 text-zinc-400">
                  <User className="w-4 h-4" />
                  <span className="text-sm">{user.display_name || user.username}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="h-4 w-px bg-zinc-800" />
              <Link to="/login" className="text-zinc-400 hover:text-white transition-colors">Sign In</Link>
              <Link to="/register" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
                Sign Up
              </Link>
            </>
          )}
        </nav>

        {/* Hamburger button */}
        <button
          className="md:hidden p-2 text-zinc-400 hover:text-white transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="md:hidden border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-lg px-4 py-6 space-y-4">
          <Link to="/" className="block text-zinc-300 hover:text-white py-2 text-lg font-medium transition-colors">
            Races
          </Link>
          <Link to="/what-matters" className="block text-indigo-400 hover:text-indigo-300 py-2 text-lg font-medium transition-colors">
            What Matters
          </Link>
          {user && (
            <Link to="/press/register" className="block text-zinc-300 hover:text-white py-2 text-lg font-medium transition-colors">
              Press Credentials
            </Link>
          )}
          {canModerate && (
            <Link to="/moderation" className="block text-zinc-300 hover:text-white py-2 text-lg font-medium transition-colors">
              Moderation
            </Link>
          )}
          <Link to="/help" className="block text-zinc-300 hover:text-white py-2 text-lg font-medium transition-colors">
            Help
          </Link>
          {activeCandidateId && (
            <Link to={`/candidate/${activeCandidateId}`} className="block text-zinc-300 hover:text-white py-2 text-lg font-medium transition-colors">
              Candidate Portal
            </Link>
          )}

          {user ? (
            <>
              {candidates.length > 0 && (
                <div className="border-t border-zinc-800 pt-4">
                  <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">View As Candidate:</label>
                  <select
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500"
                    value={activeCandidateId || ""}
                    onChange={handleCandidateChange}
                  >
                    {candidates.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.race_state})</option>
                    ))}
                  </select>
                </div>
              )}
              <Link to="/notifications" className="flex items-center gap-2 text-zinc-300 hover:text-white py-2 text-lg font-medium transition-colors border-t border-zinc-800 pt-4">
                Notifications
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
              <div className="border-t border-zinc-800 pt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-zinc-400">
                  <User className="w-4 h-4" />
                  <span>{user.display_name || user.username}</span>
                </div>
                <button onClick={handleLogout} className="text-sm text-red-400 hover:text-red-300">
                  Sign Out
                </button>
              </div>
            </>
          ) : (
            <div className="border-t border-zinc-800 pt-4 flex gap-3">
              <Link to="/login" className="flex-1 text-center py-2 border border-zinc-700 text-white rounded-lg">Sign In</Link>
              <Link to="/register" className="flex-1 text-center py-2 bg-indigo-600 text-white rounded-lg">Sign Up</Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function AppContent() {
  const { user, initialized, init } = useAuth();
  const { races, fetchRaces, fetchRace, fetchAllCandidates, allCandidates } = useArenaStore();
  const location = useLocation();
  const lastTrackedPath = useRef<string | null>(null);

  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(
    () => {
      try { return localStorage.getItem("activeCandidateId"); } catch { return null; }
    }
  );

  // Initialize auth on mount
  useEffect(() => {
    init();
  }, []);

  // Fetch races on mount and when auth changes (bug #2 fix: invalidate stale data)
  const userId = user?.id;
  const portalCandidates = useMemo(() => {
    if (!user) return [];
    const linkedCandidateIds = new Set((user.staff_links || []).map((link: any) => link.candidate_id));
    return allCandidates.filter(candidate => linkedCandidateIds.has(candidate.id));
  }, [allCandidates, user]);

  useEffect(() => {
    if (!initialized) return;

    const pathname = location.pathname;
    if (lastTrackedPath.current === pathname) return;

    const previousPath = lastTrackedPath.current;
    lastTrackedPath.current = pathname;
    const telemetry = pageTelemetry(pathname);
    void api.trackEvent({
      event_type: 'page_view',
      race_id: telemetry.race_id,
      candidate_id: telemetry.candidate_id,
      content_type: telemetry.content_type,
      content_id: telemetry.content_id,
      metadata: {
        path: pathname,
        route: telemetry.route,
        referrer_path: previousPath,
        signed_in: Boolean(userId),
      },
    });
  }, [initialized, location.pathname, userId]);

  useEffect(() => {
    useArenaStore.getState().invalidate();
    fetchRaces();
  }, [userId]);

  // Fetch all race details for candidate list (bug #1 fix: use allSettled)
  useEffect(() => {
    if (races.length > 0) {
      Promise.allSettled(races.map(r => fetchRace(r.id))).then(() => {
        fetchAllCandidates();
      });
    }
  }, [races.length, userId]);

  // Set default active candidate
  useEffect(() => {
    if (portalCandidates.length === 0) {
      if (activeCandidateId) setActiveCandidateId(null);
      return;
    }
    if (!activeCandidateId || !portalCandidates.some(candidate => candidate.id === activeCandidateId)) {
      setActiveCandidateId(portalCandidates[0].id);
    }
  }, [portalCandidates, activeCandidateId]);

  useEffect(() => {
    if (activeCandidateId) {
      try { localStorage.setItem("activeCandidateId", activeCandidateId); } catch {}
    }
  }, [activeCandidateId]);

  // Bug #3 fix: add activeCandidateId to deps
  useEffect(() => {
    const match = location.pathname.match(/\/candidate\/([a-zA-Z0-9_-]+)/);
    if (match && match[1] !== activeCandidateId) {
      setActiveCandidateId(match[1]);
    }
  }, [location.pathname, activeCandidateId]);

  // Show loading spinner while auth initializes
  if (!initialized) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <CandidateContext.Provider value={{ candidates: portalCandidates, activeCandidateId, setActiveCandidateId }}>
      <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
        <Navigation />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/race/:id" element={<Race />} />
            <Route path="/challenge/:id" element={<ChallengeReceiptPage />} />
            <Route path="/profile/candidate/:id" element={<CandidateProfilePage />} />
            <Route path="/candidate/:id" element={user ? <CandidateDashboard /> : <Navigate to="/login" replace />} />
            <Route path="/candidate" element={<Navigate to="/" replace />} />
            <Route path="/what-matters" element={<WhatMattersPage />} />
            <Route path="/my-priorities" element={user ? <MyPrioritiesPage /> : <Navigate to="/login" replace />} />
            <Route path="/notifications" element={user ? <NotificationsPage /> : <Navigate to="/login" replace />} />
            <Route path="/moderation" element={user ? <ModerationPage /> : <Navigate to="/login" replace />} />
            <Route path="/press/register" element={user ? <PressRegistrationPage /> : <Navigate to="/login" replace />} />
            <Route path="/help" element={<Help />} />
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
            <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
            <Route path="/forgot-password" element={user ? <Navigate to="/" replace /> : <ForgotPassword />} />
            <Route path="/reset-password" element={user ? <Navigate to="/" replace /> : <ResetPassword />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <footer className="border-t border-zinc-800 mt-20 py-8 text-center text-xs text-zinc-600">
          Arena &mdash; A fair, structured environment for political candidates.{' '}
          {user && <span>Signed in as {user.display_name || user.username}.</span>}
        </footer>
      </div>
    </CandidateContext.Provider>
  );
}

function NotFound() {
  return (
    <div className="max-w-xl mx-auto px-4 py-24 text-center">
      <div className="text-6xl font-bold text-zinc-700 mb-4">404</div>
      <h1 className="text-2xl font-semibold text-white mb-2">Page Not Found</h1>
      <p className="text-zinc-400 mb-8">The page you're looking for doesn't exist.</p>
      <Link to="/" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">
        Back to Races
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
