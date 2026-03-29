import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const EMBEDDING_DIMENSIONS = 1536;

export function initDatabase(dbPath: string): Database.Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  sqliteVec.load(db);

  createSchema(db);
  return db;
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reels (
      id TEXT PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      transcript TEXT,
      description TEXT,
      collection TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      error_message TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reels_url ON reels(url);
    CREATE INDEX IF NOT EXISTS idx_reels_collection ON reels(collection);
    CREATE INDEX IF NOT EXISTS idx_reels_status ON reels(status);
    CREATE INDEX IF NOT EXISTS idx_reels_created_at ON reels(created_at);

    CREATE TABLE IF NOT EXISTS embedding_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
      chunk_text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_embedding_chunks_reel_id ON embedding_chunks(reel_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
      embedding float[${EMBEDDING_DIMENSIONS}]
    );
  `);
}

// --- Query helpers ---

export interface ReelRow {
  id: string;
  url: string;
  transcript: string | null;
  description: string | null;
  collection: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function insertReel(
  db: Database.Database,
  reel: { id: string; url: string; collection?: string }
): void {
  db.prepare(
    `INSERT INTO reels (id, url, collection, status) VALUES (?, ?, ?, 'processing')`
  ).run(reel.id, reel.url, reel.collection ?? null);
}

export function updateReelComplete(
  db: Database.Database,
  id: string,
  data: { transcript: string | null; description: string | null }
): void {
  db.prepare(
    `UPDATE reels SET transcript = ?, description = ?, status = 'complete' WHERE id = ?`
  ).run(data.transcript, data.description, id);
}

export function updateReelError(
  db: Database.Database,
  id: string,
  errorMessage: string
): void {
  db.prepare(`UPDATE reels SET status = 'error', error_message = ? WHERE id = ?`).run(
    errorMessage,
    id
  );
}

export function insertEmbeddingChunk(
  db: Database.Database,
  reelId: string,
  chunkText: string,
  embedding: Float32Array
): void {
  const result = db
    .prepare(`INSERT INTO embedding_chunks (reel_id, chunk_text) VALUES (?, ?)`)
    .run(reelId, chunkText);

  const rowid = result.lastInsertRowid;
  db.prepare(`INSERT INTO vec_embeddings (rowid, embedding) VALUES (?, ?)`).run(
    rowid,
    Buffer.from(embedding.buffer)
  );
}

export function searchByVector(
  db: Database.Database,
  queryEmbedding: Float32Array,
  limit: number,
  filters?: { collection?: string }
): (ReelRow & { relevance_score: number })[] {
  // Vector search to get candidate rowids
  const vecResults = db
    .prepare(
      `SELECT rowid, distance FROM vec_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
    )
    .all(Buffer.from(queryEmbedding.buffer), limit * 3) as {
    rowid: number;
    distance: number;
  }[];

  if (vecResults.length === 0) return [];

  // Map rowids to reel_ids and deduplicate
  const rowids = vecResults.map((r) => r.rowid);
  const distanceMap = new Map(vecResults.map((r) => [r.rowid, r.distance]));

  const placeholders = rowids.map(() => "?").join(",");
  const chunks = db
    .prepare(
      `SELECT id, reel_id FROM embedding_chunks WHERE id IN (${placeholders})`
    )
    .all(...rowids) as { id: number; reel_id: string }[];

  // Best distance per reel
  const reelBestDistance = new Map<string, number>();
  for (const chunk of chunks) {
    const dist = distanceMap.get(chunk.id) ?? Infinity;
    const current = reelBestDistance.get(chunk.reel_id) ?? Infinity;
    if (dist < current) {
      reelBestDistance.set(chunk.reel_id, dist);
    }
  }

  // Fetch reels with optional filters
  const reelIds = [...reelBestDistance.keys()];
  if (reelIds.length === 0) return [];

  const reelPlaceholders = reelIds.map(() => "?").join(",");
  let query = `SELECT * FROM reels WHERE id IN (${reelPlaceholders}) AND status = 'complete'`;
  const params: unknown[] = [...reelIds];

  if (filters?.collection) {
    query += ` AND collection = ?`;
    params.push(filters.collection);
  }

  const reels = db.prepare(query).all(...params) as ReelRow[];

  // Attach scores, sort, and limit
  return reels
    .map((reel) => ({
      ...reel,
      relevance_score: 1 - (reelBestDistance.get(reel.id) ?? 1),
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
}

export function deleteReel(db: Database.Database, reelId: string): boolean {
  // Get embedding chunk rowids to delete from vec table
  const chunks = db
    .prepare(`SELECT id FROM embedding_chunks WHERE reel_id = ?`)
    .all(reelId) as { id: number }[];

  if (chunks.length > 0) {
    const placeholders = chunks.map(() => "?").join(",");
    db.prepare(`DELETE FROM vec_embeddings WHERE rowid IN (${placeholders})`).run(
      ...chunks.map((c) => c.id)
    );
  }

  // CASCADE handles embedding_chunks deletion
  const result = db.prepare(`DELETE FROM reels WHERE id = ?`).run(reelId);
  return result.changes > 0;
}

export function getReelByUrl(
  db: Database.Database,
  url: string
): ReelRow | undefined {
  return db.prepare(`SELECT * FROM reels WHERE url = ?`).get(url) as
    | ReelRow
    | undefined;
}

export function getReelById(
  db: Database.Database,
  id: string
): ReelRow | undefined {
  return db.prepare(`SELECT * FROM reels WHERE id = ?`).get(id) as
    | ReelRow
    | undefined;
}
