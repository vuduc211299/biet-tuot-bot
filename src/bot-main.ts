import "dotenv/config";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { McpClientWrapper } from "./mcp-client.js";
import { LlmAssistant, type LlmConfig } from "./llm.js";
import { TelegramNewsBot } from "./telegram.js";

function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

async function main(): Promise<void> {
  console.log("Starting Bot...");

  // ---- 1. Validate required env vars ----
  const telegramToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const aiApiKey = requireEnv("AI_API_KEY");
  const aiProvider = (process.env.AI_PROVIDER?.trim() || "openai") as LlmConfig["provider"];
  const aiModel = process.env.AI_MODEL?.trim() || "gpt-4o";
  const aiBaseUrl = process.env.AI_BASE_URL?.trim() || undefined;
  const mcpServerUrl = process.env.MCP_SERVER_URL ?? "http://localhost:3001/mcp";
  const port = parseInt(process.env.PORT ?? "3001", 10);

  // Optional reasoner model — used for /analysis and deep-analysis queries
  const aiReasonerModel = process.env.AI_REASONER_MODEL?.trim() || undefined;
  const aiReasonerApiKey = process.env.AI_REASONER_API_KEY?.trim() || undefined;
  const aiReasonerBaseUrl = process.env.AI_REASONER_BASE_URL?.trim() || undefined;

  console.log(`AI Provider: ${aiProvider}, Model: ${aiModel}`);
  if (aiReasonerModel) {
    console.log(`Reasoner Model: ${aiReasonerModel}${aiReasonerBaseUrl ? ` (${aiReasonerBaseUrl})` : ""}`);
  } else {
    console.log("Reasoner Model: not configured (fallback to chat model)");
  }

  // ---- 2. Start MCP Server (Express HTTP) ----
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Stateless MCP: new server + transport per request
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createServer();
    res.on("close", () => {
      transport.close().catch(() => { });
      mcpServer.close().catch(() => { });
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const httpServer = app.listen(port);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(
          `Port ${port} is already in use.\n` +
          `Another process (dev:http or a previous bot instance) is still running.\n` +
          `Fix: kill the process holding port ${port} with:  lsof -ti :${port} | xargs kill`
        ));
      } else {
        reject(err);
      }
    });
  });
  console.log(`MCP Server running at http://localhost:${port}/mcp`);

  // ---- 3. Initialize LLM + MCP Client ----
  // Small delay to ensure Express is fully listening before connecting
  await new Promise(r => setTimeout(r, 300));

  const mcpClient = new McpClientWrapper(mcpServerUrl);
  const llm = new LlmAssistant(
    { provider: aiProvider, model: aiModel, apiKey: aiApiKey, baseUrl: aiBaseUrl },
    mcpClient,
    aiReasonerModel
      ? { model: aiReasonerModel, apiKey: aiReasonerApiKey, baseUrl: aiReasonerBaseUrl }
      : undefined
  );
  await llm.initialize();
  console.log("LLM Assistant initialized");

  // ---- 4. Start Telegram Bot ----
  const bot = new TelegramNewsBot(telegramToken, llm);
  await bot.start();

  // ---- 5. Graceful Shutdown ----
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    try {
      bot.stop();
      await mcpClient.disconnect();
      httpServer.close(() => {
        console.log("HTTP server closed.");
        process.exit(0);
      });
      // Force exit after 5s if server doesn't close
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
