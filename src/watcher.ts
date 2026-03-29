import CDP from "chrome-remote-interface";

const REEL_URL_PATTERN = /instagram\.com\/reels?\/[\w-]+/g;

function extractReelUrlsFromPayload(payload: string): string[] {
  let decoded = payload;
  try {
    decoded = Buffer.from(payload, "base64").toString("utf-8");
  } catch {}

  const matches = decoded.match(REEL_URL_PATTERN) || [];
  return [...new Set(matches.map((m) => `https://www.${m}/`))];
}

async function postToIngest(
  ingestPort: number,
  url: string
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${ingestPort}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (res.status === 202) {
    const data = (await res.json()) as { reel_id: string };
    console.log(`[watcher] Submitted to ingest (reel_id: ${data.reel_id})`);
  } else if (res.status === 409) {
    console.log(`[watcher] Reel already exists, skipping: ${url}`);
  } else {
    console.error(`[watcher] Ingest returned ${res.status} for ${url}`);
  }
}

export async function startWatcher(
  chromePort: number,
  ingestPort: number
): Promise<void> {
  const seenReels = new Set<string>();
  let initialSnapshotDone = false;

  console.log(`[watcher] Connecting to Chrome on port ${chromePort}...`);

  let targets: CDP.Target[];
  try {
    targets = await CDP.List({ port: chromePort });
  } catch {
    console.error(
      "[watcher] Could not connect to Chrome. Launch Chrome with:"
    );
    console.error(
      `  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${chromePort} --user-data-dir=/tmp/chrome-debug`
    );
    return;
  }

  const dmTab = targets.find(
    (t) => t.type === "page" && t.url?.includes("instagram.com/direct/")
  );

  if (!dmTab) {
    console.error(
      "[watcher] No Instagram DM tab found. Open a DM thread in Chrome."
    );
    console.error("[watcher] Available tabs:");
    for (const t of targets) {
      if (t.type === "page") console.error(`  - ${t.url}`);
    }
    return;
  }

  console.log(`[watcher] Found Instagram DM tab: ${dmTab.url}`);

  const client = await CDP({ target: dmTab, port: chromePort });
  const { Network } = client;

  await Network.enable();

  Network.webSocketFrameReceived(({ response }) => {
    const payload = response.payloadData || "";
    if (payload.length < 50) return;

    const reelUrls = extractReelUrlsFromPayload(payload);

    for (const url of reelUrls) {
      if (seenReels.has(url)) continue;
      seenReels.add(url);

      if (initialSnapshotDone) {
        console.log(`[watcher] New reel detected: ${url}`);
        postToIngest(ingestPort, url).catch((err) =>
          console.error(`[watcher] Failed to submit reel: ${err}`)
        );
      }
    }
  });

  // Let initial WebSocket traffic settle before alerting on new reels
  setTimeout(() => {
    initialSnapshotDone = true;
    console.log(
      `[watcher] Initial snapshot done. ${seenReels.size} existing reels ignored.`
    );
    console.log("[watcher] Watching for new reels in real-time...");
  }, 5000);
}
