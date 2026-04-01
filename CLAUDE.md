# CLAUDE.md — BietTuotBot Project Context

> **For AI agents**: Read this file first before making any changes to this codebase.
> Keep this file up to date after any major refactor, new feature, or structural change.

---

## Changelog

| Date       | Change                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-01 | Refactored flat `src/*.ts` data sources into `src/tools/` topic folders (`crypto/`, `vn-stock/`, `news/`). Slimmed `server.ts` to thin orchestrator. Shared axios instances moved to `_shared/http.ts`. |
| 2026-04-01 | Rewrote `TOOL_ROUTING` in `src/prompts/system.ts` to match new 3-folder topic structure.                                                                                                                |
| 2026-04-01 | Initial project setup: Telegram bot + MCP server + 20 tools across 5 data sources.                                                                                                                      |

---

## Project Overview

BietTuotBot is a **Telegram chatbot** backed by an **MCP (Model Context Protocol) server**. A user sends a message on Telegram; the LLM decides which MCP tools to call; tools fetch real-time data from external APIs/scrapers; the LLM synthesizes a response.

- **Runtime**: Node.js + TypeScript (ESM, `module: "nodenext"`)
- **LLM layer**: Vercel AI SDK — supports OpenAI, Anthropic, Google Gemini, Ollama, DeepSeek, Groq
- **Bot layer**: grammY (Telegram)
- **MCP transport**: StreamableHTTP at `:3001/mcp`
- **Total MCP tools**: 20

---

## Essential Commands

```bash
npm run build           # compile TypeScript → lib/  (always run after changes)
npm run dev:bot         # run Telegram bot in dev with nodemon
npm run dev:http        # run MCP server standalone (no bot) on port 3001
npm run dev:inspector:http   # open MCP Inspector at localhost:5173
npm run start:bot       # production: run compiled bot
tsc --noEmit            # type-check without emitting (fast check)
tsc --build --clean && npm run build  # clean rebuild
```

---

## Source Structure

```
src/
├── bot-main.ts          # Entry point — starts MCP server + Telegram bot in one process
├── server.ts            # MCP server — thin orchestrator, calls registerAllTools()
├── llm.ts               # Vercel AI SDK wrapper — tool-use loop, chat history, retry logic
├── telegram.ts          # grammY bot — commands, access control, auto mode detection
├── mcp-client.ts        # MCP HTTP client — bridges AI tool calls → MCP server
├── index.ts             # Standalone MCP server entry (no bot, for inspector/testing)
├── prompts/
│   ├── system.ts        # CHAT_SYSTEM_PROMPT, REASONER_SYSTEM_PROMPT, TOOL_ROUTING
│   ├── commands.ts      # Per-command prompt builders (/news, /market, /plan, /analysis)
│   └── index.ts         # Re-exports
├── tools/
│   ├── index.ts         # registerAllTools(server) — calls all 3 topic registers
│   ├── _shared/
│   │   └── http.ts      # Shared utilities: http (axios), coingeckoHttp (axios), isFresh(), fetchWithRetry(), logTool()
│   ├── crypto/
│   │   ├── crypto-market.ts    # CoinGecko: prices, top coins, global data, trending
│   │   ├── crypto-technical.ts # CoinGecko OHLC + RSI/SMA/EMA/MACD calculations
│   │   ├── crypto-news.ts      # cryptocurrency.cv RSS + ThuanCapital scraping
│   │   └── index.ts            # registerCryptoTools(server) — 6 tools
│   ├── vn-stock/
│   │   ├── stock-market.ts     # KBS Securities: OHLCV, price board, profile, rankings + CafeF financials
│   │   ├── stock-technical.ts  # SMA/EMA/RSI/MACD computation + ATH/ATL from full history
│   │   ├── stock-news.ts       # CafeF: company news + insider trading
│   │   └── index.ts            # registerVnStockTools(server) — 9 tools
│   └── news/
│       ├── vnexpress.ts        # VnExpress RSS feeds + article content + search
│       ├── macro-news.ts       # CafeF macro/market news by category
│       ├── article-reader.ts   # CafeF full article content reader
│       └── index.ts            # registerNewsTools(server) — 5 tools
└── skills/              # (reserved for future skill definitions)
```

---

## TypeScript Conventions

- **Module system**: `"module": "nodenext"` — all relative imports **must** use `.js` extension even for `.ts` source files (e.g. `import { foo } from "./bar.js"`)
- **Build output**: `lib/src/` mirrors `src/` structure
- **No `any`**: avoid `any` types; use proper interfaces for API responses
- **ESM imports**: no `require()`, no CommonJS

---

## 20 MCP Tools — Quick Reference

| Topic folder | Tool name                       | What it does                                                      |
| ------------ | ------------------------------- | ----------------------------------------------------------------- |
| `vn-stock`   | `stock_vn_overview`             | Top volume + foreign flow (KBS)                                   |
| `vn-stock`   | `stock_get_ohlcv`               | Historical OHLCV for 1 symbol                                     |
| `vn-stock`   | `stock_get_index`               | Index OHLCV (VNINDEX/HNX/UPCOM/VN30)                              |
| `vn-stock`   | `stock_price_board`             | Real-time price board, multiple symbols                           |
| `vn-stock`   | `stock_get_profile`             | Company profile (KBS)                                             |
| `vn-stock`   | `stock_get_technical`           | All-in-one: SMA/EMA/RSI/MACD/ATH/ATL                              |
| `vn-stock`   | `cafef_get_company_news`        | Company news & events (CafeF)                                     |
| `vn-stock`   | `cafef_get_insider_trading`     | Insider/shareholder disclosures (CafeF)                           |
| `vn-stock`   | `cafef_get_financials`          | P/E, EPS, P/B, market cap (CafeF)                                 |
| `crypto`     | `crypto_get_overview`           | Global market cap, BTC dominance, top 10, trending                |
| `crypto`     | `crypto_get_prices`             | Prices for specific coins by CoinGecko ID                         |
| `crypto`     | `crypto_get_technical`          | RSI/SMA/EMA/MACD/ATH/ATL + supply                                 |
| `crypto`     | `cryptocurrency_get_news`       | English crypto news (200+ sources)                                |
| `crypto`     | `thuancapital_get_news`         | Vietnamese crypto: tin-tuc or kien-thuc                           |
| `crypto`     | `thuancapital_get_article`      | Full ThuanCapital article by URL                                  |
| `news`       | `vnexpress_get_latest_news`     | Latest VnExpress by category (8 categories)                       |
| `news`       | `vnexpress_search_news`         | Keyword search across VnExpress                                   |
| `news`       | `vnexpress_get_article_content` | Full VnExpress article by URL or ID                               |
| `news`       | `cafef_get_macro_news`          | Macro/market news: chung-khoan/vi-mo/quoc-te/thi-truong/ngan-hang |
| `news`       | `cafef_get_article_content`     | Full CafeF article by URL                                         |

> **Tool names are stable identifiers** — do NOT rename them. The system prompt in `src/prompts/system.ts` and AI call history both reference these names.

---

## Shared Utilities (`src/tools/_shared/http.ts`)

| Export                          | Purpose                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`                          | Axios instance with Vietnamese browser UA + `Accept-Language: vi-VN`. Used by CafeF scrapers, VnExpress (via `fetchWithRetry`), stock-news. |
| `coingeckoHttp`                 | Axios instance with `McpNewsBot/1.0` UA + optional `x-cg-demo-api-key` header. Used by crypto-market and crypto-technical.                  |
| `isFresh(timestamp, ttl)`       | Returns true if `Date.now() - timestamp < ttl`. Used for all cache checks.                                                                  |
| `fetchWithRetry(url, retries?)` | GET with up to 2 retries, 1s delay. Uses `http` instance.                                                                                   |
| `logTool(name, input, data)`    | Logs tool name + input + truncated response preview to console.                                                                             |

---

## Adding a New Tool

1. Add the data function to the appropriate data file in `src/tools/<topic>/`.
2. Register it in `src/tools/<topic>/index.ts` using `server.registerTool(name, { title, description, inputSchema: {zod} }, handler)`.
3. Update `TOOL_ROUTING` in `src/prompts/system.ts` — add the tool under the correct `─── TOPIC ───` section.
4. Run `npm run build` — zero errors required.
5. Update this file's **Changelog** and the **20 MCP Tools** table above.

## Adding a New Topic Folder

1. Create `src/tools/<topic>/` with `*-market.ts`, `*-technical.ts`, `*-news.ts` (or relevant splits).
2. Create `src/tools/<topic>/index.ts` exporting `register<Topic>Tools(server: McpServer): void`.
3. Import and call it in `src/tools/index.ts` inside `registerAllTools()`.
4. Add a `─── TOPIC (N tools) ───` section to `TOOL_ROUTING` in `src/prompts/system.ts`.
5. Update this file's **Changelog** and tool tables.

---

## Data Sources & Cache TTLs

| Source                     | Used by                                                           | Cache TTL                          |
| -------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| CoinGecko REST API         | crypto-market, crypto-technical                                   | 3 min (prices), 5 min (OHLC)       |
| KBS Securities API         | stock-market, stock-technical                                     | 5 min (OHLCV), 1 min (price board) |
| CafeF HTML scraping        | stock-market (financials), stock-news, macro-news, article-reader | 5 min                              |
| VnExpress RSS              | vnexpress                                                         | 5 min (feeds), 60 min (articles)   |
| cryptocurrency.cv RSS      | crypto-news                                                       | 5 min                              |
| ThuanCapital HTML scraping | crypto-news                                                       | 5 min                              |

---

## Environment Variables

| Variable               | Required | Description                                   |
| ---------------------- | -------- | --------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`   | ✅       | From @BotFather                               |
| `AI_PROVIDER`          | ✅       | `openai` \| `anthropic` \| `google`           |
| `AI_MODEL`             | ✅       | Chat mode model, e.g. `gpt-4o`                |
| `AI_API_KEY`           | ✅       | API key for provider                          |
| `AI_BASE_URL`          | ❌       | Custom endpoint (Ollama, DeepSeek, Groq)      |
| `AI_REASONER_MODEL`    | ❌       | Reasoner mode model (fallback: AI_MODEL)      |
| `AI_REASONER_API_KEY`  | ❌       | API key for reasoner (fallback: AI_API_KEY)   |
| `AI_REASONER_BASE_URL` | ❌       | Base URL for reasoner (fallback: AI_BASE_URL) |
| `COINGECKO_API_KEY`    | ❌       | CoinGecko demo API key (higher rate limits)   |
| `MCP_SERVER_URL`       | ❌       | Default: `http://localhost:3001/mcp`          |
| `PORT`                 | ❌       | MCP server port, default: `3001`              |
| `ADMIN_CHAT_ID`        | ❌       | Telegram chat ID of admin                     |
| `ALLOWED_CHAT_IDS`     | ❌       | Comma-separated allowed chat IDs              |
