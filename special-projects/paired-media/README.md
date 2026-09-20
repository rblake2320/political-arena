# PairedMedia — side-by-side "claim + answer" media unit

A portable React component that shows **two pieces of media side by side as one unit**, so a viewer always sees both together — an original and its response, a claim and an answer, a before and an after.

It came out of the Arena political platform's ad + rebuttal "equal-time" layout, generalized so it can be dropped into **any project**. Each side can be **video, audio, image, a note (text), or an embed (YouTube / Vimeo)** — mix and match freely (e.g. a video on the left, a note on the right).

## Why it's reusable
- **Zero dependencies.** Pure React + inline styles. No Tailwind, no icon library, no CSS import. Copy `PairedMedia.tsx` into any React 18/19 project and use it.
- **Auto-detects media type** from the URL (YouTube/Vimeo → embed; `.mp4/.webm` → video; `.mp3` → audio; `.jpg/.png` → image) — or set `kind` explicitly.
- **Responsive.** Panels sit side by side on desktop and stack vertically on narrow screens (configurable `breakpoint`).
- **Native players.** Video/audio use the browser's native `<video controls>` / `<audio controls>` (real play button, timeline, volume, fullscreen); embeds use the provider iframe.

## Drop-in
1. Copy `PairedMedia.tsx` into your project (e.g. `src/components/`).
2. Import and render:

```tsx
import { PairedMedia } from "./PairedMedia";

<PairedMedia
  header="Served as a paired unit — claim + answer"
  serial="AD-2026-FL-0193"
  dividerLabel="Equal time"
  left={{
    title: "Original ad",
    byline: "Mitchell campaign",
    badge: "Verified",
    accent: "#4D8AF0",                         // blue accent
    media: { kind: "video", src: "https://cdn.example.com/ad.mp4" },
    caption: "Paid for by Mitchell for Florida 2026",
  }}
  right={{
    title: "Response",
    byline: "Rivera campaign",
    badge: "Slot 1 of 3",
    accent: "#E5636A",                         // red accent
    media: { kind: "note", text: "Here are the facts. My company created 2,000 local jobs…" },
  }}
/>
```

## Props

`PairedMedia`
| prop | type | notes |
|---|---|---|
| `header` | string | top strip label (uppercased) |
| `serial` | string | optional mono serial at the right of the header |
| `left` / `right` | `PanelSpec` | the two panels (required) |
| `dividerLabel` | string | small label over the seam (e.g. "Equal time") |
| `breakpoint` | number | px; panels stack below this width (default 760) |
| `theme` | `"dark" \| "light"` | default `"dark"` |

`PanelSpec`
| field | type | notes |
|---|---|---|
| `title` | string | e.g. "Original ad" |
| `byline` | string | e.g. "Mitchell campaign · DEM" (rendered mono, uppercased, in the accent color) |
| `badge` | string | e.g. "Verified" (pill in the accent color) |
| `accent` | string | hex color for the panel's identity (border tint + badge) |
| `media` | `MediaSpec` | the media to show |
| `caption` | string | disclaimer / footnote under the media |

`MediaSpec`
| field | type | notes |
|---|---|---|
| `kind` | `"video" \| "audio" \| "image" \| "note" \| "text" \| "embed" \| "link"` | omit to auto-detect from `src` |
| `src` | string | url for video / audio / image / embed / link |
| `text` | string | content for `note` / `text` |
| `poster` | string | optional video poster image |
| `mime` | string | optional explicit mime |

## Mixing media
The two sides are independent — any kind on either side. Examples:
- **Video vs video** — an ad and its rebuttal.
- **Image vs note** — a chart and a written response.
- **Audio vs audio** — a radio spot and a reply.
- **Embed vs video** — a YouTube TV ad on the left, an uploaded response on the right.

## See `example.tsx`
A gallery rendering every media kind and a few mixed pairs.

## License / origin
Extracted from the Arena / "The Public Record" project as a reusable pattern. Free to adapt.
