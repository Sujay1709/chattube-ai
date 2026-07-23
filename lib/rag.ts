/**
 * rag.ts — the retrieval core of Retrieval-Augmented Generation.
 *
 * The pipeline, end to end:
 *   1. CHUNK   split the long transcript into overlapping windows.
 *   2. EMBED   turn each chunk into a vector (done via lib/llm.ts).
 *   3. STORE   here we keep chunks + vectors as plain JSON — no database needed.
 *   4. RETRIEVE embed the question, rank chunks by cosine similarity, keep top-k.
 *   5. GENERATE feed the top chunks to the LLM as context (in the API route).
 *
 * Why no vector database? For a single video the corpus is tiny (dozens of
 * chunks), so a brute-force cosine scan in memory is instant and keeps the app
 * fully serverless with zero external services. When you outgrow that, swap
 * steps 3–4 for Pinecone / Supabase pgvector — the interface below is the seam.
 */

export interface Chunk {
  id: number;
  text: string;
  embedding: number[];
}

/**
 * Split text into word-based chunks with overlap.
 * Overlap keeps ideas that straddle a boundary retrievable from either side.
 */
export function chunkText(
  text: string,
  chunkSize = 200, // words per chunk
  overlap = 40 // words shared with the next chunk
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + chunkSize);
    if (slice.length > 0) chunks.push(slice.join(" "));
    if (start + chunkSize >= words.length) break;
  }
  return chunks;
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ScoredChunk extends Chunk {
  score: number;
}

/** Rank stored chunks against a query vector and return the top-k. */
export function retrieve(
  queryEmbedding: number[],
  chunks: Chunk[],
  topK = 4
): ScoredChunk[] {
  return chunks
    .map((c) => ({ ...c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
