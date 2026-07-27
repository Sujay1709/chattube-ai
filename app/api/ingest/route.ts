/**
 * POST /api/ingest
 * Body: { url: string }
 * Returns: { videoId, meta, durationSeconds, topics, imageQuery, chapters, chunks }
 *
 * Pipeline on ingest:
 *   transcript (+timestamps) -> oEmbed meta -> chunk+embed (for chat)
 *                                            -> LLM analysis (topics + chapters)
 * Everything is returned to the browser, which holds it in state. The serverless
 * functions stay stateless — no database.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchTranscript, fetchMeta } from "@/lib/youtube";
import { chunkText, type Chunk } from "@/lib/rag";
import { analyzeTranscript } from "@/lib/analyze";
import { embed } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const maxDuration = 60;

// Ingest is the expensive call (embeds every chunk + one LLM analysis), so keep
// its per-IP allowance tight, and cap how many chunks a single video can cost.
const INGEST_LIMIT = 8; // requests
const INGEST_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes
const MAX_CHUNKS = 150; // bound cost for very long videos

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`ingest:${ip}`, INGEST_LIMIT, INGEST_WINDOW_MS);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many videos added recently. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Please provide a YouTube URL." }, { status: 400 });
    }

    console.log("[ingest] 1/4 fetching transcript for:", url);
    const { videoId, text, segments, durationSeconds } = await fetchTranscript(url);
    console.log(`[ingest] transcript OK — ${segments.length} segments, ${durationSeconds}s`);

    console.log("[ingest] 2/4 fetching metadata…");
    const meta = await fetchMeta(videoId);
    console.log("[ingest] metadata OK —", meta.title);

    let pieces = chunkText(text);
    if (pieces.length === 0) {
      return NextResponse.json({ error: "Transcript was empty after processing." }, { status: 422 });
    }
    if (pieces.length > MAX_CHUNKS) {
      console.log(`[ingest] capping ${pieces.length} chunks to ${MAX_CHUNKS}`);
      pieces = pieces.slice(0, MAX_CHUNKS);
    }
    console.log(`[ingest] 3/4 embedding ${pieces.length} chunks + analyzing…`);

    const [embeddings, analysis] = await Promise.all([
      embed(pieces),
      analyzeTranscript(segments, durationSeconds, meta.title),
    ]);
    console.log("[ingest] 4/4 embeddings + analysis OK");

    const chunks: Chunk[] = pieces.map((t, i) => ({ id: i, text: t, embedding: embeddings[i] }));

    return NextResponse.json({
      videoId,
      meta,
      durationSeconds,
      topics: analysis.topics,
      imageQuery: analysis.imageQuery,
      chapters: analysis.chapters,
      chunks,
    });
  } catch (err) {
    // Log the FULL error server-side so it shows up in the terminal.
    console.error("[ingest] FAILED:", err);
    const message = err instanceof Error ? err.message : "Something went wrong while ingesting.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
