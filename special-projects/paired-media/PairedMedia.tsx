/**
 * PairedMedia — a portable "side-by-side paired media" React component.
 *
 * Origin: the Arena "claim + answer / equal-time" ad+rebuttal unit — two pieces of
 * media shown side by side as one unit, so a viewer always sees both together.
 *
 * Generalized here to be reusable in ANY project: each side can be video, audio,
 * image, a note (text), or an embed (YouTube/Vimeo). No external dependencies
 * (no Tailwind, no icon lib) — pure React + inline styles. Copy this one file in.
 *
 * Usage:
 *   <PairedMedia
 *     header="Served as a paired unit — claim + answer"
 *     serial="AD-2026-FL-0193"
 *     dividerLabel="EQUAL TIME"
 *     left={{
 *       title: "Original", byline: "Mitchell campaign", badge: "VERIFIED", accent: "#4D8AF0",
 *       media: { kind: "video", src: "https://.../ad.mp4" },
 *       caption: "Paid for by Mitchell for Florida 2026",
 *     }}
 *     right={{
 *       title: "Response", byline: "Rivera campaign", badge: "SLOT 1 OF 3", accent: "#E5636A",
 *       media: { kind: "note", text: "Here are the facts…" },
 *     }}
 *   />
 */
import { useEffect, useState } from "react";

export type MediaKind = "video" | "audio" | "image" | "note" | "text" | "embed" | "link";

export interface MediaSpec {
  kind?: MediaKind;   // omit to auto-detect from src (youtube/vimeo → embed; ext → video/audio/image)
  src?: string;       // url for video / audio / image / embed / link
  text?: string;      // content for note / text
  poster?: string;    // optional video poster image
  mime?: string;      // optional explicit mime for <video>/<audio>
}

export interface PanelSpec {
  title?: string;     // e.g. "Original ad" / "Rebuttal"
  byline?: string;    // e.g. "Mitchell campaign · DEM"
  badge?: string;     // e.g. "VERIFIED" / "SLOT 1 OF 3"
  accent?: string;    // panel accent color (border tint + badge)
  media: MediaSpec;
  caption?: string;   // disclaimer / footnote under the media
}

export interface PairedMediaProps {
  header?: string;        // top strip label
  serial?: string;        // optional mono serial shown at right of the header
  left: PanelSpec;
  right: PanelSpec;
  dividerLabel?: string;  // small label over the seam between panels (e.g. "EQUAL TIME")
  breakpoint?: number;    // px; panels stack vertically below this width (default 760)
  theme?: "dark" | "light";
}

// ── helpers ─────────────────────────────────────────────────────────────
function useNarrow(bp = 760): boolean {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < bp);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return narrow;
}
const ytId = (u = "") => (u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1];
const vimeoId = (u = "") => (u.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1];
const extOf = (u = "") => (u.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
const VID = new Set(["mp4", "m4v", "mov", "webm", "ogv", "ogg", "3gp"]);
const AUD = new Set(["mp3", "m4a", "aac", "wav", "flac", "oga", "weba"]);
const IMG = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);
function resolveKind(m: MediaSpec): MediaKind {
  if (m.kind && m.kind !== undefined) return m.kind;
  if (m.text) return "note";
  const u = m.src || "";
  if (ytId(u) || vimeoId(u)) return "embed";
  const e = extOf(u);
  if (VID.has(e)) return "video";
  if (AUD.has(e)) return "audio";
  if (IMG.has(e)) return "image";
  return u ? "link" : "note";
}

// ── media slot ──────────────────────────────────────────────────────────
function MediaSlot({ media, dark }: { media: MediaSpec; dark: boolean }) {
  const kind = resolveKind(media);
  const panel = dark ? "#08080C" : "#0d0d12";
  const border = "1px solid rgba(255,255,255,.1)";
  const box: React.CSSProperties = { borderRadius: 11, overflow: "hidden", border, background: "#000" };

  if (kind === "embed") {
    const yt = ytId(media.src), vm = vimeoId(media.src);
    const src = yt ? `https://www.youtube-nocookie.com/embed/${yt}` : vm ? `https://player.vimeo.com/video/${vm}` : media.src;
    return (
      <div style={{ ...box, aspectRatio: "16 / 9" }}>
        <iframe src={src} title="embedded media" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ width: "100%", height: "100%", border: 0 }} />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div style={{ ...box, aspectRatio: "16 / 9" }}>
        <video src={media.src} poster={media.poster} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div style={{ background: panel, border, borderRadius: 11, padding: 14 }}>
        <audio src={media.src} controls preload="metadata" style={{ width: "100%" }} />
      </div>
    );
  }
  if (kind === "image") {
    return (
      <div style={{ ...box, aspectRatio: "16 / 9", background: panel }}>
        <img src={media.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    );
  }
  if (kind === "note" || kind === "text") {
    return (
      <div style={{ background: panel, border, borderRadius: 11, padding: "16px 18px" }}>
        <p style={{ margin: 0, font: "400 15px/1.6 ui-serif, Georgia, serif", color: dark ? "#EDEDF3" : "#e8e8ef", whiteSpace: "pre-wrap" }}>{media.text}</p>
      </div>
    );
  }
  return (
    <a href={media.src} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, background: panel, border, borderRadius: 11, padding: "14px 16px", color: "#8F8FF9", textDecoration: "none", font: "500 13px system-ui" }}>
      ↗ {media.src}
    </a>
  );
}

// ── panel ───────────────────────────────────────────────────────────────
function Panel({ spec, dark }: { spec: PanelSpec; dark: boolean }) {
  const accent = spec.accent || "#6E6EF7";
  const mono = "ui-monospace, 'IBM Plex Mono', monospace";
  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      {(spec.title || spec.byline || spec.badge) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            {spec.title && <span style={{ font: "600 13px system-ui", color: dark ? "#F2F2F7" : "#f2f2f7" }}>{spec.title}</span>}
            {spec.byline && <span style={{ font: `500 9px ${mono}`, letterSpacing: ".1em", color: accent }}>{spec.byline.toUpperCase()}</span>}
          </div>
          {spec.badge && (
            <span style={{ marginLeft: "auto", font: `700 8.5px ${mono}`, letterSpacing: ".12em", color: accent, background: `${accent}1f`, border: `1px solid ${accent}55`, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>{spec.badge}</span>
          )}
        </div>
      )}
      <MediaSlot media={spec.media} dark={dark} />
      {spec.caption && <span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".08em", color: "#9B9BAB" }}>{spec.caption}</span>}
    </div>
  );
}

// ── main ────────────────────────────────────────────────────────────────
export function PairedMedia({ header, serial, left, right, dividerLabel, breakpoint = 760, theme = "dark" }: PairedMediaProps) {
  const narrow = useNarrow(breakpoint);
  const dark = theme === "dark";
  const mono = "ui-monospace, 'IBM Plex Mono', monospace";
  const bg = dark ? "#0C0C13" : "#14141b";
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: bg, overflow: "hidden", color: "#F2F2F7", fontFamily: "system-ui, sans-serif" }}>
      {(header || serial) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 20px", borderBottom: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.015)" }}>
          {header && <span style={{ font: `600 10px ${mono}`, letterSpacing: ".12em", color: "#9B9BAB" }}>{header.toUpperCase()}</span>}
          {serial && <span style={{ font: `600 10px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E" }}>{serial}</span>}
        </div>
      )}
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr" }}>
        <div style={{ borderRight: narrow ? "none" : "1px solid rgba(255,255,255,.08)", borderBottom: narrow ? "1px solid rgba(255,255,255,.08)" : "none" }}>
          <Panel spec={left} dark={dark} />
        </div>
        <div><Panel spec={right} dark={dark} /></div>
        {dividerLabel && !narrow && (
          <span style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", font: `700 8px ${mono}`, letterSpacing: ".14em", color: "#8F8FF9", background: bg, border: "1px solid rgba(110,110,247,.4)", padding: "3px 9px", borderRadius: 99 }}>{dividerLabel.toUpperCase()}</span>
        )}
      </div>
    </div>
  );
}

export default PairedMedia;
