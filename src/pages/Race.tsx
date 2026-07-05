import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useArenaStore } from "../store";
import { useIsMobile } from "../hooks/useIsMobile";

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const display = "'Space Grotesk', system-ui, sans-serif";
const serif = "'Instrument Serif', ui-serif, Georgia, serif";

const isDem = (p?: string) => /^dem/i.test(p || "");
const isRep = (p?: string) => /^rep/i.test(p || "");
const partyC = (p?: string) => isDem(p)
  ? { text: "#4D8AF0", ring: "rgba(77,138,240,.65)", grad: "linear-gradient(145deg,#1C2C4E,#101A30)", soft: "#7FA8F5", bar: "#4D8AF0" }
  : isRep(p)
    ? { text: "#E5636A", ring: "rgba(229,72,77,.6)", grad: "linear-gradient(145deg,#4A1D22,#2A1114)", soft: "#F08085", bar: "#E5484D" }
    : { text: "#9B9BAB", ring: "rgba(255,255,255,.25)", grad: "linear-gradient(145deg,#25252E,#16161C)", soft: "#C7C7D2", bar: "#6E6EF7" };
const initials = (n?: string) => (n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "—";
const fmtDT = (iso?: string) => { const d = new Date((iso || "").replace(" ", "T")); if (isNaN(d.getTime())) return ""; return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET`; };

function Stat({ v, label, color = "#F2F2F7", align = "start" }: { v: React.ReactNode; label: string; color?: string; align?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: align === "end" ? "flex-end" : "flex-start" }}>
      <span style={{ font: `600 20px ${display}`, color }}>{v}</span>
      <span style={{ font: `500 8.5px ${mono}`, letterSpacing: ".12em", color: "#5C5C6E" }}>{label}</span>
    </span>
  );
}

function ReciteChip({ r }: { r: any }) {
  const stance = (r.stance || r.status || "").toLowerCase();
  const c = stance.includes("support") ? "#34C384" : stance.includes("context") ? "#EFB643" : "#E5636A";
  const lbl = stance.includes("support") ? "SUPPORTS" : stance.includes("context") ? "CONTEXT" : "REFUTES";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 10px ${mono}`, color: "#9B9BAB", border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.02)", padding: "5px 10px", borderRadius: 7 }}>
      ↗ RECITE · {(r.title || r.source_type || "SOURCE").toUpperCase().slice(0, 42)} · <span style={{ color: c }}>{lbl}</span>
    </span>
  );
}

function FactBar({ label, fs }: { label: string; fs?: any }) {
  const val = fs?.score ?? 50;
  const good = val >= 60;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".12em", color: "#5C5C6E" }}>{label}</span>
      <div style={{ width: 76, height: 4, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}><div style={{ width: `${Math.max(4, Math.min(100, val))}%`, height: "100%", background: good ? "linear-gradient(90deg,#EFB643,#34C384)" : "linear-gradient(90deg,#E5636A,#EFB643)" }} /></div>
      <span style={{ font: `600 11px ${mono}`, color: good ? "#34C384" : "#EFB643" }}>{val} · {(fs?.label || "MIXED").toUpperCase().replace(/_/g, "-")}</span>
    </div>
  );
}

function CalloutCard({ ch, cands, responses }: { ch: any; cands: any[]; responses: any[] }) {
  const challenger = cands.find(c => c.id === ch.challenger_candidate_id);
  const target = cands.find(c => c.id === ch.target_candidate_id);
  const resp = responses.find(r => r.challenge_id === ch.id);
  const respCand = resp && cands.find(c => c.id === resp.candidate_id);
  const crs = ch.challenge_recite_summary || {};
  const responded = ch.status === "responded";
  const statusPill = responded ? { t: "RESPONDED · ON TIME", c: "#34C384" } : ch.status === "expired" ? { t: "NO RESPONSE", c: "#E5484D" } : ch.status === "refused" ? { t: "REFUSED", c: "#E5636A" } : { t: "AWAITING RESPONSE", c: "#EFB643" };
  const cc = partyC(challenger?.party), tc = partyC(target?.party);
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#9B9BAB" }}>CALLOUT · {String(ch.public_receipt_slug || ch.id).toUpperCase()}</span>
          <span style={{ font: `700 8.5px ${mono}`, letterSpacing: ".12em", color: "#EFB643", background: "rgba(239,182,67,.09)", border: "1px solid rgba(239,182,67,.3)", padding: "3px 8px", borderRadius: 99 }}>{(ch.challenge_type || "FACT CHECK").toUpperCase().replace(/_/g, " ")}</span>
        </div>
        <span style={{ font: `700 8.5px ${mono}`, letterSpacing: ".12em", color: statusPill.c, background: `${statusPill.c}17`, border: `1px solid ${statusPill.c}4d`, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>{statusPill.t}</span>
      </div>
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: cc.grad, border: `1.5px solid ${cc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10.5px ${display}`, color: cc.soft }}>{initials(challenger?.name)}</div>
          <span style={{ font: `600 13px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{challenger?.name?.split(/\s+/).slice(-1)[0]}</span>
          <span style={{ color: "#5C5C6E" }}>→</span>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: tc.grad, border: `1.5px solid ${tc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10.5px ${display}`, color: tc.soft }}>{initials(target?.name)}</div>
          <span style={{ font: `600 13px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{target?.name?.split(/\s+/).slice(-1)[0]}</span>
          <span style={{ font: `500 10px ${mono}`, color: "#5C5C6E", marginLeft: "auto" }}>FILED {fmtDT(ch.created_at)}</span>
        </div>
        <div style={{ font: `italic 400 21px/1.45 ${serif}`, color: "#E8E8EF", borderLeft: "2px solid #EFB643", paddingLeft: 18 }}>“{ch.claim_text || ch.challenge_text}”</div>
        {crs.top_source && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><ReciteChip r={crs.top_source} />{crs.recite_count > 1 && <span style={{ font: `500 10px ${mono}`, color: "#5C5C6E", alignSelf: "center" }}>+{crs.recite_count - 1} more on receipt</span>}</div>}
        {resp && (
          <div style={{ border: "1px solid rgba(52,195,132,.22)", borderLeft: "3px solid #34C384", borderRadius: 12, background: "rgba(52,195,132,.04)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: tc.grad, border: `1.5px solid ${tc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 9.5px ${display}`, color: tc.soft }}>{initials(respCand?.name)}</div>
              <span style={{ font: `600 12.5px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{respCand?.name?.split(/\s+/).slice(-1)[0]} responds</span>
              <span style={{ font: `500 9.5px ${mono}`, color: "#5C5C6E" }}>{fmtDT(resp.created_at)}</span>
            </div>
            <div style={{ font: `400 14px/1.65 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{resp.response_text}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderTop: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)", flexWrap: "wrap", gap: 10 }}>
        <FactBar label="CLAIM FACT SCORE" fs={crs.fact_score} />
        <Link to={`/challenge/${ch.public_receipt_slug || ch.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `600 12.5px 'Hanken Grotesk',sans-serif`, color: "#8F8FF9", textDecoration: "none" }}>View public receipt →</Link>
      </div>
    </div>
  );
}

export function Race() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const { raceDetails, fetchRace } = useArenaStore();
  const [questions, setQuestions] = useState<any[]>([]);
  const [tab, setTab] = useState<"wire" | "callouts" | "ads" | "questions">("wire");
  const race = id ? raceDetails[id] : null;

  useEffect(() => { if (id) { fetchRace(id); fetch(`/api/questions/${id}`).then(r => r.ok ? r.json() : null).then(d => setQuestions((d?.data?.questions ?? []) as any[])).catch(() => {}); } }, [id]);

  if (!race) return <div style={{ padding: 80, textAlign: "center", font: `400 13px ${mono}`, color: "#5C5C6E" }}>Loading race…</div>;

  const cands = race.candidates || [];
  const dem = cands.find(c => isDem(c.party)) || cands[0];
  const rep = cands.find(c => isRep(c.party)) || cands[1];
  const challenges = race.challenges || [];
  const responses = race.challengeResponses || [];
  const ads = race.ads || [];
  const rebuttals = race.rebuttals || [];
  const level = /senate|house|president/i.test(race.office) ? "FEDERAL" : "STATE";

  const statsFor = (c: any) => {
    if (!c) return { filed: 0, answered: 0, recites: 0 };
    const filed = challenges.filter((x: any) => x.challenger_candidate_id === c.id).length;
    const received = challenges.filter((x: any) => x.target_candidate_id === c.id);
    const answered = received.filter((x: any) => x.status === "responded").length;
    const recites = challenges.filter((x: any) => x.challenger_candidate_id === c.id).reduce((s: number, x: any) => s + (x.challenge_recite_summary?.fact_score?.verified_count || 0), 0);
    return { filed, answered, received: received.length, recites };
  };
  const dS = statsFor(dem), rS = statsFor(rep);

  const TABS: [typeof tab, string, number | null][] = [["wire", "The Wire", null], ["callouts", "Callouts", challenges.length], ["ads", "Ads & Rebuttals", ads.length], ["questions", "Voter Questions", questions.length]];

  const CandCol = ({ c, s, side }: { c: any; s: any; side: "l" | "r" }) => {
    const pc = partyC(c?.party);
    const av = <div style={{ flex: "none", width: 76, height: 76, borderRadius: "50%", background: pc.grad, border: `2px solid ${pc.ring}`, boxShadow: `0 0 34px ${pc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 22px ${display}`, color: pc.soft }}>{initials(c?.name)}</div>;
    const body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: side === "l" ? "flex-end" : "flex-start", textAlign: side === "l" ? "right" : "left" }}>
        <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: pc.text }}>{(c?.party || "").toUpperCase()}</span>
        <span style={{ font: `600 24px ${display}`, color: "#F2F2F7", lineHeight: 1.1 }}>{c?.name}</span>
        <span style={{ font: `400 12px/1.5 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", maxWidth: 300 }}>{(c?.biography || "").slice(0, 80)}</span>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <Stat v={s.filed} label="CALLOUTS FILED" align={side === "l" ? "end" : "start"} />
          <Stat v={`${s.answered}/${s.received || 0}`} label="ANSWERED" color="#34C384" align={side === "l" ? "end" : "start"} />
          <Stat v={s.recites} label="RECITES VERIF" color="#34C384" align={side === "l" ? "end" : "start"} />
        </div>
      </div>
    );
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 18, justifyContent: side === "l" ? "flex-end" : "flex-start", padding: "22px 26px", border: `1px solid ${pc.ring}`, borderRadius: side === "l" ? "16px 4px 4px 16px" : "4px 16px 16px 4px", background: side === "l" ? `linear-gradient(270deg,${pc.ring},transparent)` : `linear-gradient(90deg,${pc.ring},transparent)` }}>
        {side === "l" ? <>{body}{av}</> : <>{av}{body}</>}
      </div>
    );
  };

  return (
    <div style={{ background: "#08080C", color: "#F2F2F7", fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
      {/* breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 40px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <Link to="/" style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", textDecoration: "none" }}>‹ All races</Link>
        <span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".12em", color: "#44444F" }}>RECORD ID · {String(race.id).toUpperCase()}</span>
      </div>

      {/* hero */}
      <div style={{ padding: "44px 40px 36px", borderBottom: "1px solid rgba(255,255,255,.08)", background: "linear-gradient(90deg,rgba(77,138,240,.09),transparent 32%,transparent 68%,rgba(229,72,77,.09)),#0A0A10" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 24 }}>
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".16em", color: "#8F8FF9" }}>{race.state} · {level} · {(race.office || "").toUpperCase()}</span>
        </div>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <div style={{ font: `400 ${isMobile ? 32 : 54}px/1.05 ${serif}`, color: "#F2F2F7" }}>{race.name}</div>
          {(race as any).description && <div style={{ marginTop: 12, font: `400 14px/1.6 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", maxWidth: 640, margin: "12px auto 0" }}>{(race as any).description}</div>}
        </div>
        {dem && rep && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 120px 1fr", gap: isMobile ? 12 : 0, alignItems: "stretch", maxWidth: 1080, margin: "0 auto" }}>
            <CandCol c={dem} s={dS} side="l" />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <span style={{ font: `italic 400 34px ${serif}`, color: "#5C5C6E" }}>vs</span>
              <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".18em", color: "#44444F" }}>{cands.filter((c: any) => c.verification_status === "verified").length} VERIFIED</span>
            </div>
            <CandCol c={rep} s={rS} side="r" />
          </div>
        )}
      </div>

      {/* tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: isMobile ? "0 12px" : "0 40px", borderBottom: "1px solid rgba(255,255,255,.08)", overflowX: "auto", whiteSpace: "nowrap" }}>
        {TABS.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flexShrink: 0, cursor: "pointer", background: "none", border: "none", font: `${tab === k ? 600 : 500} 13px 'Hanken Grotesk',sans-serif`, color: tab === k ? "#F2F2F7" : "#9B9BAB", padding: isMobile ? "14px 11px 12px" : "16px 16px 14px", borderBottom: tab === k ? "2px solid #6E6EF7" : "2px solid transparent", display: "inline-flex", alignItems: "center", gap: 7 }}>
            {label}{n != null && <span style={{ font: `600 9.5px ${mono}`, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 99, padding: "2px 7px", color: "#9B9BAB" }}>{n}</span>}
          </button>
        ))}
      </div>

      {/* body */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) 332px", gap: isMobile ? 18 : 26, padding: isMobile ? "24px 16px 40px" : "30px 40px 44px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {(tab === "wire" || tab === "callouts") && challenges.map((ch: any) => <CalloutCard key={ch.id} ch={ch} cands={cands} responses={responses} />)}
          {(tab === "wire" || tab === "ads") && ads.map((ad: any) => {
            const cand = cands.find((c: any) => c.id === ad.candidate_id); const pc = partyC(cand?.party);
            const reb = rebuttals.filter((r: any) => r.parent_ad_id === ad.id);
            return (
              <div key={ad.id} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
                  <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#9B9BAB" }}>AD FLIGHT · {String(ad.id).toUpperCase()}</span>
                  <span style={{ font: `600 10px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E" }}>SERVED AS A PAIRED UNIT — CLAIM + ANSWER</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
                  <div style={{ padding: 22, borderRight: "1px solid rgba(255,255,255,.07)", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: pc.grad, border: `1.5px solid ${pc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10.5px ${display}`, color: pc.soft }}>{initials(cand?.name)}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `600 13px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{cand?.name} campaign</span><span style={{ font: `500 9px ${mono}`, letterSpacing: ".1em", color: pc.text }}>{(cand?.party || "").toUpperCase().slice(0, 3)} · {ad.source_type === "external" ? "OUTSIDE AD" : "VERIFIED"}</span></div>
                    </div>
                    {ad.title && <div style={{ font: `600 19px/1.3 ${display}`, color: "#F2F2F7" }}>{ad.title}</div>}
                    <div style={{ font: `400 13.5px/1.65 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{ad.ad_content_text}</div>
                    <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 7, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.025)", borderRadius: 8, padding: "8px 12px" }}><span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".1em", color: "#9B9BAB" }}>ⓘ {ad.disclaimer_text || "PAID FOR BY THE CAMPAIGN · MANDATORY DISCLAIMER"}</span></div>
                  </div>
                  <div style={{ padding: 22, background: "rgba(110,110,247,.025)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#8F8FF9" }}>◷ EQUAL TIME · REBUTTAL WINDOW</span>
                    {[0, 1, 2].map(i => {
                      const r = reb[i];
                      const rc = r && cands.find((c: any) => c.id === r.candidate_id);
                      return r ? (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(52,195,132,.3)", background: "rgba(52,195,132,.05)", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ width: 26, height: 26, borderRadius: "50%", background: partyC(rc?.party).grad, border: `1.5px solid ${partyC(rc?.party).ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 9.5px ${display}`, color: partyC(rc?.party).soft }}>{initials(rc?.name)}</div>
                          <span style={{ font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>Slot {i + 1} — {rc?.name?.split(/\s+/).slice(-1)[0]}</span>
                          <span style={{ marginLeft: "auto", font: `700 8.5px ${mono}`, letterSpacing: ".1em", color: "#34C384" }}>ANSWERED</span>
                        </div>
                      ) : (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px dashed rgba(255,255,255,.16)", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", font: `600 11px ${display}`, color: "#5C5C6E" }}>{i + 1}</div>
                          <span style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#9B9BAB" }}>Open — any opposing campaign</span>
                          <span style={{ marginLeft: "auto", font: `600 8.5px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E" }}>OPEN</span>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: "auto", font: `400 11px/1.55 'Hanken Grotesk',sans-serif`, color: "#5C5C6E" }}>When an Arena ad goes live, opposing candidates get a reserved rebuttal window. Voters always see claim and answer together.</div>
                  </div>
                </div>
              </div>
            );
          })}
          {(tab === "wire" || tab === "questions") && (
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)" }}>
                <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#9B9BAB" }}>VOTER QUESTIONS · RANKED BY UPVOTES</span>
                <span style={{ font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#8F8FF9" }}>Submit a question +</span>
              </div>
              {questions.length === 0 && <div style={{ padding: "22px", font: `400 13px 'Hanken Grotesk',sans-serif`, color: "#5C5C6E" }}>No questions yet — be the first to ask the candidates.</div>}
              {questions.map((q: any) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 22px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                  <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, border: "1px solid rgba(110,110,247,.4)", background: "rgba(110,110,247,.08)", borderRadius: 9, padding: "7px 12px" }}>
                    <span style={{ color: "#8F8FF9" }}>▲</span><span style={{ font: `600 13px ${display}`, color: "#F2F2F7" }}>{q.vote_count ?? 0}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ font: `500 14.5px/1.45 'Hanken Grotesk',sans-serif`, color: "#E8E8EF" }}>{q.question_text}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, font: `500 9.5px ${mono}`, letterSpacing: ".08em", color: "#5C5C6E" }}>
                      <span style={{ color: q.source_type === "press" ? "#8F8FF9" : "#5C5C6E" }}>{(q.source_type || "voter").toUpperCase()}{q.author_name ? ` · ${q.author_name.toUpperCase()}` : ""}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "rgba(255,255,255,.02)", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: "#5C5C6E" }}>RULES OF THIS ARENA</div>
            {[["RESPONSE SLA", "72 HOURS"], ["REBUTTAL WINDOW", "48 HOURS"], ["REBUTTAL SLOTS", "3 PER AD"], ["CALLOUT CAPS", "3 / DAY · 10 / WK"]].map(([k, v], i, a) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderBottom: i < a.length - 1 ? "1px solid rgba(255,255,255,.05)" : "none" }}><span style={{ font: `500 10.5px ${mono}`, color: "#9B9BAB" }}>{k}</span><span style={{ font: `600 10.5px ${mono}`, color: "#F2F2F7" }}>{v}</span></div>
            ))}
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "rgba(255,255,255,.02)", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: "#5C5C6E" }}>TRUST LEDGER · THIS RACE</div>
            {[[dem, dS], [rep, rS]].filter(([c]) => c).map(([c, s]: any, i) => (
              <div key={c.id} style={{ padding: "14px 16px", borderBottom: i === 0 ? "1px solid rgba(255,255,255,.05)" : "none", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{c.name?.split(/\s+/).slice(-1)[0]}</span><span style={{ font: `600 11px ${mono}`, color: "#9B9BAB" }}>{s.received ? Math.round((s.answered / s.received) * 100) : 100}% ANS</span></div>
                <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,.07)", overflow: "hidden" }}><div style={{ width: `${s.received ? (s.answered / s.received) * 100 : 100}%`, height: "100%", background: partyC(c.party).bar }} /></div>
                <span style={{ font: `500 9px ${mono}`, letterSpacing: ".08em", color: "#5C5C6E" }}>{s.filed} FILED · {s.answered}/{s.received || 0} ANSWERED · {s.recites} RECITES VERIFIED</span>
              </div>
            ))}
          </div>
          <div style={{ border: "1px solid rgba(52,195,132,.25)", borderRadius: 14, background: "rgba(52,195,132,.04)", padding: "14px 16px", display: "flex", gap: 11, alignItems: "flex-start" }}>
            <span style={{ color: "#34C384", flex: "none" }}>◆</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ font: `600 11.5px 'Hanken Grotesk',sans-serif`, color: "#7BE0B2" }}>Tamper-evident record</span>
              <span style={{ font: `400 11px/1.55 'Hanken Grotesk',sans-serif`, color: "#9B9BAB" }}>Every action in this race is hash-chained in an append-only audit log. Verify any receipt independently.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
