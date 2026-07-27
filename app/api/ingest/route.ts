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
import { toUserMessage } from "@/lib/errors";

export const maxDuration = 60;

// Ingest is the expensive call (embeds every chunk + one LLM analysis), so keep
// its per-IP allowance tight, and cap how many chunks a single video can cost.
const INGEST_LIMIT = 8; // requests
const INGEST_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes
const MAX_CHUNKS = 100; // bound cost, payload size, and latency for long videos

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

    // Embeddings are required for chat. Analysis (topics/timeline) is a
    // nice-to-have — if it fails OR takes too long, don't let it break or stall
    // the whole ingest; fall back to a minimal analysis so chat still works.
    const analysisFallback = {
      topics: [] as string[],
      imageQuery: meta.title || "video",
      chapters: [{ start: 0, title: "Overview", summary: "" }],
    };
    const analysisWithTimeout = Promise.race([
      analyzeTranscript(segments, durationSeconds, meta.title).catch((e) => {
        console.warn("[ingest] analysis failed (non-fatal):", e instanceof Error ? e.message : e);
        return analysisFallback;
      }),
      new Promise<typeof analysisFallback>((resolve) =>
        setTimeout(() => {
          console.warn("[ingest] analysis timed out (non-fatal), using fallback");
          resolve(analysisFallback);
        }, 20000)
      ),
    ]);

    const [embeddings, analysis] = await Promise.all([embed(pieces), analysisWithTimeout]);
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
    // Log the FULL error server-side (visible in Vercel logs / terminal)…
    console.error("[ingest] FAILED:", err);
    // …but return a calm, user-friendly message.
    const { message, status } = toUserMessage(err);
    return NextResponse.json({ error: message }, { status });
  }
}
