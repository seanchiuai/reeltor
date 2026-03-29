import type { Logger } from "pino";
import type Database from "better-sqlite3";

import type { ExtractedReelJson } from "../types/pipeline.js";

interface SearchIndexChunk {
  reelId: string;
  chunkIndex: number;
  chunkText: string;
  source: "transcript" | "description" | "summary" | "ocr";
}

function splitIntoChunks(input: { reelId: string; text: string; source: SearchIndexChunk["source"] }): SearchIndexChunk[] {
  const normalized = input.text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const chunks: SearchIndexChunk[] = [];
  const chunkSize = 90;
  const overlap = 15;
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const slice = words.slice(start, start + chunkSize).join(" ").trim();

    if (slice) {
      chunks.push({
        reelId: input.reelId,
        chunkIndex,
        chunkText: slice,
        source: input.source,
      });
    }

    if (start + chunkSize >= words.length) {
      break;
    }

    start += chunkSize - overlap;
    chunkIndex += 1;
  }

  return chunks;
}

export function indexReelForSearch(input: {
  db: Database.Database;
  logger: Logger;
  reelId: string;
  transcript: string;
  description: string;
  extracted: ExtractedReelJson;
}): void {
  const { db, logger } = input;

  const chunks = [
    ...splitIntoChunks({ reelId: input.reelId, text: input.transcript, source: "transcript" }),
    ...splitIntoChunks({ reelId: input.reelId, text: input.description, source: "description" }),
    ...splitIntoChunks({ reelId: input.reelId, text: input.extracted.summary, source: "summary" }),
    ...splitIntoChunks({ reelId: input.reelId, text: input.extracted.ocr_text.join(" "), source: "ocr" }),
  ];

  if (chunks.length === 0) {
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO embedding_chunks (reel_id, chunk_text, chunk_index, source) VALUES (?, ?, ?, ?)`
  );

  const insertAll = db.transaction(() => {
    for (const chunk of chunks) {
      stmt.run(chunk.reelId, chunk.chunkText, chunk.chunkIndex, chunk.source);
    }
  });

  insertAll();
  logger.info({ reelId: input.reelId, inserted: chunks.length }, "Inserted search chunks for reel.");
}
