"use client";

/**
 * TopicBackground — the "gimmicky" part.
 *
 * The LLM gives us an imageQuery describing the video's subject (e.g. "road trip",
 * "cooking", "basketball"). We feed that to LoremFlickr, a key-free service that
 * returns a real photo matching the keywords. A stable `lock` (derived from the
 * video id) keeps the same image from flickering on every render.
 *
 * A dark gradient sits on top so foreground text stays readable.
 */

function hashToLock(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100000;
  return h;
}

export default function TopicBackground({
  query,
  seed,
}: {
  query: string;
  seed: string;
}) {
  const tags = query.trim().split(/\s+/).slice(0, 3).join(",") || "abstract";
  const lock = hashToLock(seed || query || "x");
  const url = `https://loremflickr.com/1600/900/${encodeURIComponent(tags)}?lock=${lock}`;

  return (
    <div className="bg-layer" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="bg-overlay" />
    </div>
  );
}
