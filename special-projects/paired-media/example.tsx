/**
 * PairedMedia — example gallery. Drop into a React app and render <PairedMediaExamples />.
 * Shows each media kind and a few mixed pairs.
 */
import { PairedMedia } from "./PairedMedia";

export function PairedMediaExamples() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto", padding: 24, background: "#08080C" }}>

      {/* video vs note */}
      <PairedMedia
        header="Served as a paired unit — claim + answer"
        serial="AD-DEMO-0001"
        dividerLabel="Equal time"
        left={{
          title: "Original ad", byline: "Campaign A", badge: "Verified", accent: "#4D8AF0",
          media: { kind: "video", src: "https://upload.wikimedia.org/wikipedia/commons/5/5f/Daisy_%281964%29.webm" },
          caption: "Sample · public-domain historical ad",
        }}
        right={{
          title: "Response", byline: "Campaign B", badge: "Slot 1 of 3", accent: "#E5636A",
          media: { kind: "note", text: "Here are the facts. This response is written, not filmed — the paired unit still shows both sides together." },
        }}
      />

      {/* image vs audio */}
      <PairedMedia
        header="Chart + spoken response"
        dividerLabel="Both together"
        left={{
          title: "The chart", accent: "#EFB643",
          media: { kind: "image", src: "https://placehold.co/800x450/0C0C13/EFB643.png?text=Data+Chart" },
        }}
        right={{
          title: "Audio reply", byline: "Radio spot", accent: "#34C384",
          media: { kind: "audio", src: "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg" },
        }}
      />

      {/* embed vs video (mixed sources) */}
      <PairedMedia
        header="TV ad (embed) + uploaded response (file)"
        left={{
          title: "TV ad", byline: "Linked from YouTube", accent: "#8F8FF9",
          media: { src: "https://www.youtube.com/watch?v=8J2hs6tuuCA" }, // auto-detected as embed
          caption: "Source context — links play in the provider player",
        }}
        right={{
          title: "Uploaded reply", byline: "Direct file", accent: "#4D8AF0",
          media: { kind: "video", src: "https://upload.wikimedia.org/wikipedia/commons/5/5f/Daisy_%281964%29.webm" },
        }}
      />

    </div>
  );
}

export default PairedMediaExamples;
