/**
 * GET /api/debug — TEMPORARY diagnostic. Delete when done.
 *
 * Reports whether the running server actually loaded your env vars. It never
 * exposes the full key — only whether it's present and its first/last few chars.
 */

import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.OPENAI_API_KEY || "";
  return NextResponse.json({
    hasKey: key.length > 0,
    keyLength: key.length,
    keyStart: key.slice(0, 7),
    keyEnd: key.slice(-4),
    looksLikePlaceholder: key.includes("PASTE") || key.includes("your-openrouter"),
    baseURL: process.env.OPENAI_BASE_URL || "(not set → defaults to OpenAI)",
    chatModel: process.env.CHAT_MODEL || "(not set)",
    embeddingModel: process.env.EMBEDDING_MODEL || "(not set)",
  });
}
