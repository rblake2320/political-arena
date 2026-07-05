import { useEffect, useState } from "react";
import { useParams } from "react-router";
import * as api from "../api";

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const display = "'Space Grotesk', system-ui, sans-serif";
const serif = "'Instrument Serif', ui-serif, Georgia, serif";

const partyColor = (p?: string) => {
  const k = (p || "").toUpperCase();
  if (k.startsWith("DEM") || k === "D") return { text: "#4D8AF0", ring: "rgba(77,138,240,.65)", grad: "linear-gradient(145deg,#1C2C4E,#101A30)", soft: "#7FA8F5" };
  if (k.startsWith("REP") || k === "R") return { text: "#E5636A", ring: "rgba(229,72,77,.6)", grad: "linear-gradient(145deg,#4A1D22,#2A1114)", soft: "#F08085" };
  return { text: "#9B9BAB", ring: "rgba(255,255,255,.25)", grad: "linear-gradient(145deg,#25252E,#16161C)", soft: "#C7C7D2" };
};
const initials = (n?: string) => (n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "—";
const fmtDate = (iso?: string) => { const d = new Date((iso || "").replace(" ", "T")); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const fmtDateTime = (iso?: string) => { const d = new Date((iso || "").replace(" ", "T")); if (isNaN(d.getTime())) return ""; return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET`; };

const STAMP: Record<string, { label: string; color: string; sub: (c: any) => string }> = {
  responded: { label: "RESPONDED", color: "#34C384", sub: c => `WITHIN DEADLINE · ${fmtDate(c.responded_at) || fmtDate(c.response_deadline)}` },
  expired: { label: "NO RESPONSE", color: "#E5484D", sub: c => `DEADLINE PASSED · ${fmtDate(c.expired_at) || fmtDate(c.response_deadline)}` },
  refused: { label: "REFUSED", color: "#E5636A", sub: c => `${fmtDate(c.refused_at)}` },
  withdrawn: { label: "WITHDRAWN", color: "#9B9BAB", sub: () => "CHALLENGE RETRACTED" },
  open: { label: "AWAITING RESPONSE", color: "#EFB643", sub: c => `DUE ${fmtDate(c.response_deadline)}` },
};

function Stamp({ status, challenge }: { status: string; challenge: any }) {
  const s = STAMP[status] || STAMP.open;
  return (
    <div style={{ flex: "none", transform: "rotate(4deg)", border: `2.5px solid ${s.color}`, borderRadius: 10, padding: "10px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, boxShadow: `inset 0 0 0 2px ${s.color}2e`, background: `${s.color}0d` }}>
      <span style={{ font: `700 15px ${display}`, letterSpacing: ".12em", color: s.color, whiteSpace: "nowrap" }}>{s.label}</span>
      <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".14em", color: s.color, opacity: 0.8, whiteSpace: "nowrap" }}>{s.sub(challenge)}</span>
    </div>
  );
}

function FactScore({ label, score, tone = "response" }: { label: string; score?: { score?: number; label?: string }; tone?: string }) {
  const val = score?.score ?? 50;
  const good = val >= 60;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".12em", color: "#5C5C6E" }}>{label}</span>
      <div style={{ width: 90, height: 4, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(4, Math.min(100, val))}%`, height: "100%", background: good ? "linear-gradient(90deg,#EFB643,#34C384)" : "linear-gradient(90deg,#E5636A,#EFB643)" }} />
      </div>
      <span style={{ font: `700 11px ${mono}`, color: good ? "#34C384" : "#EFB643" }}>{val} · {(score?.label || "under-recited").toUpperCase().replace(/_/g, "-")}</span>
    </div>
  );
}

function ReciteCard({ r }: { r: any }) {
  const supports = r.stance === "supports";
  const context = r.stance === "context";
  const stanceColor = supports ? "#34C384" : context ? "#EFB643" : "#E5636A";
  const stanceLabel = supports ? "SUPPORTS" : context ? "ADDS CONTEXT" : "REFUTES";
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.09)", borderRadius: 11, background: "rgba(255,255,255,.02)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ font: `700 8px ${mono}`, letterSpacing: ".12em", color: "#8F8FF9", background: "rgba(110,110,247,.1)", border: "1px solid rgba(110,110,247,.35)", padding: "3px 7px", borderRadius: 99 }}>{(r.source_type || "SOURCE").toUpperCase()}</span>
        <span style={{ font: `700 8px ${mono}`, letterSpacing: ".12em", color: stanceColor, background: `${stanceColor}14`, border: `1px solid ${stanceColor}4d`, padding: "3px 7px", borderRadius: 99 }}>{stanceLabel}</span>
        {r.status === "verified" && <span style={{ font: `700 8px ${mono}`, letterSpacing: ".12em", color: "#7BE0B2", marginLeft: "auto" }}>MOD-VERIFIED</span>}
      </div>
      <a href={r.url} target="_blank" rel="noreferrer" style={{ font: `600 13px/1.4 'Hanken Grotesk',sans-serif`, color: "#F2F2F7", textDecoration: "none" }}>{r.title} ↗</a>
      <span style={{ font: `500 9px ${mono}`, letterSpacing: ".06em", color: "#5C5C6E" }}>
        {[r.publisher, r.source_published_at && `PUB ${String(r.source_published_at).slice(0, 10)}`, r.accessed_at && `ACCESSED ${String(r.accessed_at).slice(0, 10)}`, r.archive_url && "ARCHIVED ✓"].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

export function ChallengeReceiptPage() {
  const { id } = useParams();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getChallengeReceipt(id).then(setData).catch((e: any) => setError(e.response?.data?.error || e.message || "Receipt not found")).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}><div className="arena-pulse" style={{ width: 24, height: 24, border: "2px solid rgba(110,110,247,.3)", borderTopColor: "#6E6EF7", borderRadius: "50%" }} /></div>;
  if (error || !data) return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
      <div style={{ font: `400 28px ${serif}`, color: "#F2F2F7", marginBottom: 8 }}>Receipt unavailable</div>
      <div style={{ font: `400 13px ${mono}`, color: "#9B9BAB" }}>{error || "This receipt could not be loaded."}</div>
    </div>
  );

  const { challenge, response, recites, response_recites, fact_score, response_fact_score, timeline, audit_chain } = data;
  const status = challenge.status || "open";
  const cc = partyColor(challenge.challenger_party);
  const tc = partyColor(challenge.target_party);
  const chain = audit_chain || {};
  const chainOk = chain.status === "verified";
  const chainBadge = chain.status === "verified" ? { t: "CHAIN VERIFIED", c: "#34C384" } : chain.status === "partial" ? { t: "PARTIALLY VERIFIED", c: "#EFB643" } : chain.status === "failed" ? { t: "VERIFICATION FAILED", c: "#E5484D" } : { t: "NO CHAIN ENTRIES", c: "#9B9BAB" };
  const slug = challenge.public_receipt_slug || challenge.id;
  const claim = challenge.claim_text || challenge.challenge_text;
  const steps = [
    { label: "FILED", on: true },
    { label: "NOTICE", on: true },
    { label: "RECITES", on: (recites || []).length > 0 },
    { label: status === "responded" ? "RESPONSE" : status === "expired" ? "NO RESP" : status === "refused" ? "REFUSED" : "PENDING", on: status === "responded" },
  ];

  return (
    <div style={{ background: "#08080C", color: "#F2F2F7", fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
      <div style={{ padding: 40, background: "radial-gradient(900px 400px at 50% -20%, rgba(110,110,247,.1), transparent 65%)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 26, maxWidth: 1240, margin: "0 auto", alignItems: "start" }}>

          {/* RECEIPT DOCUMENT */}
          <div style={{ border: "1px solid rgba(255,255,255,.13)", borderRadius: 18, background: "linear-gradient(180deg,#101018,#0C0C13)", boxShadow: "0 30px 80px rgba(0,0,0,.5)", overflow: "hidden" }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "28px 34px 24px", borderBottom: "1px dashed rgba(255,255,255,.14)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `600 10px ${mono}`, letterSpacing: ".22em", color: "#9B9BAB" }}>PUBLIC CALLOUT RECEIPT</span>
                <span style={{ font: `400 34px/1.1 ${serif}`, color: "#F2F2F7" }}>{challenge.challenger_name} <em style={{ color: "#8F8FF9" }}>calls out</em> {challenge.target_name}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, font: `500 10px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E", flexWrap: "wrap" }}>
                  <span>NO. {String(slug).toUpperCase()}</span>
                  <span style={{ color: "#8F8FF9" }}>{(challenge.race_name || "").toUpperCase()}</span>
                  <span>TYPE · {(challenge.challenge_type || "FACT CHECK").toUpperCase().replace(/_/g, " ")}</span>
                </div>
              </div>
              <Stamp status={status} challenge={challenge} />
            </div>

            {/* claim */}
            <div style={{ padding: "28px 34px", display: "flex", flexDirection: "column", gap: 18, borderBottom: "1px solid rgba(255,255,255,.07)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".18em", color: "#5C5C6E" }}>THE CLAIM · FILED {fmtDateTime(challenge.created_at)}</span>
                <FactScore label="CLAIM FACT SCORE" score={fact_score} />
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: "none", width: 46, height: 46, borderRadius: "50%", background: cc.grad, border: `2px solid ${cc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 14px ${display}`, color: cc.soft }}>{initials(challenge.challenger_name)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{challenge.challenger_name}</span><span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".1em", color: cc.text }}>{(challenge.challenger_party || "").toUpperCase()}</span></div>
                  <div style={{ font: `italic 400 24px/1.4 ${serif}`, color: "#EDEDF3" }}>“{claim}”</div>
                </div>
              </div>
            </div>

            {/* recites */}
            {(recites || []).length > 0 && (
              <div style={{ padding: "24px 34px", display: "flex", flexDirection: "column", gap: 12, borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".18em", color: "#5C5C6E" }}>RECITES ON FILE · EVIDENCE REQUIRED BEFORE PUBLICATION</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {(recites || []).map((r: any) => <ReciteCard key={r.id} r={r} />)}
                </div>
              </div>
            )}

            {/* response OR no-response */}
            {response ? (
              <div style={{ padding: "28px 34px", display: "flex", flexDirection: "column", gap: 16, background: "linear-gradient(180deg,rgba(52,195,132,.045),transparent 70%)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".18em", color: "#34C384" }}>THE RESPONSE · POSTED {fmtDateTime(response.created_at)}</span>
                  <FactScore label="RESPONSE FACT SCORE" score={response_fact_score} />
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ flex: "none", width: 46, height: 46, borderRadius: "50%", background: tc.grad, border: `2px solid ${tc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 14px ${display}`, color: tc.soft }}>{initials(challenge.target_name)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{challenge.target_name}</span><span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".1em", color: tc.text }}>{(challenge.target_party || "").toUpperCase()}</span></div>
                    <div style={{ font: `400 15.5px/1.7 'Hanken Grotesk',sans-serif`, color: "#D6D6DE", maxWidth: 760 }}>{response.response_text}</div>
                    {(response_recites || []).length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{(response_recites || []).map((r: any) => <ReciteCard key={r.id} r={r} />)}</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "28px 34px", background: status === "expired" ? "linear-gradient(180deg,rgba(229,72,77,.05),transparent 70%)" : "transparent" }}>
                <div style={{ border: `1px solid ${status === "expired" ? "rgba(229,72,77,.3)" : "rgba(255,255,255,.1)"}`, background: status === "expired" ? "rgba(229,72,77,.05)" : "rgba(255,255,255,.02)", borderRadius: 12, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: status === "expired" ? "#E5484D" : "#EFB643" }}>
                    {status === "expired" ? "NO RESPONSE ON THE RECORD" : status === "refused" ? "RESPONSE REFUSED" : "AWAITING RESPONSE"}
                  </span>
                  <span style={{ font: `400 15px/1.5 'Hanken Grotesk',sans-serif`, color: "#D6D6DE" }}>
                    {status === "expired"
                      ? `${challenge.target_name} was served notice on ${fmtDate(challenge.created_at)} and did not respond before the deadline of ${fmtDate(challenge.response_deadline)}. The non-response is recorded here as a matter of public record.`
                      : status === "refused"
                        ? `${challenge.target_name} declined to respond${challenge.refusal_reason ? `: “${challenge.refusal_reason}”` : "."}`
                        : `${challenge.target_name} has until ${fmtDate(challenge.response_deadline)} to respond. The clock is public.`}
                  </span>
                </div>
              </div>
            )}

            {/* footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 34px", borderTop: "1px dashed rgba(255,255,255,.14)", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ font: `500 8.5px ${mono}`, letterSpacing: ".14em", color: "#5C5C6E" }}>PERMANENT PUBLIC URL</span>
                <span style={{ font: `500 10.5px ${mono}`, color: "#9B9BAB" }}>arena.vote/challenge/{slug}</span>
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <button onClick={() => { navigator.clipboard?.writeText(`${location.origin}/challenge/${slug}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
                  style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", background: "transparent", border: "1px solid rgba(255,255,255,.14)", padding: "9px 15px", borderRadius: 9 }}>
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
              </div>
            </div>
          </div>

          {/* RAIL */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* audit chain — hero */}
            <div style={{ border: `1px solid ${chainBadge.c}4d`, borderRadius: 16, background: `linear-gradient(180deg,${chainBadge.c}12,${chainBadge.c}04)`, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${chainBadge.c}2e` }}>
                <span style={{ font: `600 10px ${mono}`, letterSpacing: ".16em", color: chainOk ? "#7BE0B2" : chainBadge.c }}>◆ AUDIT CHAIN</span>
                <span style={{ font: `700 9px ${mono}`, letterSpacing: ".12em", color: chainBadge.c, background: `${chainBadge.c}1f`, border: `1px solid ${chainBadge.c}66`, padding: "3px 9px", borderRadius: 99, whiteSpace: "nowrap" }}>{chainBadge.t}</span>
              </div>
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {steps.map((st, i) => (
                    <div key={st.label} style={{ display: "contents" }}>
                      <div style={{ flex: 1, height: 26, border: `1px solid ${st.on ? "rgba(52,195,132,.4)" : "rgba(255,255,255,.12)"}`, borderRadius: 6, background: st.on ? "rgba(52,195,132,.1)" : "rgba(255,255,255,.02)", display: "flex", alignItems: "center", justifyContent: "center", font: `600 8px ${mono}`, color: st.on ? "#7BE0B2" : "#5C5C6E" }}>{st.label}</div>
                      {i < steps.length - 1 && <span style={{ color: "#34C384" }}>—</span>}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", font: `500 10px ${mono}`, color: "#9B9BAB" }}><span>ENTRIES CHECKED</span><span style={{ color: "#F2F2F7" }}>{chain.checked_entries ?? 0} / {chain.total_entries ?? chain.checked_entries ?? 0}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", font: `500 10px ${mono}`, color: "#9B9BAB" }}><span>LEGACY ENTRIES</span><span style={{ color: "#F2F2F7" }}>{chain.legacy_entries ?? 0}</span></div>
                {chain.latest_hash && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ font: `500 8.5px ${mono}`, letterSpacing: ".14em", color: "#5C5C6E" }}>LATEST HASH · SHA-256</span>
                    <span style={{ font: `500 9.5px/1.6 ${mono}`, color: chainOk ? "#7BE0B2" : "#9B9BAB", wordBreak: "break-all" }}>{chain.latest_hash}</span>
                  </div>
                )}
                <span style={{ font: `400 10.5px/1.55 'Hanken Grotesk',sans-serif`, color: "#9B9BAB" }}>Every event on this receipt is hash-chained to the one before it. Any edit after the fact breaks the chain — and shows here. Tamper-evident audit trail.</span>
              </div>
            </div>

            {/* deadline */}
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "rgba(255,255,255,.02)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: "#5C5C6E" }}>RESPONSE DEADLINE · {challenge.deadline_business_days || 3} BUSINESS DAYS</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ font: `600 26px ${display}`, color: "#F2F2F7" }}>{fmtDate(challenge.response_deadline)}</span>
                <span style={{ font: `700 9px ${mono}`, letterSpacing: ".12em", color: status === "responded" ? "#34C384" : status === "expired" ? "#E5484D" : "#EFB643", background: status === "responded" ? "rgba(52,195,132,.09)" : status === "expired" ? "rgba(229,72,77,.09)" : "rgba(239,182,67,.09)", border: `1px solid ${status === "responded" ? "rgba(52,195,132,.3)" : status === "expired" ? "rgba(229,72,77,.3)" : "rgba(239,182,67,.3)"}`, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>
                  {status === "responded" ? "MET" : status === "expired" ? "MISSED" : "OPEN"}
                </span>
              </div>
            </div>

            {/* timeline */}
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "rgba(255,255,255,.02)", overflow: "hidden" }}>
              <div style={{ padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,.08)", font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: "#5C5C6E" }}>AUDIT TIMELINE</div>
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
                {(timeline || []).length === 0 && <span style={{ font: `400 12px ${mono}`, color: "#5C5C6E" }}>No audit events.</span>}
                {(timeline || []).map((t: any, i: number) => {
                  const lastOne = i === (timeline || []).length - 1;
                  const dot = t.action?.includes("issue") ? "#EFB643" : t.action?.includes("respond") ? "#34C384" : t.action?.includes("expire") ? "#E5484D" : "#8F8FF9";
                  return (
                    <div key={`${t.action}-${i}`} style={{ display: "flex", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, marginTop: 3, boxShadow: `0 0 8px ${dot}80` }} />
                        {!lastOne && <span style={{ width: 1.5, flex: 1, background: "rgba(255,255,255,.1)" }} />}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: lastOne ? 0 : 16 }}>
                        <span style={{ font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{(t.action || "").replace(/[._]/g, " ").replace(/\b\w/g, (m: string) => m.toUpperCase())}</span>
                        <span style={{ font: `500 9px ${mono}`, letterSpacing: ".06em", color: "#5C5C6E" }}>{fmtDateTime(t.created_at)}{t.entry_hash ? ` · #${String(t.entry_hash).slice(0, 6)}` : ""}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
