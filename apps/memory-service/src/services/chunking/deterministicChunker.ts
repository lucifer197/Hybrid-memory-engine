export interface Chunk {
  chunk_index: number;
  chunk_text: string;
  token_count: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 1000;

/**
 * Deterministic chunker — same input always yields same chunks.
 *
 * Strategy:
 *  1. Split text by blank lines (paragraphs).
 *  2. If a paragraph exceeds `maxChunkChars`, split by sentence boundaries.
 *  3. If a sentence still exceeds, hard-split at `maxChunkChars`.
 *  4. Assign stable, sequential indexes.
 */
export function chunkText(
  text: string,
  maxChunkChars: number = DEFAULT_MAX_CHUNK_CHARS
): Chunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const rawChunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxChunkChars) {
      rawChunks.push(para);
    } else {
      // Split long paragraph by sentence boundaries
      const sentences = splitSentences(para);
      let buffer = "";

      for (const sentence of sentences) {
        if (sentence.length > maxChunkChars) {
          // Flush buffer first
          if (buffer) {
            rawChunks.push(buffer.trim());
            buffer = "";
          }
          // Hard-split the oversized sentence
          for (let i = 0; i < sentence.length; i += maxChunkChars) {
            rawChunks.push(sentence.slice(i, i + maxChunkChars).trim());
          }
        } else if (buffer.length + sentence.length + 1 > maxChunkChars) {
          rawChunks.push(buffer.trim());
          buffer = sentence;
        } else {
          buffer = buffer ? buffer + " " + sentence : sentence;
        }
      }
      if (buffer) rawChunks.push(buffer.trim());
    }
  }

  return rawChunks.filter(Boolean).map((chunk_text, i) => ({
    chunk_index: i,
    chunk_text,
    token_count: estimateTokens(chunk_text),
  }));
}

/** Rough token estimate: ~4 chars per token (good enough for MVP). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split on sentence-ending punctuation followed by whitespace. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean);
}
