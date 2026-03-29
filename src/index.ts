#!/usr/bin/env node

import { Command } from "commander";
import { ensureReeltorDir, loadConfig, saveConfig } from "./config.js";
import { initDatabase } from "./db.js";
import { createMcpServer, startStdioTransport, startHttpTransport } from "./mcp-server.js";
import { startIngestServer } from "./ingest.js";
import { normalizeReelUrl } from "./ingest.js";
import { insertReel, getReelByUrl } from "./db.js";
import { v4 as uuidv4 } from "uuid";

const program = new Command();

program
  .name("reeltor")
  .description("Your Reels, Searchable")
  .version("0.1.0");

// --- init ---
program
  .command("init")
  .description("Initialize ~/.reeltor/ directory and config")
  .action(() => {
    ensureReeltorDir();
    const config = loadConfig();
    saveConfig(config);
    console.log("Initialized ~/.reeltor/");
    console.log("Edit ~/.reeltor/config.json to add your API keys.");
  });

// --- start ---
program
  .command("start")
  .description("Start the ingest server and MCP server")
  .option("--stdio", "Run MCP server via stdio transport (for Claude Desktop)")
  .option("--http", "Run MCP server via HTTP transport (for ChatGPT/remote clients)")
  .option("--port <number>", "Ingest server port", "7433")
  .action(async (opts) => {
    const config = loadConfig();
    const db = initDatabase(config.db_path);
    const ingestPort = parseInt(opts.port, 10) || config.ingest_port;

    // Start ingest HTTP server
    startIngestServer(db, ingestPort);

    if (opts.stdio) {
      console.log("Starting MCP server (stdio transport)...");
      const mcpServer = createMcpServer(db);
      await startStdioTransport(mcpServer);
    } else if (opts.http) {
      const mcpPort = ingestPort + 1;
      await startHttpTransport(db, mcpPort);
    } else {
      console.log("Starting MCP server (stdio transport)...");
      const mcpServer = createMcpServer(db);
      await startStdioTransport(mcpServer);
    }
  });

// --- add ---
program
  .command("add <url>")
  .description("Add a Reel URL for processing")
  .option("-c, --collection <name>", "Assign to a collection")
  .action(async (url, opts) => {
    const config = loadConfig();
    const db = initDatabase(config.db_path);

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeReelUrl(url);
    } catch {
      console.error("Invalid Instagram Reel URL");
      process.exit(1);
    }

    const existing = getReelByUrl(db, normalizedUrl);
    if (existing) {
      console.log(`Reel already exists (id: ${existing.id}, status: ${existing.status})`);
      process.exit(0);
    }

    const reelId = uuidv4();
    insertReel(db, {
      id: reelId,
      url: normalizedUrl,
      collection: opts.collection,
    });

    console.log(`Added reel ${reelId} (status: processing)`);
    console.log("Note: Processing pipeline is not yet implemented.");

    db.close();
  });

// --- serve (MCP only, for claude_desktop_config.json) ---
program
  .command("serve")
  .description("Run MCP server only (stdio transport, for Claude Desktop)")
  .action(async () => {
    const config = loadConfig();
    const db = initDatabase(config.db_path);
    const mcpServer = createMcpServer(db);
    await startStdioTransport(mcpServer);
  });

program.parse();
