/**
 * analyze.ts — turn a timestamped transcript into two structured artifacts:
 *
 *   • topics   — a few keywords describing the video's subject. These drive the
 *                "gimmicky" background imagery (e.g. cars + travel -> road photos).
 *   • chapters — a timeline of what topic is discussed at what timestamp, so the
 *                UI can render a scrubber synced to the video.
 *
 * Both come from a single LLM call over a compact, time-bucketed digest of the
 * transcript (so we don't blow the context window on long videos).
 */

import { chatJSON, type ChatMessage } from "./llm";
import type { Segment } from "./youtube";

export interface Chapter {
  start: number; // seconds
  title: string; // short topic label
  summary: string; // one-sentence description
}

export interface Analysis {
  topics: string[]; // 2-4 keywords for background imagery
  imageQuery: string; // best single search phrase for a background photo
  chapters: Chapter[];
}

/**
 * Compress segments into ~20 evenly spaced time buckets like:
 *   [0:00] words words ...
 *   [1:30] words words ...
 * This gives the model enough temporal signal to place chapter boundaries.
 */
function buildDigest(segments: Segment[], durationSeconds: number): string {
  if (segments.length === 0) return "";
  const bucketCount = Math.min(24, Math.max(6, Math.round(durationSeconds / 45)));
  const bucketLen = durationSeconds / bucketCount;
  const buckets: string[][] = Array.from({ length: bucketCount }, () => []);

  for (const seg of segments) {
    const idx = Math.min(bucketCount - 1, Math.floor(seg.start / bucketLen));
    buckets[idx].push(seg.text);
  }

  return buckets
    .map((words, i) => {
      const t = Math.round(i * bucketLen);
      const mm = Math.floor(t / 60);
      const ss = String(t % 60).padStart(2, "0");
      const text = words.join(" ").slice(0, 400); // cap each bucket
      return `[${mm}:${ss}] ${text}`;
    })
    .filter((line) => line.length > 8)
    .join("\n");
}

const SYSTEM = `You analyze a YouTube video transcript that includes rough
timestamps. Return STRICT JSON with this exact shape:
{
  "topics": string[],        // 2-4 short keywords describing the subject (e.g. ["cars","road trip","scenery"])
  "imageQuery": string,      // 1-3 words, the best single search phrase for a representative background photo
  "chapters": [              // 3-8 items, in chronological order, covering the whole video
    { "start": number, "title": string, "summary": string }
  ]
}
Rules:
- "start" is the chapter's start time in SECONDS (integer), first chapter starts at 0.
- "title" is 2-5 words. "summary" is one short sentence.
- Keywords should be concrete and visual so they make good image search terms.
- Output ONLY the JSON object.`;

export async function analyzeTranscript(
  segments: Segment[],
  durationSeconds: number,
  videoTitle: string
): Promise<Analysis> {
  const digest = buildDigest(segments, durationSeconds);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Video title: ${videoTitle}\nVideo length: ${durationSeconds} seconds\n\nTime-bucketed transcript:\n${digest}`,
    },
  ];

  const result = await chatJSON<Analysis>(messages);

  // Defensive normalization — never trust model output shape blindly.
  const chapters = (result.chapters || [])
    .filter((c) => typeof c.start === "number" && c.title)
    .map((c) => ({
      start: Math.max(0, Math.round(c.start)),
      title: String(c.title).slice(0, 60),
      summary: String(c.summary || "").slice(0, 200),
    }))
    .sort((a, b) => a.start - b.start);

  return {
    topics: (result.topics || []).slice(0, 4).map((t) => String(t)),
    imageQuery: (result.imageQuery || result.topics?.[0] || videoTitle || "abstract").toString(),
    chapters: chapters.length > 0 ? chapters : [{ start: 0, title: videoTitle || "Overview", summary: "" }],
  };
}
