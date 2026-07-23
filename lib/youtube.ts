/**
 * youtube.ts — loaders for a RAG pipeline.
 *
 * Two things we pull from YouTube, both key-free and serverless-friendly:
 *   1. fetchTranscript() — the caption track, WITH timestamps (for the timeline).
 *   2. fetchMeta()       — title + thumbnail via the public oEmbed endpoint
 *                          (used for the library cards, ChatTube-style).
 */

import { YoutubeTranscript } from "youtube-transcript";

/**
 * Accept any common YouTube URL form (or a raw 11-char video ID) and return the
 * canonical video ID. Returns null if we can't recognize it.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1, 12);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) return last;
  } catch {
    return null;
  }
  return null;
}

/** One caption line, normalized so start/duration are always in SECONDS. */
export interface Segment {
  text: string;
  start: number; // seconds from video start
  duration: number; // seconds
}

export interface Transcript {
  videoId: string;
  text: string; // full transcript flattened to one string
  segments: Segment[]; // timestamped lines
  durationSeconds: number;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;#39;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch the transcript and normalize timestamps.
 *
 * The youtube-transcript library returns offset/duration in MILLISECONDS for
 * some caption formats and SECONDS for others. A single caption line is never
 * 100+ seconds long, so if durations look that big we know it's milliseconds.
 */
export async function fetchTranscript(urlOrId: string): Promise<Transcript> {
  const videoId = parseVideoId(urlOrId);
  if (!videoId) throw new Error("Could not parse a YouTube video ID from that input.");

  let raw;
  try {
    raw = await YoutubeTranscript.fetchTranscript(videoId);
  } catch {
    throw new Error("No transcript found for this video. It may have captions disabled.");
  }
  if (!raw || raw.length === 0) throw new Error("This video has no transcript available.");

  const maxDur = Math.max(...raw.map((r) => r.duration || 0));
  const scale = maxDur > 100 ? 1 / 1000 : 1; // convert ms -> s when needed

  const segments: Segment[] = raw.map((r) => ({
    text: decodeEntities(r.text),
    start: (r.offset || 0) * scale,
    duration: (r.duration || 0) * scale,
  }));

  const last = segments[segments.length - 1];
  const durationSeconds = Math.round(last.start + last.duration);
  const text = decodeEntities(segments.map((s) => s.text).join(" "));

  return { videoId, text, segments, durationSeconds };
}

export interface VideoMeta {
  title: string;
  author: string;
  thumbnail: string;
}

/**
 * Fetch title/author/thumbnail from YouTube's public oEmbed endpoint (no key).
 * Falls back to a generated thumbnail URL if oEmbed is unavailable.
 */
export async function fetchMeta(videoId: string): Promise<VideoMeta> {
  const fallback: VideoMeta = {
    title: "YouTube video",
    author: "",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { cache: "no-store" }
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      title: data.title || fallback.title,
      author: data.author_name || "",
      thumbnail: data.thumbnail_url || fallback.thumbnail,
    };
  } catch {
    return fallback;
  }
}

/** Format seconds as m:ss or h:mm:ss. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}
