import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Search, TrendingUp, ChevronRight, Flame, Clock } from "lucide-react";
import { useArenaStore } from "../store";

type SortMode = 'trending' | 'newest' | 'name';

const ELECTION_DATE = new Date('2026-11-03T00:00:00Z');
function daysToElection(): number {
  const ms = ELECTION_DATE.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

// Optional enriched fields Codex is adding to GET /api/races
interface CandSummary { name: string; party: string }
interface OpenCallout { target_name: string; claim_text: string; response_deadline: string }
interface CycleStats { races_live: number; open_callouts: number; response_rate: number; election_date?: string }
interface FeedItem { time?: string; race_label?: string; kind?: string; text?: string }

const partyColor = (p?: string) => {
  const k = (p || '').toUpperCase();
  if (k.startsWith('DEM') || k === 'D') return { text: '#4D8AF0', ring: 'rgba(77,138,240,.6)', grad: 'linear-gradient(145deg,#1C2C4E,#101A30)', soft: '#7FA8F5' };
  if (k.startsWith('REP') || k === 'R') return { text: '#E5636A', ring: 'rgba(229,72,77,.55)', grad: 'linear-gradient(145deg,#4A1D22,#2A1114)', soft: '#F08085' };
  return { text: '#9B9BAB', ring: 'rgba(255,255,255,.25)', grad: 'linear-gradient(145deg,#25252E,#16161C)', soft: '#C7C7D2' };
};
const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '—';

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const display = "'Space Grotesk', system-ui, sans-serif";
const serif = "'Instrument Serif', ui-serif, Georgia, serif";

function RaceCard({ race, days }: { race: any; days: number }) {
  const cands: CandSummary[] = race.candidates_summary || [];
  const open: OpenCallout | null = race.open_callout || null;
  const score = race.activity_score || 0;
  const level = /senate|house|president/i.test(race.office) ? 'FEDERAL' : 'STATE';
  const officeLine = [race.state, level, (race.office || '').toUpperCase(), race.district ? `DIST ${race.district}` : '']
    .filter(Boolean).join(' · ');
  const hot = score >= 10;
  const filled = Math.min(10, Math.round((score / Math.max(score, 8)) * 10) || 0);

  const status = open
    ? { label: 'CALLOUT OPEN', color: '#EFB643', bg: 'rgba(239,182,67,.08)', bd: 'rgba(239,182,67,.35)' }
    : hot
      ? { label: 'HOT', color: '#FFB224', bg: 'rgba(255,178,36,.1)', bd: 'rgba(255,178,36,.35)' }
      : { label: 'TRENDING', color: '#8F8FF9', bg: 'rgba(110,110,247,.1)', bd: 'rgba(110,110,247,.35)' };

  const highlight = hot || !!open;
  return (
    <Link to={`/race/${race.id}`} style={{ textDecoration: 'none', display: 'flex' }}>
      <div style={{
        position: 'relative', flex: 1, borderRadius: 16, padding: 22, display: 'flex', flexDirection: 'column', gap: 16,
        border: highlight ? '1px solid rgba(110,110,247,.45)' : '1px solid rgba(255,255,255,.09)',
        background: highlight ? 'linear-gradient(180deg,rgba(110,110,247,.09),rgba(110,110,247,.02) 55%),#0C0C13' : '#0C0C13',
        boxShadow: highlight ? '0 10px 40px rgba(110,110,247,.1)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ font: `600 9.5px ${mono}`, letterSpacing: '.16em', color: '#8F8FF9' }}>{officeLine}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: `700 9px ${mono}`, letterSpacing: '.12em', color: status.color, background: status.bg, border: `1px solid ${status.bd}`, padding: '4px 9px', borderRadius: 99, whiteSpace: 'nowrap' }}>
            {status.label === 'CALLOUT OPEN' ? <Clock size={10} /> : status.label === 'HOT' ? <Flame size={10} /> : <TrendingUp size={10} />}
            {status.label}
          </span>
        </div>

        <div style={{ font: `600 21px/1.2 ${display}`, color: '#F2F2F7' }}>{race.name}</div>

        {cands.length >= 2 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
            <CandBadge c={cands[0]} align="left" />
            <span style={{ font: `italic 400 17px ${serif}`, color: '#5C5C6E' }}>vs</span>
            <CandBadge c={cands[1]} align="right" />
          </div>
        ) : (
          <div style={{ font: `500 12px ${mono}`, color: '#5C5C6E', letterSpacing: '.06em' }}>
            {(race.candidate_count || 0)} {race.candidate_count === 1 ? 'candidate' : 'candidates'} registered
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ font: `600 8.5px ${mono}`, letterSpacing: '.16em', color: '#5C5C6E' }}>ARENA ACTIVITY</span>
            <span style={{ font: `600 8.5px ${mono}`, letterSpacing: '.1em', color: hot ? '#8F8FF9' : '#9B9BAB' }}>{hot ? 'HIGH' : score > 0 ? 'RISING' : 'QUIET'}</span>
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: i < filled ? `hsl(${245 + i * 6} 85% ${66 - i * 2}%)` : 'rgba(255,255,255,.08)' }} />
            ))}
          </div>
        </div>

        {open && (
          <div style={{ border: '1px solid rgba(239,182,67,.25)', background: 'rgba(239,182,67,.05)', borderRadius: 10, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ font: `600 8.5px ${mono}`, letterSpacing: '.14em', color: '#EFB643' }}>AWAITING RESPONSE · {(open.target_name || '').toUpperCase()}</span>
            <span style={{ font: `italic 400 14px/1.35 ${serif}`, color: '#D6D6DE' }}>“{open.claim_text}”</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, font: `500 11px ${mono}`, color: '#9B9BAB', flexWrap: 'wrap' }}>
          {(race.challenge_count || 0) > 0 && <Stat color="#EFB643">{race.challenge_count} callout{race.challenge_count === 1 ? '' : 's'}</Stat>}
          {(race.ad_count || 0) > 0 && <Stat color="#4D8AF0">{race.ad_count} ad{race.ad_count === 1 ? '' : 's'}</Stat>}
          {(race.question_count || 0) > 0 && <Stat color="#34C384">{race.question_count} question{race.question_count === 1 ? '' : 's'}</Stat>}
          {(race.response_count || 0) > 0 && <Stat color="#A78BFA">{race.response_count} response{race.response_count === 1 ? '' : 's'}</Stat>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,.07)', paddingTop: 14 }}>
          <span style={{ font: `500 10px ${mono}`, letterSpacing: '.12em', color: '#5C5C6E' }}>{days}D TO ELECTION</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: `600 12.5px 'Hanken Grotesk',sans-serif`, color: '#8F8FF9' }}>
            Enter arena <ChevronRight size={13} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function CandBadge({ c, align }: { c: CandSummary; align: 'left' | 'right' }) {
  const pc = partyColor(c.party);
  const avatar = (
    <div style={{ width: 42, height: 42, borderRadius: '50%', background: pc.grad, border: `1.5px solid ${pc.ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 13px ${display}`, color: pc.soft }}>{initials(c.name)}</div>
  );
  const label = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span style={{ font: `600 13.5px 'Hanken Grotesk',sans-serif`, color: '#F2F2F7' }}>{c.name.split(/\s+/).slice(-1)[0]}</span>
      <span style={{ font: `500 9px ${mono}`, letterSpacing: '.1em', color: pc.text }}>{(c.party || '').toUpperCase().slice(0, 3)}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      {align === 'left' ? <>{avatar}{label}</> : <>{label}{avatar}</>}
    </div>
  );
}

function Stat({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: color }} />{children}</span>;
}

function LedgerRow({ label, value, color, last }: { label: string; value: React.ReactNode; color: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '13px 16px', borderBottom: last ? 'none' : '1px solid rgba(255,255,255,.06)' }}>
      <span style={{ font: `500 11px ${mono}`, letterSpacing: '.08em', color: '#9B9BAB' }}>{label}</span>
      <span style={{ font: `600 22px ${display}`, color }}>{value}</span>
    </div>
  );
}

export function Home() {
  const { races, fetchRaces } = useArenaStore();
  const [loaded, setLoaded] = useState(races.length > 0);
  const [sort, setSort] = useState<SortMode>('trending');
  const [stats, setStats] = useState<CycleStats | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const days = daysToElection();

  useEffect(() => { fetchRaces(sort).finally(() => setLoaded(true)); }, [sort]);

  useEffect(() => {
    // Endpoints Codex is building — consume when present, fall back gracefully.
    fetch('/api/stats/cycle').then(r => r.ok ? r.json() : null).then(d => setStats(d?.data ?? d ?? null)).catch(() => {});
    fetch('/api/feed/live').then(r => r.ok ? r.json() : null).then(d => setFeed((d?.data?.events ?? d?.events ?? []) as FeedItem[])).catch(() => {});
  }, []);

  const racesLive = stats?.races_live ?? (races.filter(r => r.status === 'active').length || races.length);
  const openCallouts = stats?.open_callouts;
  const responseRate = stats?.response_rate;
  const pad2 = (n?: number) => n === undefined ? '—' : String(n).padStart(2, '0');

  return (
    <div style={{ background: '#08080C', color: '#F2F2F7', fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
      {/* hero + cycle ledger */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 60, alignItems: 'end', padding: '64px 40px 48px', maxWidth: 1440, margin: '0 auto', background: 'radial-gradient(1000px 420px at 18% -10%, rgba(110,110,247,.13), transparent 65%)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="arena-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#34C384', boxShadow: '0 0 10px rgba(52,195,132,.8)' }} />
            <span style={{ font: `600 10.5px ${mono}`, letterSpacing: '.2em', color: '#34C384' }}>{racesLive} ARENA{racesLive === 1 ? '' : 'S'} IN SESSION</span>
          </div>
          <div style={{ font: `400 84px/1.02 ${serif}`, letterSpacing: '-.01em', color: '#F2F2F7' }}>
            Every claim goes <em style={{ color: '#8F8FF9' }}>on the record.</em>
          </div>
          <div style={{ font: `400 17px/1.6 'Hanken Grotesk',sans-serif`, color: '#9B9BAB', maxWidth: 560 }}>
            Candidates campaign, challenge each other, and answer to voters inside a structured public arena — deadlines, receipts, and audit trails built into the platform itself.
          </div>
        </div>
        <div style={{ border: '1px solid rgba(255,255,255,.1)', borderRadius: 14, background: 'rgba(255,255,255,.02)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.08)', font: `600 9.5px ${mono}`, letterSpacing: '.18em', color: '#5C5C6E' }}>CYCLE LEDGER · 2026 MIDTERMS</div>
          <LedgerRow label="ARENAS LIVE" value={pad2(racesLive)} color="#F2F2F7" />
          <LedgerRow label="OPEN CALLOUTS" value={pad2(openCallouts)} color="#EFB643" />
          <LedgerRow label="RESPONSE RATE" value={responseRate === undefined ? '—' : `${responseRate}%`} color="#34C384" />
          <LedgerRow label="ELECTION IN" value={<>{days}<span style={{ font: `600 12px ${display}`, color: '#5C5C6E' }}> DAYS</span></>} color="#F2F2F7" last />
        </div>
      </div>

      {/* section head + sort + search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 40px 22px', maxWidth: 1440, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ font: `600 20px ${display}`, color: '#F2F2F7' }}>Active arenas</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {([['trending', 'Trending'], ['newest', 'Newest'], ['name', 'A–Z']] as [SortMode, string][]).map(([key, label]) => {
              const active = sort === key;
              return (
                <button key={key} onClick={() => { setSort(key); setLoaded(false); }} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                  font: `600 12px 'Hanken Grotesk',sans-serif`, padding: '7px 14px', borderRadius: 99,
                  color: active ? '#C7C7F9' : '#9B9BAB',
                  background: active ? 'rgba(110,110,247,.14)' : 'rgba(255,255,255,.03)',
                  border: active ? '1px solid rgba(110,110,247,.4)' : '1px solid rgba(255,255,255,.1)',
                }}>
                  {key === 'trending' && <TrendingUp size={12} />}{label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid rgba(255,255,255,.1)', borderRadius: 9, padding: '8px 14px', width: 280, background: 'rgba(255,255,255,.02)' }}>
          <Search size={13} color="#5C5C6E" />
          <span style={{ font: `400 11px ${mono}`, color: '#5C5C6E', letterSpacing: '.04em' }}>Search races, candidates, claims…</span>
        </div>
      </div>

      {/* race grid */}
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '0 40px 56px' }}>
        {!loaded ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div style={{ width: 24, height: 24, border: '2px solid rgba(110,110,247,.3)', borderTopColor: '#6E6EF7', borderRadius: '50%', animation: 'arena-marquee 0s' }} className="arena-pulse" />
          </div>
        ) : races.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', border: '1px solid rgba(255,255,255,.09)', borderRadius: 16, background: '#0C0C13' }}>
            <div style={{ color: '#9B9BAB', marginBottom: 6 }}>No active arenas yet</div>
            <div style={{ font: `400 12px ${mono}`, color: '#5C5C6E' }}>Check back soon.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {races.map(race => <RaceCard key={race.id} race={race} days={days} />)}
          </div>
        )}
      </div>
    </div>
  );
}
