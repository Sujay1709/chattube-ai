/**
 * llm.ts — the ONE place that talks to your AI provider.
 *
 * Everything else in the app (retrieval, API routes, UI) is provider-agnostic.
 * It only knows two functions exist: `embed()` and `chat()`. That means to swap
 * OpenAI for Anthropic, Cohere, Groq, a local model, etc., you only edit THIS file.
 *
 * This is the "swappable provider" pattern — a small seam that keeps a dependency
 * from leaking across your whole codebase. It's one of the most useful habits to
 * build as an AI engineer.
 */

import OpenAI from "openai";

// Lazily construct the client so importing this file never throws if the key is
// missing at build time (Vercel builds without your runtime env by default).
//
// This works with ANY OpenAI-compatible provider. To use OpenRouter (free
// models for chat AND embeddings), just set in .env.local:
//   OPENAI_API_KEY   = your OpenRouter key (sk-or-...)
//   OPENAI_BASE_URL  = https://openrouter.ai/api/v1
//   CHAT_MODEL       = openrouter/free   (auto-picks a free model)
//   EMBEDDING_MODEL  = nvidia/nemotron-3-embed-1b:free
// Leave OPENAI_BASE_URL unset to talk to OpenAI directly.
function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add your OpenAI OR OpenRouter key to .env.local (see .env.example)."
    );
  }
  const baseURL = process.env.OPENAI_BASE_URL || undefined;
  const isOpenRouter = !!baseURL && baseURL.includes("openrouter.ai");

  return new OpenAI({
    apiKey,
    baseURL,
    // OpenRouter recommends these headers so your app shows up in their
    // dashboard/rankings. They're optional and ignored by other providers.
    defaultHeaders: isOpenRouter
      ? {
          "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
          "X-Title": "ChatTube.ai",
        }
      : undefined,
  });
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const CHAT_MODEL = process.env.CHAT_MODEL || "gpt-4o-mini";

/**
 * Turn an array of texts into an array of embedding vectors.
 *
 * OpenAI accepts a whole array in one call. Some OpenRouter-hosted embedding
 * models (e.g. the NVIDIA one) only return a proper batch for a SINGLE input and
 * respond with an unexpected shape for arrays. So we try the fast batch path
 * first, and if the response shape is wrong we fall back to embedding each text
 * individually — slower, but works on any provider.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const c = client();

  // encoding_format "float" is required by some providers (e.g. NVIDIA on
  // OpenRouter). The SDK otherwise defaults to base64, which they reject.
  const opts = { encoding_format: "float" as const };

  // Fast path: one batched request.
  try {
    const res = await c.embeddings.create({ model: EMBEDDING_MODEL, input: texts, ...opts });
    if (Array.isArray(res?.data) && res.data.length === texts.length) {
      return res.data.map((d) => d.embedding as number[]);
    }
    console.warn(
      "[embed] batch returned unexpected shape, falling back to per-item:",
      JSON.stringify(res).slice(0, 300)
    );
  } catch (err) {
    console.warn(
      "[embed] batch call failed, falling back to per-item:",
      err instanceof Error ? err.message : err
    );
  }

  // Fallback: embed one text at a time.
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const r = await c.embeddings.create({ model: EMBEDDING_MODEL, input: texts[i], ...opts });
    const vec = r?.data?.[0]?.embedding as number[] | undefined;
    if (!vec) {
      throw new Error(
        `Embedding provider returned no vector for chunk ${i}. ` +
          `Model "${EMBEDDING_MODEL}" response: ${JSON.stringify(r).slice(0, 300)}`
      );
    }
    out.push(vec);
  }
  return out;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Send a list of messages to the chat model and get back the assistant's reply.
 */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const res = await client().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.3,
    messages,
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

/**
 * Like chat(), but forces the model to return a single JSON object and parses it.
 * Used for structured outputs (topic keywords + timeline chapters).
 */
export async function chatJSON<T>(messages: ChatMessage[]): Promise<T> {
  const res = await client().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages,
  });
  const content = res.choices[0]?.message?.content?.trim() || "{}";
  return JSON.parse(content) as T;
}

/* ---------------------------------------------------------------------------
 * Want to swap providers? Here's the shape you need to preserve.
 *
 * Anthropic example (pseudo):
 *   import Anthropic from "@anthropic-ai/sdk";
 *   // embed(): Anthropic has no embeddings API, so pair it with Voyage/Cohere.
 *   // chat():  const r = await anthropic.messages.create({ model, messages, max_tokens })
 *   //          return r.content[0].text;
 *
 * As long as `embed()` returns number[][] and `chat()` returns a string, the
 * rest of the app doesn't change.
 * ------------------------------------------------------------------------- */
