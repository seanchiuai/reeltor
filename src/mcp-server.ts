import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type Database from "better-sqlite3";
import { searchByVector, deleteReel as deleteReelFromDb } from "./db.js";

export function createMcpServer(db: Database.Database): McpServer {
  const server = new McpServer({
    name: "reeltor",
    version: "0.1.0",
  });

  // --- search_reels ---
  server.registerTool(
    "search_reels",
    {
      title: "Search Reels",
      description:
        "Semantic search across all saved Instagram Reels. Returns matching reels with relevance scores.",
      inputSchema: {
        query: z.string().describe("Natural language search query"),
        collection: z
          .string()
          .optional()
          .describe("Optional filter by collection name"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Max results to return (default 5)"),
      },
    },
    async ({ query, collection, limit }) => {
      // TODO: Generate embedding from query via OpenAI text-embedding-3-small
      // For now, return a stub response indicating the pipeline isn't wired yet
      const queryEmbedding = null as Float32Array | null;

      if (!queryEmbedding) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Embedding pipeline not yet configured",
                message:
                  "The search_reels tool requires the embedding pipeline to be set up. Ingest some reels first.",
              }),
            },
          ],
        };
      }

      const results = searchByVector(db, queryEmbedding, limit, {
        collection,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              results: results.map((r) => ({
                reel_id: r.id,
                url: r.url,
                transcript: r.transcript,
                description: r.description,
                collection: r.collection,
                created_at: r.created_at,
                relevance_score: r.relevance_score,
              })),
            }),
          },
        ],
      };
    }
  );

  // --- delete_reel ---
  server.registerTool(
    "delete_reel",
    {
      title: "Delete Reel",
      description:
        "Remove a saved Reel and its associated embeddings from the database.",
      inputSchema: {
        reel_id: z.string().describe("The ID of the reel to delete"),
      },
    },
    async ({ reel_id }) => {
      const deleted = deleteReelFromDb(db, reel_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted }),
          },
        ],
      };
    }
  );

  return server;
}

export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function startHttpTransport(
  db: Database.Database,
  port: number
): Promise<void> {
  const { createServer } = await import("node:http");

  const httpServer = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/mcp") {
      // Stateless: fresh server + transport per request
      const server = createMcpServer(db);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } else if (req.method === "GET" && req.url === "/mcp") {
      // SSE not supported in stateless mode
      res.writeHead(405);
      res.end("Method not allowed — use POST");
    } else if (req.method === "DELETE" && req.url === "/mcp") {
      // No sessions to delete in stateless mode
      res.writeHead(405);
      res.end("Method not allowed");
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`Reeltor MCP server (HTTP) listening on http://127.0.0.1:${port}/mcp`);
  });
}
