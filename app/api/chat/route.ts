/**
 * POST /api/chat
 * Body: { question: string, chunks: Chunk[], history?: ChatMessage[] }
 * Returns: { answer: string, sources: { id, score, preview }[] }
 *
 * Steps 4–5 of the RAG pipeline: retrieve relevant chunks -> generate answer.
 */

import { NextRequest, NextResponse } from "next/server";
import { retrieve, type Chunk } from "@/lib/rag";
import { embed, chat, type ChatMessage } from "@/lib/llm";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { toUserMessage } from "@/lib/errors";

export const maxDuration = 60;

// Chat is cheaper than ingest (one embed + one completion), so allow more.
const CHAT_LIMIT = 30; // requests
const CHAT_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

// The system prompt is where the "hiring assistant" persona lives. Editing this
// changes the bot's behavior without touching any pipeline code.
const SYSTEM_PROMPT = `You are a hiring assistant that answers questions strictly
about a specific YouTube video (for example a recorded interview, a company
culture video, a role overview, or a candidate's video introduction).

Rules:
- Answer ONLY from the provided transcript context. Do not use outside knowledge.
- If the answer is not in the context, say you couldn't find it in this video.
- Be concise, professional, and neutral — this supports hiring decisions.
- When useful, quote short phrases from the transcript to support your answer.`;

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`chat:${ip}`, CHAT_LIMIT, CHAT_WINDOW_MS);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many questions recently. Try again in ${rl.retryAfterSec}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const { question, chunks, history } = (await req.json()) as {
      question: string;
      chunks: Chunk[];
      history?: ChatMessage[];
    };

    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question." }, { status: 400 });
    }
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json(
        { error: "No video has been ingested yet." },
        { status: 400 }
      );
    }

    // 4. RETRIEVE — embed the question and find the most similar chunks.
    const [queryEmbedding] = await embed([question]);
    const top = retrieve(queryEmbedding, chunks, 4);

    const context = top
      .map((c, i) => `[Excerpt ${i + 1}]\n${c.text}`)
      .join("\n\n");

    // 5. GENERATE — give the LLM the retrieved context + recent conversation.
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history?.slice(-6) ?? []),
      {
        role: "user",
        content: `Transcript context:\n\n${context}\n\nQuestion: ${question}`,
      },
    ];

    const answer = await chat(messages);

    return NextResponse.json({
      answer,
      sources: top.map((c) => ({
        id: c.id,
        score: Number(c.score.toFixed(3)),
        preview: c.text.slice(0, 120) + (c.text.length > 120 ? "…" : ""),
      })),
    });
  } catch (err) {
    console.error("[chat] FAILED:", err);
    const { message, status } = toUserMessage(err);
    return NextResponse.json({ error: message }, { status });
  }
}
