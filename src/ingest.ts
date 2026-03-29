import express from "express";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { insertReel, getReelByUrl, updateReelComplete, updateReelError } from "./db.js";

export function normalizeReelUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  // Strip tracking params, keep just the reel path
  const match = url.pathname.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`Invalid Instagram Reel URL: ${rawUrl}`);
  return `https://www.instagram.com/reel/${match[2]}/`;
}

async function processReel(
  db: Database.Database,
  reelId: string,
  _url: string
): Promise<void> {
  // TODO: Implement full pipeline:
  // 1. yt-dlp download video + metadata
  // 2. ffmpeg extract audio
  // 3. OpenAI Whisper transcription
  // 4. Claude extraction (classification + structured data)
  // 5. OpenAI embedding generation
  // 6. Write results to DB

  // Stub: mark as error with "pipeline not implemented"
  updateReelError(db, reelId, "Processing pipeline not yet implemented");
}

export function createIngestApp(db: Database.Database): express.Express {
  const app = express();
  app.use(express.json());

  app.post("/ingest", async (req, res) => {
    const { url, collection } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing or invalid 'url' field" });
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeReelUrl(url);
    } catch {
      res.status(400).json({ error: "Invalid Instagram Reel URL" });
      return;
    }

    // Check for duplicate
    const existing = getReelByUrl(db, normalizedUrl);
    if (existing) {
      res.status(409).json({
        error: "Reel already exists",
        reel_id: existing.id,
        status: existing.status,
      });
      return;
    }

    const reelId = uuidv4();
    insertReel(db, {
      id: reelId,
      url: normalizedUrl,
      collection: collection as string | undefined,
    });

    // Process in background (don't block the response)
    processReel(db, reelId, normalizedUrl).catch((err) => {
      console.error(`Failed to process reel ${reelId}:`, err);
      updateReelError(db, reelId, String(err));
    });

    res.status(202).json({ reel_id: reelId, status: "processing" });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

export function startIngestServer(
  db: Database.Database,
  port: number
): void {
  const app = createIngestApp(db);
  app.listen(port, "127.0.0.1", () => {
    console.log(`Reeltor ingest server listening on http://127.0.0.1:${port}`);
  });
}
