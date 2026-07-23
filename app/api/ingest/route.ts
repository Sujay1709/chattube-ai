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

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
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

    const pieces = chunkText(text);
    if (pieces.length === 0) {
      return NextResponse.json({ error: "Transcript was empty after processing." }, { status: 422 });
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
