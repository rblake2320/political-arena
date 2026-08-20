import { useEffect, useState } from "react";
import { useAuth } from "../stores/auth";
import * as api from "../api";

const mono = "'IBM Plex Mono', ui-monospace, monospace";

type Queue = "candidates" | "press" | "recites" | "ads" | "rebuttals" | "corrections";

const QUEUES: { key: Queue; label: string; blurb: string }[] = [
  { key: "candidates", label: "Candidate claims", blurb: "Campaign profile registrations awaiting verification." },
  { key: "press", label: "Press credentials", blurb: "Press applications awaiting approval." },
  { key: "recites", label: "Recites", blurb: "Source citations awaiting verification." },
  { key: "ads", label: "Ads", blurb: "Submitted campaign ads awaiting review before they can run." },
  { key: "rebuttals", label: "Rebuttals", blurb: "Submitted rebuttals awaiting review — the response window is live, review promptly." },
  { key: "corrections", label: "Corrections", blurb: "Correction and appeal requests awaiting a ruling. A ruling needs a resolution note." },
];

function Btn({ onClick, disabled, tone = "neutral", children }: { onClick: () => void; disabled?: boolean; tone?: "ok" | "no" | "neutral"; children: React.ReactNode }) {
  const c = tone === "ok" ? "#34C384" : tone === "no" ? "#E5636A" : "#9B9BAB";
  return (
    <button onClick={onClick} disabled={disabled} style={{ cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, font: `600 11px 'Hanken Grotesk',sans-serif`, color: c, background: `${c}12`, border: `1px solid ${c}44`, padding: "7px 13px", borderRadius: 8 }}>{children}</button>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <div style={{ font: `500 10px ${mono}`, color: "#5C5C6E", letterSpacing: ".06em" }}>{children}</div>;
}

export function ModerationPage() {
  const { user } = useAuth();
  const canModerate = Boolean(user && ["moderator", "admin", "super_admin"].includes(user.role));
  const [queue, setQueue] = useState<Queue>("candidates");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const fetcher =
      queue === "candidates" ? api.getPendingCandidates()
        : queue === "press" ? api.getPendingPress()
          : queue === "recites" ? api.getPendingRecites({ status: "pending" })
            : queue === "corrections" ? api.getPendingCorrections("open")
              : api.getAdModerationQueue();
    fetcher
      .then((d: any) => {
        if (queue === "ads") return setItems(d?.ads || []);
        if (queue === "rebuttals") return setItems(d?.rebuttals || []);
        setItems(d?.candidates || d?.applications || d?.credentials || d?.press || d?.recites || d?.corrections || (Array.isArray(d) ? d : []));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (canModerate) load(); }, [queue, canModerate]);

  const act = async (id: string, fn: () => Promise<any>) => {
    setBusy(id);
    setError(null);
    try { await fn(); setItems(prev => prev.filter(x => x.id !== id)); }
    catch (e: any) { setError(e?.message || "Action failed"); load(); }
    finally { setBusy(null); }
  };

  const noteFor = (id: string) => (notes[id] || "").trim();

  if (!canModerate) {
    return <div style={{ maxWidth: 520, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
      <div style={{ font: `400 26px 'Instrument Serif',serif`, color: "#F2F2F7", marginBottom: 8 }}>Moderation</div>
      <div style={{ font: `400 13px ${mono}`, color: "#9B9BAB" }}>Only moderators and admins can clear applications.</div>
    </div>;
  }

  return (
    <div style={{ background: "#08080C", color: "#F2F2F7", minHeight: "60vh" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "36px 24px 56px" }}>
        <div style={{ font: `400 34px 'Instrument Serif',serif`, color: "#F2F2F7" }}>Applications to clear</div>
        <div style={{ font: `400 13px/1.6 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", marginTop: 6, maxWidth: 640 }}>
          Every inbound application lands here so nothing goes stale. Clear each one — approve or return it — and the decision is recorded on the audit trail.
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 22, borderBottom: "1px solid rgba(255,255,255,.08)", overflowX: "auto" }}>
          {QUEUES.map(q => (
            <button key={q.key} onClick={() => setQueue(q.key)} style={{ flexShrink: 0, cursor: "pointer", background: "none", border: "none", font: `${queue === q.key ? 600 : 500} 13px 'Hanken Grotesk',sans-serif`, color: queue === q.key ? "#F2F2F7" : "#9B9BAB", padding: "12px 14px 11px", borderBottom: queue === q.key ? "2px solid #6E6EF7" : "2px solid transparent", whiteSpace: "nowrap" }}>{q.label}</button>
          ))}
        </div>
        <div style={{ font: `500 10px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E", margin: "14px 0" }}>{QUEUES.find(q => q.key === queue)?.blurb.toUpperCase()}</div>

        {error && (
          <div style={{ border: "1px solid rgba(229,99,106,.4)", borderRadius: 10, background: "rgba(229,99,106,.08)", padding: "10px 14px", marginBottom: 12, font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#E5636A" }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center" }}><span className="arena-pulse" style={{ display: "inline-block", width: 20, height: 20, border: "2px solid rgba(110,110,247,.3)", borderTopColor: "#6E6EF7", borderRadius: "50%" }} /></div>
        ) : items.length === 0 ? (
          <div style={{ border: "1px solid rgba(255,255,255,.09)", borderRadius: 12, background: "#0C0C13", padding: 28, textAlign: "center" }}>
            <div style={{ font: `500 14px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>Queue clear</div>
            <div style={{ font: `400 12px ${mono}`, color: "#5C5C6E", marginTop: 4 }}>Nothing pending — no {queue} waiting on review.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map(it => (
              <div key={it.id} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, background: "#0C0C13", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                {queue === "candidates" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.name}</span> <span style={{ font: `500 10px ${mono}`, color: it.party?.toLowerCase().startsWith("d") ? "#4D8AF0" : it.party?.toLowerCase().startsWith("r") ? "#E5636A" : "#9B9BAB", letterSpacing: ".1em" }}>{(it.party || "").toUpperCase()}</span></div>
                  <Meta>{[it.race_name || it.race_id, it.race_state, it.created_at && `FILED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.verifyCandidate(it.id, "verify"))}>Verify</Btn>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.verifyCandidate(it.id, "reject"))}>Reject</Btn>
                  </div>
                </>}
                {queue === "press" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.outlet_name || it.outlet}</span> <span style={{ font: `500 10px ${mono}`, color: "#9B9BAB", letterSpacing: ".1em" }}>{(it.outlet_type || "").toUpperCase()}</span></div>
                  {it.proof_url && <a href={it.proof_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>{it.proof_url} ↗</a>}
                  <Meta>{it.created_at && `APPLIED ${String(it.created_at).slice(0, 10)}`}</Meta>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewPress(it.id, "approved"))}>Approve</Btn>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewPress(it.id, "rejected"))}>Reject</Btn>
                  </div>
                </>}
                {queue === "recites" && <>
                  <a href={it.url} target="_blank" rel="noreferrer" style={{ font: `600 14px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7", textDecoration: "none" }}>{it.title} ↗</a>
                  <Meta>{[it.source_type, it.stance, it.publisher].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.quote && <div style={{ font: `italic 400 13px 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>“{it.quote}”</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewRecite(it.id, "verified"))}>Verify</Btn>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewRecite(it.id, "rejected"))}>Reject</Btn>
                  </div>
                </>}
                {queue === "ads" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.title}</span> <span style={{ font: `500 10px ${mono}`, color: "#9B9BAB", letterSpacing: ".1em" }}>{(it.media_type || "").toUpperCase()}</span></div>
                  <Meta>{[it.candidate_name, it.candidate_party, it.race_name, it.created_at && `SUBMITTED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.ad_content_text && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{it.ad_content_text}</div>}
                  {it.media_url && <a href={it.media_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>Open media ↗</a>}
                  {it.disclaimer_text && <Meta>DISCLAIMER: {it.disclaimer_text}</Meta>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Rejection reason (required to reject)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewAd(it.id, "approve"))}>Approve</Btn>
                    <Btn tone="no" disabled={busy === it.id || !noteFor(it.id)} onClick={() => act(it.id, () => api.reviewAd(it.id, "reject", noteFor(it.id)))}>Reject</Btn>
                  </div>
                </>}
                {queue === "rebuttals" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>Rebuttal to “{it.parent_ad_title}”</span></div>
                  <Meta>{[it.candidate_name, it.candidate_party, it.race_name, it.created_at && `SUBMITTED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.response_text && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>{it.response_text}</div>}
                  {it.media_url && <a href={it.media_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>Open media ↗</a>}
                  {it.disclaimer_text && <Meta>DISCLAIMER: {it.disclaimer_text}</Meta>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Rejection reason (required to reject)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewRebuttal(it.id, "approve"))}>Approve &amp; run</Btn>
                    <Btn tone="no" disabled={busy === it.id || !noteFor(it.id)} onClick={() => act(it.id, () => api.reviewRebuttal(it.id, "reject", noteFor(it.id)))}>Reject</Btn>
                  </div>
                </>}
                {queue === "corrections" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{(it.reason || "correction").replace(/_/g, " ")} — {it.content_type}</span></div>
                  <Meta>{[it.candidate_name, it.race_name, it.requester_name && `FROM ${it.requester_name}`, it.created_at && `FILED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.requested_change && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>{it.requested_change}</div>}
                  {it.evidence_url && <a href={it.evidence_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>{it.evidence_url} ↗</a>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Resolution note (required, min 5 chars, becomes part of the record)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn tone="ok" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewCorrection(it.id, "upheld", noteFor(it.id), noteFor(it.id)))}>Uphold</Btn>
                    <Btn disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewCorrection(it.id, "revised", noteFor(it.id), noteFor(it.id)))}>Revised</Btn>
                    <Btn tone="no" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewCorrection(it.id, "rejected", noteFor(it.id)))}>Reject</Btn>
                  </div>
                </>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
