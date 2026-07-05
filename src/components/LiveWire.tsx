import { useEffect, useState } from "react";

const mono = "'IBM Plex Mono', ui-monospace, monospace";

interface FeedEvent {
  event_type: "issued" | "responded" | "refused" | "expired";
  event_at: string;
  challenge_id: string;
  public_receipt_slug: string | null;
  race_label?: string;
  race_state?: string;
  race_office?: string;
  race_district?: string;
  challenger_name?: string;
  target_name?: string;
}

const EVENT: Record<FeedEvent["event_type"], { verb: string; color: string }> = {
  issued: { verb: "CALLED OUT", color: "#EFB643" },
  responded: { verb: "RESPONDED", color: "#34C384" },
  refused: { verb: "REFUSED", color: "#E5636A" },
  expired: { verb: "NO RESPONSE", color: "#E5484D" },
};

function timeET(iso: string): string {
  const d = new Date((iso || "").replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function raceTag(e: FeedEvent): string {
  const st = e.race_state || "";
  const off = (e.race_office || "").toUpperCase().slice(0, 3);
  return [st, off].filter(Boolean).join("-") || (e.race_label || "");
}

function daysToElection(): number {
  return Math.max(0, Math.ceil((new Date("2026-11-03T00:00:00Z").getTime() - Date.now()) / 86_400_000));
}

function Item({ e }: { e: FeedEvent }) {
  const cfg = EVENT[e.event_type];
  const actor = e.event_type === "issued" ? e.challenger_name : e.target_name;
  return (
    <span style={{ display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ color: "#5C5C6E" }}>{[timeET(e.event_at), raceTag(e)].filter(Boolean).join(" · ")}</span>
      <span style={{ color: "#5C5C6E" }}>—</span>
      <span style={{ color: cfg.color }}>{(actor || "").toUpperCase()} {cfg.verb}</span>
      {e.event_type === "issued" && e.target_name && <span style={{ color: "#9B9BAB" }}>{e.target_name.toUpperCase()}</span>}
    </span>
  );
}

export function LiveWire() {
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/feed/live?limit=20")
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (alive) setEvents((d?.data?.events ?? []) as FeedEvent[]); })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const electionItem = (
    <span style={{ color: "#F2F2F7", whiteSpace: "nowrap" }}>
      ELECTION DAY NOV 3, 2026 — <span style={{ color: "#8F8FF9" }}>{daysToElection()} DAYS</span>
    </span>
  );

  const strip = (
    <div style={{ display: "flex", gap: 44, padding: "9px 22px", font: `500 10.5px ${mono}`, letterSpacing: ".06em", color: "#9B9BAB" }}>
      {events.map((e, i) => <Item key={`${e.challenge_id}-${e.event_type}-${i}`} e={e} />)}
      {electionItem}
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid rgba(255,255,255,.08)", background: "#0A0A10", overflow: "hidden" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "0 18px", background: "#101018", borderRight: "1px solid rgba(255,255,255,.08)" }}>
        <span className="arena-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#E5484D" }} />
        <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#F2F2F7" }}>LIVE WIRE</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div className="arena-marquee" style={{ display: "flex", gap: 0, whiteSpace: "nowrap" }}>
          {strip}{strip}
        </div>
      </div>
    </div>
  );
}
