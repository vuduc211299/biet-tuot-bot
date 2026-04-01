# Implementation Plan: News + Financial Analysis MCP Chatbot

## 1. Project Overview

### Objectives

Build a comprehensive **Telegram chatbot** for news & financial analysis using MCP (Model Context Protocol) architecture. The bot is capable of:

- Crawling news from VnExpress.net (geopolitics, politics, economics, law, etc.)
- Fetching real-time crypto data from CoinGecko
- Fetching Vietnam stock market data from KBS Securities
- Providing **independent opinions**, deep analysis, and continuous Q&A on topics
- Docker deployment → runs 24/7 on VPS

### System Architecture Diagrams

#### 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SYSTEM ARCHITECTURE                                   │
│                  VnExpress News + Financial Analysis Chatbot                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌───────────┐                                                                  │
│  │   USER    │                                                                  │
│  │ Telegram  │                                                                  │
│  │   App     │                                                                  │
│  └─────┬─────┘                                                                  │
│        │ Telegram Bot API (HTTPS)                                               │
│        │ Long Polling                                                           │
│  ══════╪════════════════════════════════════════════════════════════════════     │
│        │                                                                        │
│  ┌─────▼──────────────────── Docker Container ─────────────────────────────┐    │
│  │                         (node:22-alpine)                                │    │
│  │                                                                         │    │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │    │
│  │  │                    bot-main.ts (Orchestrator)                    │    │    │
│  │  │              Single Node.js Process — Port 3001                 │    │    │
│  │  └──────┬──────────────┬───────────────┬───────────────────────────┘    │    │
│  │         │              │               │                                │    │
│  │  ┌──────▼──────┐ ┌────▼─────────┐ ┌───▼──────────────┐                │    │
│  │  │  TELEGRAM   │ │   LLM        │ │   MCP SERVER     │                │    │
│  │  │  BOT LAYER  │ │   AI LAYER   │ │   DATA LAYER     │                │    │
│  │  │             │ │              │ │   (Express HTTP)  │                │    │
│  │  │ telegram.ts │ │  llm.ts      │ │   server.ts       │                │    │
│  │  │ (grammY)    │ │  (Vercel AI  │ │     │             │                │    │
│  │  │             │ │   SDK)       │ │     ├─ vnexpress  │                │    │
│  │  │ Commands:   │ │              │ │     ├─ crypto     │                │    │
│  │  │ /news       │ │ Tool-use     │ │     └─ stock      │                │    │
│  │  │ /market     │ │ loop         │ │                    │                │    │
│  │  │ /sentiment  │ │              │ │  8 Tools           │                │    │
│  │  │ /risk       │ │ Conversation │ │  4 Prompts         │                │    │
│  │  │ /plan       │ │ history      │ │                    │                │    │
│  │  │ /reset      │ │ (per chat)   │ │  In-memory cache   │                │    │
│  │  │ Free text   │ │              │ │  (Map-based)       │                │    │
│  │  └──────┬──────┘ └──┬───┬──────┘ └───┬───────────────┘                │    │
│  │         │           │   │             │                                 │    │
│  │         │     ┌─────▼───▼─────┐       │                                 │    │
│  │         │     │  MCP CLIENT   │       │                                 │    │
│  │         │     │ mcp-client.ts │       │                                 │    │
│  │         │     │               │       │                                 │    │
│  │         │     │ listTools() ──┼───────┤ StreamableHTTP                  │    │
│  │         │     │ callTool()  ──┼───────┤ localhost:3001/mcp              │    │
│  │         │     └──────────────┘       │                                 │    │
│  │         │                             │                                 │    │
│  └─────────┼─────────────────────────────┼─────────────────────────────────┘    │
│            │                             │                                      │
│  ══════════╪═════════════════════════════╪══════════════════════════════════     │
│            │                             │                                      │
│     EXTERNAL SERVICES                    │  EXTERNAL DATA SOURCES               │
│            │                             │                                      │
│  ┌─────────▼──────────┐    ┌─────────────▼─────────────────────────────┐        │
│  │  LLM Provider       │    │                                           │        │
│  │  (configurable)     │    │  ┌─────────────┐  ┌───────────────────┐   │        │
│  │  OpenAI / Anthropic │    │  │ VnExpress   │  │ CoinGecko API    │   │        │
│  │  Google / Ollama    │    │  │ RSS Feeds   │  │ (free, no key)   │   │        │
│  │                     │    │  │             │  │                   │   │        │
│  │  - Tool-use         │    │  │ 8 categories│  │ /simple/price    │   │        │
│  │  - Analysis         │    │  │ XML format  │  │ /coins/markets   │   │        │
│  │  - Q&A              │    │  └─────────────┘  │ /global          │   │        │
│  └──────────────────────┘   │                   │ /search/trending │   │        │
│                            │                   └───────────────────┘   │        │
│                            │                                           │        │
│                            │  ┌───────────────────────────────────┐   │        │
│                            │  │ KBS Securities API               │   │        │
│                            │  │ (free, no auth)                  │   │        │
│                            │  │                                   │   │        │
│                            │  │ /investment/index  (indices)     │   │        │
│                            │  │ /investment/stock  (realtime)    │   │        │
│                            │  │ /sas/historical    (OHLCV)      │   │        │
│                            │  └───────────────────────────────────┘   │        │
│                            └───────────────────────────────────────────┘        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 2. Data Flow — Request/Response Cycle

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     USER MESSAGE LIFECYCLE                                │
│                                                                          │
│  User sends: "Why is gold surging? How does it affect VN stocks?"       │
│                                                                          │
│  ┌─────┐    ┌──────────┐    ┌─────────┐    ┌───────────┐                │
│  │ (1) │───►│   (2)    │───►│  (3)    │───►│   (4)     │                │
│  │User │    │Telegram  │    │  LLM    │    │ MCP       │                │
│  │     │    │Bot       │    │  llm    │    │ mcp-client│                │
│  │     │    │telegram  │    │  .ts    │    │ .ts       │                │
│  └─────┘    └──────────┘    └────┬────┘    └─────┬─────┘                │
│                                  │               │                       │
│              ┌───────────────────┘               │                       │
│              │  LLM decides to call tools:        │                       │
│              │                                    │                       │
│              │  ┌─────────────────────────────────▼──────────────────┐   │
│              │  │            MCP SERVER (server.ts)                   │   │
│              │  │                                                     │   │
│              │  │  Call 1: vnexpress_search_news("gold")              │   │
│              │  │    └──► vnexpress.ts → RSS cache/fetch             │   │
│              │  │    └──► Return: 12 articles about gold             │   │
│              │  │                                                     │   │
│              │  │  Call 2: vnexpress_get_article_content(id: "xxx")  │   │
│              │  │    └──► vnexpress.ts → fetch HTML → parse body     │   │
│              │  │    └──► Return: full article text                   │   │
│              │  │                                                     │   │
│              │  │  Call 3: crypto_get_prices("bitcoin")              │   │
│              │  │    └──► crypto.ts → CoinGecko API                  │   │
│              │  │    └──► Return: BTC $67,500 (+2.3%)                │   │
│              │  │                                                     │   │
│              │  │  Call 4: stock_vn_overview()                        │   │
│              │  │    └──► stock.ts → KBS API                         │   │
│              │  │    └──► Return: VN-Index 1285 (+0.4%)              │   │
│              │  └────────────────────────────────────────────────────┘   │
│              │                                                           │
│              │  LLM receives all tool results                             │
│              │  → Analysis: "Gold surges due to Middle East tension..."   │
│              │  → Opinion: "VN-Index may face short-term pressure"       │
│              │  → Forecast + Open questions                               │
│              ▼                                                           │
│  ┌─────┐    ┌──────────┐                                                │
│  │ (7) │◄───│   (6)    │ ◄── (5) LLM final response                    │
│  │User │    │Telegram  │     Split if > 4096 chars                      │
│  │gets │    │Bot reply │     Markdown formatting                        │
│  │the  │    │          │                                                 │
│  │resp │    └──────────┘                                                │
│  └─────┘                                                                 │
│                                                                          │
│  User follows up: "Should I buy gold then?"                              │
│  → LLM remembers context (conversation history)                         │
│  → Provides further analysis without re-calling all tools                │
└──────────────────────────────────────────────────────────────────────────┘
```

#### 3. Module Dependency Graph

```
                        ┌──────────────────┐
                        │   bot-main.ts    │  ← Docker CMD entrypoint
                        │  (Orchestrator)  │
                        └──┬───┬───┬───┬───┘
                           │   │   │   │
               ┌───────────┘   │   │   └───────────┐
               │               │   │               │
        ┌──────▼──────┐  ┌────▼───▼────┐  ┌───────▼───────┐
        │ telegram.ts │  │   llm.ts    │  │  server.ts    │
        │   (Bot UI)  │  │  (AI Brain) │  │ (MCP Server)  │
        └──────┬──────┘  └──────┬──────┘  └──┬────┬────┬──┘
               │                │             │    │    │
               │         ┌──────▼──────┐      │    │    │
               └────────►│mcp-client.ts│◄─────┘    │    │
                         │ (MCP Client)│           │    │
                         └─────────────┘           │    │
                                                   │    │
                    ┌──────────────────────────────┘    │
                    │              │                     │
             ┌──────▼──────┐ ┌────▼─────┐ ┌────────────▼┐
             │vnexpress.ts │ │crypto.ts │ │  stock.ts   │
             │(News Crawl) │ │(CoinGecko│ │ (KBS API)  │
             └──────┬──────┘ └────┬─────┘ └──────┬──────┘
                    │             │               │
                ┌───▼─────────────▼───────────────▼───┐
                │          External APIs               │
                │  VnExpress RSS  CoinGecko  KBS Sec  │
                └─────────────────────────────────────┘


  Dependencies:
  ─────────────
  bot-main.ts    → express, server.ts, llm.ts, telegram.ts, mcp-client.ts
  telegram.ts    → grammy, llm.ts
  llm.ts         → ai (Vercel AI SDK), @ai-sdk/* provider packages, mcp-client.ts
  mcp-client.ts  → @modelcontextprotocol/sdk (Client + StreamableHTTPClientTransport)
  server.ts      → @modelcontextprotocol/sdk (McpServer), zod, vnexpress.ts, crypto.ts, stock.ts
  vnexpress.ts   → axios, cheerio
  crypto.ts      → axios
  stock.ts       → axios
```

#### 4. Caching Architecture

```
┌────────────────────────────────── In-Memory Cache ──────────────────────────────┐
│                                                                                 │
│  ┌─── vnexpress.ts ────────────────────────────────────────────────────────┐   │
│  │                                                                         │   │
│  │  articles: Map<id, NewsArticle>        TTL: 5 min (RSS refresh)        │   │
│  │  ┌─────────┬──────────────────────┬─────────┬──────────┐               │   │
│  │  │ 5055753 │ "Gold surges past $2800" │ the-gioi │ 14:30 │               │   │
│  │  │ 5055801 │ "FED holds interest rate" │ kinh-doanh│ 14:25│               │   │
│  │  │ ...     │ (~200-400 articles)   │          │          │               │   │
│  │  └─────────┴──────────────────────┴─────────┴──────────┘               │   │
│  │                                                                         │   │
│  │  fullContent: Map<id, ArticleDetail>   TTL: 1 hour                     │   │
│  │  ┌─────────┬───────────────────────────────────────────┐               │   │
│  │  │ 5055753 │ { ...article, content: "full text...", author } │           │   │
│  │  │ (fetched on demand, ~5-20 articles cached)          │               │   │
│  │  └─────────┴───────────────────────────────────────────┘               │   │
│  │                                                                         │   │
│  │  categoryLastFetch: Map<category, timestamp>                            │   │
│  │  ┌──────────────┬────────────────┐                                     │   │
│  │  │ tin-moi-nhat │ 1711612345000  │  → stale after 5 min → refetch     │   │
│  │  │ kinh-doanh   │ 1711612200000  │                                     │   │
│  │  └──────────────┴────────────────┘                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─── crypto.ts ───────────────────────────┐                                   │
│  │  prices: Map<coinId, CryptoPrice>       │  TTL: 3 min                       │
│  │  globalData: GlobalCryptoData | null    │  (crypto moves fast)              │
│  │  trending: TrendingCoin[]               │                                   │
│  └─────────────────────────────────────────┘                                   │
│                                                                                 │
│  ┌─── stock.ts ────────────────────────────┐                                   │
│  │  indices: MarketIndex[]                 │  TTL: 5 min                       │
│  │  stockPrices: Map<symbol, StockPrice>   │  (VN market: 9h-15h)             │
│  │  topVolume: TopStock[]                  │                                   │
│  │  foreignFlow: data                      │                                   │
│  │  history: Map<symbol, StockHistory[]>   │                                   │
│  └─────────────────────────────────────────┘                                   │
│                                                                                 │
│  Total estimated memory: ~5-20MB (lightweight, no eviction needed)             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 5. Docker Deployment Architecture

```
┌────────────────────────── VPS (Ubuntu 22.04+) ──────────────────────────────┐
│                                                                              │
│  ┌─────────────────────── Docker Engine ─────────────────────────────────┐  │
│  │                                                                       │  │
│  │  ┌─────────────── docker-compose.yml ──────────────────────────────┐  │  │
│  │  │                                                                 │  │  │
│  │  │  service: news-bot                                              │  │  │
│  │  │  ┌──────────────────────────────────────────────────────────┐   │  │  │
│  │  │  │           Container: vnexpress-news-bot                  │   │  │  │
│  │  │  │           Image: node:22-alpine (~180MB)                 │   │  │  │
│  │  │  │                                                          │   │  │  │
│  │  │  │  ┌────────────────────────────────────────────────────┐  │   │  │  │
│  │  │  │  │  Node.js Process (bot-main.js)                     │  │   │  │  │
│  │  │  │  │  RAM: ~100-200MB                                   │  │   │  │  │
│  │  │  │  │                                                    │  │   │  │  │
│  │  │  │  │  ┌────────────────┐  ┌──────────────────────────┐  │  │   │  │  │
│  │  │  │  │  │ Express :3001  │  │ grammY Bot (long poll)   │  │  │   │  │  │
│  │  │  │  │  │ POST /mcp      │  │ Telegram API connection  │  │  │   │  │  │
│  │  │  │  │  └───────┬────────┘  └───────────┬──────────────┘  │  │   │  │  │
│  │  │  │  │          │ MCP Protocol           │ Bot Messages    │  │   │  │  │
│  │  │  │  │          │ (localhost)             │                 │  │   │  │  │
│  │  │  │  │  ┌───────▼────────┐  ┌───────────▼──────────────┐  │  │   │  │  │
│  │  │  │  │  │ MCP Server     │  │ LLM API Client           │  │  │   │  │  │
│  │  │  │  │  │ 8 tools        │  │ Vercel AI SDK            │  │  │   │  │  │
│  │  │  │  │  │ 4 prompts      │  │ Tool-use loop (maxSteps) │  │  │   │  │  │
│  │  │  │  │  └────────────────┘  └──────────────────────────┘  │  │   │  │  │
│  │  │  │  └────────────────────────────────────────────────────┘  │   │  │  │
│  │  │  │                                                          │   │  │  │
│  │  │  │  ENV: TELEGRAM_BOT_TOKEN (from .env)                     │   │  │  │
│  │  │  │       AI_API_KEY  (from .env)                             │   │  │  │
│  │  │  │       AI_PROVIDER, AI_MODEL (from .env)                   │   │  │  │
│  │  │  │       PORT=3001                                          │   │  │  │
│  │  │  │                                                          │   │  │  │
│  │  │  │  restart: unless-stopped                                 │   │  │  │
│  │  │  │  healthcheck: wget localhost:3001/mcp (30s interval)     │   │  │  │
│  │  │  │  logging: json-file (max 10MB x 3)                      │   │  │  │
│  │  │  └──────────────────────────────────────────────────────────┘   │  │  │
│  │  │                                                                 │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Outbound connections (no inbound ports needed*):                            │
│   ──► api.telegram.org:443      (Bot long-polling)                          │
│   ──► LLM Provider API:443      (OpenAI/Anthropic/Google/etc)               │
│   ──► vnexpress.net:443         (RSS + articles)                            │
│   ──► api.coingecko.com:443     (Crypto data)                               │
│   ──► kbbuddywts.kbsec.com.vn:443 (Stock data)                             │
│                                                                              │
│  *Port 3001 only exposed for optional external MCP access                    │
│                                                                              │
│  VPS Requirements:                                                           │
│  ┌──────────────────────────────────┐                                        │
│  │ OS:   Ubuntu 22.04+ / Debian 12 │                                        │
│  │ RAM:  >= 512MB                   │                                        │
│  │ CPU:  1 vCPU                     │                                        │
│  │ Disk: 5GB                        │                                        │
│  │ Cost: ~$5-10/month              │                                        │
│  └──────────────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 6. MCP Protocol Flow — Tool Registration & Invocation

```
┌─────────────────────── MCP Protocol Detail ───────────────────────────────┐
│                                                                           │
│  STARTUP PHASE (bot-main.ts initialize)                                   │
│  ═══════════════════════════════════════                                   │
│                                                                           │
│  MCP Client                          MCP Server (:3001)                   │
│  ──────────                          ─────────────────                    │
│      │                                    │                               │
│      │──── POST /mcp ────────────────────►│                               │
│      │     { method: "initialize" }       │                               │
│      │◄─── 200 OK ──────────────────────  │                               │
│      │     { serverInfo, capabilities }   │                               │
│      │                                    │                               │
│      │──── POST /mcp ────────────────────►│                               │
│      │     { method: "tools/list" }       │                               │
│      │◄─── 200 OK ──────────────────────  │                               │
│      │     { tools: [                     │                               │
│      │       { name: "vnexpress_get_latest_news",                         │
│      │         description: "...",                                         │
│      │         inputSchema: { type: "object", properties: {...} } },      │
│      │       { name: "vnexpress_search_news", ... },                      │
│      │       { name: "vnexpress_get_article_content", ... },              │
│      │       { name: "crypto_get_overview", ... },                        │
│      │       { name: "crypto_get_prices", ... },                          │
│      │       { name: "stock_vn_overview", ... },                          │
│      │       { name: "stock_get_price", ... },                            │
│      │       { name: "stock_get_history", ... },                          │
│      │     ] }                            │                               │
│      │                                    │                               │
│      │  → Convert to AI SDK CoreTool format│                               │
│      │    for generateText() tool parameter                               │
│      │                                    │                               │
│                                                                           │
│  RUNTIME PHASE (user sends message)                                       │
│  ══════════════════════════════════                                        │
│                                                                           │
│  Telegram    LLM (AI SDK)      MCP Client        MCP Server               │
│  ────────    ─────────         ──────────        ──────────               │
│    │              │                │                  │                    │
│    │──message────►│                │                  │                    │
│    │              │──create()─────►│                  │                    │
│    │              │  (with tools)  │                  │                    │
│    │              │◄──response─────│                  │                    │
│    │              │  stop: tool_use│                  │                    │
│    │              │  tool_use: [   │                  │                    │
│    │              │   {name: "vnexpress_search_news", │                    │
│    │              │    input: {keyword: "gold"}}       │                    │
│    │              │  ]             │                  │                    │
│    │              │                │                  │                    │
│    │              │──callTool()───►│                  │                    │
│    │              │                │──POST /mcp──────►│                    │
│    │              │                │  {method:"tools/call",               │
│    │              │                │   params:{name:"vnexpress_            │
│    │              │                │   search_news",                       │
│    │              │                │   arguments:{keyword:"gold"}}}         │
│    │              │                │                  │                    │
│    │              │                │                  │──► vnexpress.ts    │
│    │              │                │                  │    searchArticles()│
│    │              │                │                  │◄── results         │
│    │              │                │                  │                    │
│    │              │                │◄──200 OK────────│                    │
│    │              │                │  {content:[{type:"text",             │
│    │              │                │   text:"[{title:...}]"}]}            │
│    │              │◄──tool result──│                  │                    │
│    │              │                │                  │                    │
│    │              │──create()─────►│  (with tool results in history)      │
│    │              │◄──response─────│  stop: end_turn                      │
│    │              │  "Gold surges because..."          │                    │
│    │              │                │                  │                    │
│    │◄──reply──────│                │                  │                    │
│    │  (Markdown)  │                │                  │                    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. File List

| File                 | Action     | Description                                                                                                                  |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `package.json`       | **Edit**   | Add dependencies + scripts (`start:bot`, `dev:bot`)                                                                          |
| `.env.example`       | **Create** | Env vars template — safe to commit, no secrets                                                                               |
| `.env`               | **Create** | Actual secrets — gitignored                                                                                                  |
| `.gitignore`         | **Edit**   | Add `.env`                                                                                                                   |
| `.dockerignore`      | **Create** | Exclude node_modules, .env, .git from Docker build context                                                                   |
| `Dockerfile`         | **Create** | Multi-stage build: TS compile → Node production                                                                              |
| `docker-compose.yml` | **Create** | Single service, env_file, restart policy, healthcheck                                                                        |
| `src/vnexpress.ts`   | **Create** | Crawl VnExpress RSS feeds + article content                                                                                  |
| `src/crypto.ts`      | **Create** | CoinGecko API client — crypto prices, trending, global data                                                                  |
| `src/stock.ts`       | **Create** | KBS Vietnam stock API — VN-Index, stock prices, foreign flow                                                                 |
| `src/server.ts`      | **Edit**   | Remove `get_weather`, register 8 MCP tools + 4 MCP prompts                                                                   |
| `src/mcp-client.ts`  | **Create** | MCP Client: connect server, list tools, call tools                                                                           |
| `src/llm.ts`         | **Create** | LLM wrapper (Vercel AI SDK): provider-agnostic tool-use loop, conversation history, `AI_BASE_URL` for OpenAI-compatible APIs |
| `src/telegram.ts`    | **Create** | Telegram Bot (grammY): commands, message handling, access control                                                            |
| `src/bot-main.ts`    | **Create** | Single-process entry: MCP Server + Bot concurrently                                                                          |
| `src/index.ts`       | **Keep**   | Entry point for MCP Server standalone (dev/inspect)                                                                          |

---

## 3. Dependencies

### Install command

```bash
npm install cheerio axios grammy ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google dotenv
npm install -D @types/cheerio
```

> **Note:** All three `@ai-sdk/*` provider packages are installed by default.
> For OpenAI-compatible APIs (Ollama, Groq, Together, etc.), use `AI_PROVIDER=openai` with a custom `AI_BASE_URL`.

### Dependency map

| Package             | Purpose                                              | Version |
| ------------------- | ---------------------------------------------------- | ------- |
| `cheerio`           | Parse HTML/XML (RSS feeds, article pages)            | latest  |
| `axios`             | HTTP client — fetch RSS, articles, API calls         | latest  |
| `grammy`            | Telegram Bot framework                               | latest  |
| `ai`                | Vercel AI SDK — unified LLM interface, tool-use loop | latest  |
| `@ai-sdk/openai`    | OpenAI/GPT provider adapter                          | latest  |
| `@ai-sdk/anthropic` | Anthropic/Claude provider adapter                    | latest  |
| `@ai-sdk/google`    | Google/Gemini provider adapter                       | latest  |
| `dotenv`            | Load .env file                                       | latest  |
| `@types/cheerio`    | TypeScript types (devDep)                            | latest  |

### Retained from current project

- `@modelcontextprotocol/sdk` (^1.20.1) — MCP Server + Client
- `express` (^4.21.2) — HTTP transport for MCP
- `zod` (^3.24.2) — Input schema validation
- TypeScript, ts-node, nodemon (dev)

---

## 4. Environment Variables

### `.env.example` (tracked in git)

```env
TELEGRAM_BOT_TOKEN=

# AI Provider Configuration
# AI_PROVIDER: "openai" | "anthropic" | "google" (default: openai)
# AI_MODEL: model name, e.g. "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.0-flash"
# AI_BASE_URL: (optional) custom endpoint for OpenAI-compatible APIs (Ollama, Groq, Together, etc.)
AI_PROVIDER=openai
AI_MODEL=gpt-4o
AI_API_KEY=
AI_BASE_URL=

MCP_SERVER_URL=http://localhost:3001/mcp
PORT=3001

# Access Control
ADMIN_CHAT_ID=
ALLOWED_CHAT_IDS=
```

### `.env` (gitignored)

```env
TELEGRAM_BOT_TOKEN=7xxxxxx:AAxxxxxxxxxxxxxxxx

AI_PROVIDER=openai
AI_MODEL=gpt-4o
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_BASE_URL=

MCP_SERVER_URL=http://localhost:3001/mcp
PORT=3001

# Access Control — Telegram Chat IDs
# ADMIN_CHAT_ID: Sole owner, has permission for /allow and /block
# ALLOWED_CHAT_IDS: Whitelisted chat IDs allowed to use the bot (comma-separated)
# Leave empty = only admin can use the bot
ADMIN_CHAT_ID=123456789
ALLOWED_CHAT_IDS=123456789,987654321
```

### How to obtain tokens

1. **Telegram Bot Token**: Chat with [@BotFather](https://t.me/BotFather) → `/newbot` → receive token
2. **AI API Key**: Obtain from your provider:
   - OpenAI: [platform.openai.com](https://platform.openai.com) → API Keys
   - Anthropic: [console.anthropic.com](https://console.anthropic.com) → API Keys
   - Google: [aistudio.google.com](https://aistudio.google.com) → API Keys
3. **AI_PROVIDER**: One of `openai`, `anthropic`, `google` (default: `openai`)
4. **AI_MODEL**: Model identifier, e.g. `gpt-4o`, `claude-sonnet-4-20250514`, `gemini-2.0-flash`
5. **AI_BASE_URL** (optional): Custom endpoint for OpenAI-compatible APIs:
   - Ollama: `http://localhost:11434/v1`
   - Groq: `https://api.groq.com/openai/v1`
   - Together: `https://api.together.xyz/v1`

### Switching providers — quick reference

| Provider       | `AI_PROVIDER` | `AI_MODEL`                                     | `AI_BASE_URL`                    |
| -------------- | ------------- | ---------------------------------------------- | -------------------------------- |
| OpenAI         | `openai`      | `gpt-4o`                                       | (empty)                          |
| Anthropic      | `anthropic`   | `claude-sonnet-4-20250514`                     | (empty)                          |
| Google         | `google`      | `gemini-2.0-flash`                             | (empty)                          |
| Ollama (local) | `openai`      | `llama3`                                       | `http://localhost:11434/v1`      |
| Groq           | `openai`      | `llama-3.1-70b-versatile`                      | `https://api.groq.com/openai/v1` |
| Together AI    | `openai`      | `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo` | `https://api.together.xyz/v1`    |

---

## 5. Data Layer — Chi tiết 3 modules

### 5.1. `src/vnexpress.ts` — VnExpress News Crawler

#### Type definitions

```ts
interface NewsArticle {
  id: string; // từ URL, vd: "5055753"
  title: string;
  summary: string; // lead paragraph từ RSS description
  url: string;
  publishedAt: string; // ISO 8601 từ RSS pubDate
  category: string; // "the-gioi" | "kinh-doanh" | ...
  categoryLabel: string; // "Thế giới" | "Kinh doanh" | ...
  thumbnailUrl?: string; // từ RSS enclosure
}

interface ArticleDetail extends NewsArticle {
  content: string; // full article body (paragraphs joined)
  author?: string;
}
```

#### RSS Feed Map

```ts
const RSS_FEEDS: Record<string, { url: string; label: string }> = {
  "tin-moi-nhat": {
    url: "https://vnexpress.net/rss/tin-moi-nhat.rss",
    label: "Tin mới nhất",
  },
  "the-gioi": {
    url: "https://vnexpress.net/rss/the-gioi.rss",
    label: "Thế giới",
  },
  "thoi-su": { url: "https://vnexpress.net/rss/thoi-su.rss", label: "Thời sự" },
  "kinh-doanh": {
    url: "https://vnexpress.net/rss/kinh-doanh.rss",
    label: "Kinh doanh",
  },
  "bat-dong-san": {
    url: "https://vnexpress.net/rss/bat-dong-san.rss",
    label: "Bất động sản",
  },
  "khoa-hoc": {
    url: "https://vnexpress.net/rss/khoa-hoc.rss",
    label: "Khoa học",
  },
  "so-hoa": { url: "https://vnexpress.net/rss/so-hoa.rss", label: "Số hóa" },
  "phap-luat": {
    url: "https://vnexpress.net/rss/phap-luat.rss",
    label: "Pháp luật",
  },
};
```

#### Exported functions

| Function                                      | Input              | Output                          | Mô tả                                                   |
| --------------------------------------------- | ------------------ | ------------------------------- | ------------------------------------------------------- |
| `fetchCategoryFeed(category)`                 | `string`           | `NewsArticle[]`                 | Fetch + parse RSS feed, cache 5 phút                    |
| `fetchArticleContent(url)`                    | `string`           | `ArticleDetail`                 | Fetch HTML, parse body từ `article.fck_detail p.Normal` |
| `searchArticles(keyword, category?)`          | `string, string?`  | `NewsArticle[]`                 | Filter cached articles bằng keyword match               |
| `getMultiCategoryOverview(categories, limit)` | `string[], number` | `Record<string, NewsArticle[]>` | Parallel fetch nhiều categories                         |

#### Crawling strategy

- **Dùng RSS feeds** (không scrape HTML listing) — RSS có cấu trúc XML ổn định, dễ parse
- RSS `<description>` CDATA chứa `<a><img></a></br>Summary text` → strip HTML, lấy text summary
- Full article: parse `article.fck_detail p.Normal` (legacy FCKEditor class, rất ổn định)
- Fallback selectors: `.fck_detail p.Normal` → `.fck_detail p` → `article p`
- Article ID: regex `/(\d+)\.html$/` từ URL

#### Caching

```ts
const CACHE_TTL_RSS = 5 * 60 * 1000; // 5 phút cho RSS feeds
const CACHE_TTL_ARTICLE = 60 * 60 * 1000; // 1 giờ cho full article

const cache = {
  articles: new Map<string, NewsArticle>(), // article ID → article
  fullContent: new Map<string, ArticleDetail>(), // article ID → full content
  categoryLastFetch: new Map<string, number>(), // category → timestamp ms
};
```

#### HTTP config

```ts
const axiosInstance = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; McpNewsBot/1.0)",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.5",
  },
});
```

#### Error handling

- `fetchWithRetry(url, retries=2)` — retry 2 lần, delay 1s giữa mỗi lần
- RSS feed trống → throw error rõ ràng
- Full article fetch fail → trả về cached summary + note "Could not fetch full article"

---

### 5.2. `src/crypto.ts` — CoinGecko Crypto API

#### Base URL: `https://api.coingecko.com/api/v3` (free, no API key)

#### Type definitions

```ts
interface CryptoPrice {
  id: string; // "bitcoin"
  symbol: string; // "btc"
  name: string; // "Bitcoin"
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
}

interface GlobalCryptoData {
  total_market_cap_usd: number;
  total_volume_24h_usd: number;
  btc_dominance: number;
  market_cap_change_percentage_24h: number;
  active_cryptocurrencies: number;
}

interface TrendingCoin {
  name: string;
  symbol: string;
  market_cap_rank: number;
  price_btc: number;
}
```

#### Exported functions

| Function                 | API Endpoint       | Mô tả                                       |
| ------------------------ | ------------------ | ------------------------------------------- |
| `fetchCryptoPrices(ids)` | `/simple/price`    | Giá BTC, ETH, SOL... (USD + VND)            |
| `fetchTopCoins(limit)`   | `/coins/markets`   | Top N coins theo market cap                 |
| `fetchGlobalData()`      | `/global`          | Total market cap, BTC dominance, volume 24h |
| `fetchTrending()`        | `/search/trending` | Top 7 trending coins                        |
| `getCryptoOverview()`    | Tất cả trên        | Tổng hợp: global + top 10 + trending        |

#### Cache: TTL 3 phút (crypto data thay đổi nhanh)

#### Rate limit: CoinGecko free tier = 10-30 requests/min. Cache giúp giữ dưới limit.

---

### 5.3. `src/stock.ts` — KBS Vietnam Stock API

#### Base URLs

```
https://kbbuddywts.kbsec.com.vn/iis-server/investment/...
https://kbbuddywts.kbsec.com.vn/iis-server/sas/...
```

Free, không cần auth.

#### Type definitions

```ts
interface MarketIndex {
  indexName: string; // "VNINDEX" | "HNX" | "UPCOM"
  indexValue: number; // 1285.43
  change: number; // +5.62
  changePercent: number; // +0.44
  totalVolume: number;
  totalValue: number; // tỷ VND
}

interface StockPrice {
  symbol: string; // "VNM"
  price: number; // 72500
  change: number; // -500
  changePercent: number; // -0.68
  volume: number;
  high: number;
  low: number;
  foreignBuy: number;
  foreignSell: number;
}

interface StockHistory {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}
```

#### Exported functions

| Function                          | Mô tả                                           |
| --------------------------------- | ----------------------------------------------- |
| `fetchMarketIndices()`            | VNINDEX, HNX, UPCOM — giá trị, thay đổi, volume |
| `fetchStockPrice(symbol)`         | Giá cổ phiếu cụ thể (VNM, FPT, VIC...)          |
| `fetchTopVolume(limit)`           | Top N cổ phiếu volume cao nhất                  |
| `fetchForeignFlow()`              | Dòng tiền ngoại: mua ròng / bán ròng            |
| `fetchStockHistory(symbol, days)` | Lịch sử giá N ngày gần nhất                     |
| `getVNStockOverview()`            | Tổng hợp: indices + top volume + foreign flow   |

#### Cache: TTL 5 phút (thị trường VN giao dịch 9h-15h, ngoài giờ data ít thay đổi)

---

## 6. MCP Server — Tools & Prompts (`src/server.ts`)

Xóa hoàn toàn `get_weather` tool. Đổi server name → `"vnexpress-finance"`.

### 6.1. Tám (8) MCP Tools

#### News Tools (3)

**Tool: `vnexpress_get_latest_news`**

```
Title: "Get Latest VnExpress News"
Description: "Fetch latest news articles from VnExpress.net by category. Returns titles, summaries, URLs, timestamps."
Input:
  category: z.enum(["tin-moi-nhat","the-gioi","thoi-su","kinh-doanh","bat-dong-san","khoa-hoc","so-hoa","phap-luat"])
            .optional().describe("News category. Default: tin-moi-nhat")
  limit: z.number().min(1).max(50).optional().describe("Max articles. Default: 10")
Handler:
  → fetchCategoryFeed(category ?? "tin-moi-nhat")
  → slice(0, limit ?? 10)
  → return JSON array of {id, title, summary, url, publishedAt, category}
```

**Tool: `vnexpress_search_news`**

```
Title: "Search VnExpress News"
Description: "Search cached VnExpress articles by keyword in titles and summaries."
Input:
  keyword: z.string().describe("Search keyword(s)")
  category: z.enum([...]).optional().describe("Filter by category")
Handler:
  → Đảm bảo cache có data (fetch nếu cần)
  → searchArticles(keyword, category)
  → return top 20 matches
```

**Tool: `vnexpress_get_article_content`**

```
Title: "Get Article Content"
Description: "Fetch full text of a VnExpress article by ID or URL."
Input:
  article_id: z.string().optional().describe("Article ID, e.g. '5055753'")
  url: z.string().optional().describe("Full article URL")
Handler:
  → Validate ít nhất 1 param
  → fetchArticleContent(url hoặc lookup từ cache)
  → return {title, author, publishedAt, content, url}
```

#### Crypto Tools (2)

**Tool: `crypto_get_overview`**

```
Title: "Crypto Market Overview"
Description: "Get crypto market overview: global data, top coins, trending. Data from CoinGecko."
Input: (none)
Handler:
  → getCryptoOverview()
  → return JSON {global, topCoins, trending}
```

**Tool: `crypto_get_prices`**

```
Title: "Crypto Prices"
Description: "Get current prices for specific cryptocurrencies."
Input:
  coins: z.string().describe("Comma-separated coin IDs: bitcoin,ethereum,solana")
Handler:
  → fetchCryptoPrices(coins.split(","))
  → return JSON array of CryptoPrice
```

#### Stock Tools (3)

**Tool: `stock_vn_overview`**

```
Title: "Vietnam Stock Market Overview"
Description: "Get VN stock market overview: VNINDEX, HNX, UPCOM, top volume, foreign flow."
Input: (none)
Handler:
  → getVNStockOverview()
  → return JSON {indices, topVolume, foreignFlow}
```

**Tool: `stock_get_price`**

```
Title: "Stock Price"
Description: "Get current price for a specific stock symbol on HOSE/HNX/UPCOM."
Input:
  symbol: z.string().describe("Stock symbol, e.g. VNM, FPT, VIC")
Handler:
  → fetchStockPrice(symbol.toUpperCase())
  → return JSON StockPrice
```

**Tool: `stock_get_history`**

```
Title: "Stock Price History"
Description: "Get price history for a stock over N days."
Input:
  symbol: z.string().describe("Stock symbol")
  days: z.number().min(1).max(365).optional().describe("Number of days. Default: 30")
Handler:
  → fetchStockHistory(symbol, days ?? 30)
  → return JSON array of StockHistory
```

### 6.2. Bốn (4) MCP Prompts

**Prompt: `analyze_news`**

```
Title: "Analyze News"
Args: topic (string), focus? (enum: geopolitics | economics | financial_markets | social_impact | general)
Returns prompt instructing the LLM to:
  1. Fetch related news using tools (multiple categories)
  2. Read 2-3 full articles
  3. Provide INDEPENDENT analysis — not just summaries
  4. State opinions, forecasts, and open questions
  Format: Overview → Analysis → Impact → Forecast → Open Questions
```

**Prompt: `market_sentiment`**

```
Title: "Market Sentiment Analysis"
Args: market? (enum: crypto | stock | all)
Returns prompt instructing the LLM to:
  1. Fetch crypto (overview) + stock (overview) + news (business)
  2. Analyze sentiment: Fear/Greed, momentum, volume
  3. Compare VN market vs global
  4. Conclusion: Bullish / Bearish / Neutral + confidence level
```

**Prompt: `risk_assessment`**

```
Title: "Risk Assessment"
Args: (none)
Returns prompt instructing the LLM to:
  1. Fetch news from the-gioi + thoi-su + kinh-doanh categories
  2. Fetch crypto global data + VN stock indices
  3. Assess macro risks: war, inflation, FED policy, exchange rates
  4. Risk score 1-10 per sector
  Format: Macro Risks → Sector Risks → Risk Matrix → Recommendations
```

**Prompt: `trading_plan`**

```
Title: "Trading Plan"
Args: market (enum: crypto | stock), timeframe? (enum: day | week | month)
Returns prompt instructing Claude to:
  1. Fetch market data + impactful news
  2. Technical analysis (from history data) + fundamental analysis (from news)
  3. Suggest entry/exit, stop-loss, take-profit
  4. Disclaimer: analysis only, NOT investment advice
```

### 6.3. Error handling in tools

Every tool handler is wrapped in try/catch. On failure, it returns a **structured error response** with `isError: true` so the MCP Client can surface it explicitly:

```ts
async (args) => {
  try {
    const result = await ...;
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      // Error message format: "[TOOL_ERROR] <tool_name>: <reason>"
      // This prefix allows the MCP Client to detect and parse the error
      content: [{ type: "text", text: `[TOOL_ERROR] ${error.message}` }],
      isError: true,  // MCP protocol flag — signals to client that this is a failure
    };
  }
}
```

The `[TOOL_ERROR]` prefix in the message text is a **contract** between MCP Server and MCP Client — it allows `callTool()` to distinguish tool-level errors from legitimate data responses.

---

## 7. MCP Client (`src/mcp-client.ts`)

Connects to MCP Server via HTTP, provides the tool interface for the AI layer.

### ToolCallResult type

`callTool()` no longer returns a plain `string`. It returns a typed result so the caller can distinguish success from failure:

```ts
interface ToolCallResult {
  success: boolean;
  data: string; // response text (on success) or error message (on failure)
  toolName: string; // name of the tool that was called
  errorReason?: string; // human-readable error cause, only present when success=false
}
```

### Class interface

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  success: boolean;
  data: string;
  toolName: string;
  errorReason?: string;
}

class McpClientWrapper {
  private client: Client;

  async connect(): Promise<void>;
  // new Client() → connect(new StreamableHTTPClientTransport("http://localhost:3001/mcp"))

  async getToolDefinitions(): Promise<McpToolDefinition[]>;
  // client.listTools() → convert each tool to a normalized McpToolDefinition:
  // { name, description, inputSchema: { type: "object", properties, required } }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult>;
  // 1. client.callTool({ name, arguments: args })
  // 2. Inspect result.isError:
  //    - false → return { success: true, data: result text, toolName: name }
  //    - true  → parse "[TOOL_ERROR] <reason>" from content text
  //              return { success: false, data: errorMsg, toolName: name, errorReason: reason }
  // 3. Network/HTTP errors are caught and also returned as { success: false, ... }

  async disconnect(): Promise<void>;
  // client.close()
}
```

### callTool() implementation sketch

```ts
async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  try {
    const result = await this.client.callTool({ name, arguments: args });
    const text = result.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .join("\n");

    if (result.isError) {
      // Parse the [TOOL_ERROR] prefix from server
      const errorReason = text.replace(/^\[TOOL_ERROR\]\s*/, "");
      return { success: false, data: text, toolName: name, errorReason };
    }
    return { success: true, data: text, toolName: name };
  } catch (networkError: any) {
    // HTTP/network failure (server down, timeout, etc.)
    return {
      success: false,
      data: networkError.message,
      toolName: name,
      errorReason: `Network error: ${networkError.message}`,
    };
  }
}
```

**Key point** — MCP Client returns raw tool definitions as generic `McpToolDefinition` objects (no Anthropic dependency). The LLM wrapper (`llm.ts`) converts them to AI SDK `CoreTool` format using the `tool()` and `jsonSchema()` functions from `ai`:

```ts
// MCP Server raw format (via McpToolDefinition):
{ name: "vnexpress_get_latest_news", description: "...", inputSchema: { type: "object", properties: {...} } }

// Converted to AI SDK CoreTool (in llm.ts buildTools()):
import { tool, jsonSchema } from "ai";

tools[toolName] = tool({
  description: def.description,
  parameters: jsonSchema(def.inputSchema),
  execute: async (args) => {
    // retry logic + mcpClient.callTool(toolName, args)
  },
});
```

---

## 8. LLM Wrapper (`src/llm.ts`)

Provider-agnostic AI layer using [Vercel AI SDK](https://ai-sdk.dev). Switch models by changing `LLM_PROVIDER` + `LLM_MODEL` in `.env` — no code changes needed.

### Supported providers

| AI_PROVIDER                | Package             | Example AI_MODEL values                                 |
| -------------------------- | ------------------- | ------------------------------------------------------- |
| `openai`                   | `@ai-sdk/openai`    | `gpt-4o`, `gpt-4o-mini`, `o1-preview`                   |
| `anthropic`                | `@ai-sdk/anthropic` | `claude-sonnet-4-20250514`, `claude-3-5-haiku-20241022` |
| `google`                   | `@ai-sdk/google`    | `gemini-2.0-flash`, `gemini-1.5-pro`                    |
| `openai` (+ `AI_BASE_URL`) | `@ai-sdk/openai`    | Any OpenAI-compatible model (Ollama, Groq, Together)    |

### Provider factory

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

export interface LlmConfig {
  provider: "openai" | "anthropic" | "google";
  model: string;
  apiKey: string;
  baseUrl?: string; // optional: for OpenAI-compatible APIs (Ollama, Groq, etc.)
}

function createModel(config: LlmConfig): LanguageModelV1 {
  switch (config.provider) {
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
    case "openai":
    default: {
      // Also works with any OpenAI-compatible API (Ollama, Groq, Together, etc.)
      const provider = createOpenAI({
        apiKey: config.apiKey,
        compatibility: "strict",
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return provider(config.model);
    }
  }
}
```

### Constants

```ts
const TOOL_MAX_RETRIES = 3; // max retry attempts per tool call
const TOOL_RETRY_DELAY_MS = 1000; // 1 second delay between retries
```

### Class interface

```ts
import {
  generateText,
  type LanguageModelV1,
  type CoreMessage,
  type CoreTool,
} from "ai";

class LlmAssistant {
  private model: LanguageModelV1;
  private conversations: Map<string, CoreMessage[]>; // chatId → message history
  private mcpToolDefs: McpToolDefinition[]; // raw MCP tool definitions
  private mcpClient: McpClientWrapper;

  constructor(config: LlmConfig, mcpClient: McpClientWrapper);
  // Creates model instance via createModel(config)

  async initialize(): Promise<void>;
  // 1. mcpClient.connect()
  // 2. Fetch MCP tool definitions
  // 3. Store raw definitions (tools are built per-chat call for notifyUser binding)

  private buildTools(
    notifyUser: (msg: string) => Promise<void>,
  ): Record<string, CoreTool>;
  // Converts McpToolDefinition[] to AI SDK CoreTool format
  // Each tool's execute() callback wraps mcpClient.callTool() with retry logic

  async chat(
    chatId: string,
    userMessage: string,
    notifyUser: (msg: string) => Promise<void> = async () => {},
  ): Promise<string>;
  // See tool-use loop detail below

  clearHistory(chatId: string): void;
  // Clear conversation history for a given chatId

  getHistoryLength(chatId: string): number;
  // Return number of messages in history for a given chatId
}
```

### Tool-use loop — `chat()` detail

The AI SDK's `generateText()` handles the tool-use loop **automatically** via `maxSteps`. No manual while-loop needed:

```ts
async chat(chatId: string, userMessage: string,
  notifyUser: (msg: string) => Promise<void> = async () => {}
): Promise<string> {
  // 1. Get or create conversation history for this chatId
  const history = this.conversations.get(chatId) || [];
  history.push({ role: "user", content: userMessage });

  // 2. Build tools with notifyUser bound into retry logic
  const tools = this.buildTools(notifyUser);

  // 3. Call AI SDK generateText() with automatic tool-use loop:
  const result = await generateText({
    model: this.model,        // any provider: openai/anthropic/google/etc.
    system: SYSTEM_PROMPT,
    messages: history,
    tools,                    // MCP tools converted to CoreTool format
    maxSteps: 10,             // max tool-use round trips before stopping
  });

  // 4. Extract final text
  const finalText = result.text
    || "I was unable to generate a response. Please try again.";

  // 5. Append all response messages (assistant + tool round-trips) to history
  history.push(...(result.response.messages as CoreMessage[]));

  // 6. Trim history if > 20 messages
  const trimmed = history.length > 20 ? history.slice(-20) : history;
  this.conversations.set(chatId, trimmed);

  return finalText;
}
```

**Key difference from manual loop:** The AI SDK `generateText()` with `maxSteps` automatically handles re-invoking the model after tool results. Retry logic for individual tool failures is embedded inside each tool's `execute()` callback in `buildTools()`.

### Retry logic — embedded in `buildTools()` `execute()` callbacks

Each tool's `execute()` function wraps `mcpClient.callTool()` with retry logic and the `notifyUser` callback:

```ts
execute: async (args) => {
  console.log(`[Tool] ${toolName}(${JSON.stringify(args)})`);

  for (let attempt = 1; attempt <= TOOL_MAX_RETRIES; attempt++) {
    const result = await this.mcpClient.callTool(toolName, args);

    if (result.success) {
      if (attempt > 1) {
        await notifyUser(
          `✅ Tool \`${toolName}\` succeeded on attempt ${attempt}.`,
        );
      }
      return result.data;
    }

    if (attempt < TOOL_MAX_RETRIES) {
      await notifyUser(
        `⚠️ Tool \`${toolName}\` failed (attempt ${attempt}/${TOOL_MAX_RETRIES}).\n` +
          `Reason: ${result.errorReason ?? "Unknown error"}.\n` +
          `Retrying in ${TOOL_RETRY_DELAY_MS / 1000}s...`,
      );
      await delay(TOOL_RETRY_DELAY_MS);
    } else {
      await notifyUser(
        `❌ Tool \`${toolName}\` failed after ${TOOL_MAX_RETRIES} attempts.\n` +
          `Reason: ${result.errorReason ?? "Unknown error"}.`,
      );
    }
  }

  return `[TOOL_ERROR] ${toolName} failed after ${TOOL_MAX_RETRIES} retries`;
};
```

### Retry flow diagram

```
chat() calls callToolWithRetry("crypto_get_prices", {coins: "bitcoin"})
  │
  ├─ Attempt 1: FAIL (CoinGecko timeout)
  │    → notifyUser: "⚠️ Tool `crypto_get_prices` failed (attempt 1/3). Reason: timeout. Retrying in 1s..."
  │    → wait 1000ms
  │
  ├─ Attempt 2: FAIL (still timeout)
  │    → notifyUser: "⚠️ Tool `crypto_get_prices` failed (attempt 2/3). Reason: timeout. Retrying in 1s..."
  │    → wait 1000ms
  │
  ├─ Attempt 3: SUCCESS
  │    → notifyUser: "✅ Tool `crypto_get_prices` succeeded on attempt 3."
  │    → return { success: true, data: "BTC $67,500 (+2.3%)..." }
  │
  └─ LLM receives data → continues analysis → sends final answer to user

---

chat() calls callToolWithRetry("stock_vn_overview", {})
  │
  ├─ Attempt 1: FAIL (KBS API down)
  ├─ Attempt 2: FAIL
  ├─ Attempt 3: FAIL
  │    → notifyUser: "❌ Tool `stock_vn_overview` failed after 3 attempts. Reason: KBS API unavailable. Please try again later."
  │    → return { success: false, ... }
  │
  └─ Error result appended to LLM history as tool_result (is_error: true)
     → LLM responds: "I was unable to fetch VN stock data (service unavailable).
        Here is the analysis based on available crypto data only..."
```

### notifyUser callback

The `notifyUser` callback is injected by `telegram.ts` when calling `llm.chat()`, so retry notifications are sent **in real-time** during the tool-use loop — not batched at the end.

```ts
// In telegram.ts:
const notifyUser = async (msg: string) => {
  await ctx.reply(msg); // interim message, no Markdown parsing needed
};
const response = await this.llm.chat(chatId, text, notifyUser);
```

This means the `chat()` signature is:

```ts
async chat(
  chatId: string,
  userMessage: string,
  notifyUser: (msg: string) => Promise<void> = async () => {}
): Promise<string>
```

The default no-op allows `chat()` to be called without a notify callback (e.g. in tests).

### System Prompt

```
You are a professional, independent financial and current affairs analyst.

PRINCIPLES:
- Always use tools to fetch real data before analyzing
- Provide INDEPENDENT opinions — do not just summarize news
- Multi-dimensional analysis: politics, economics, society, markets
- When analyzing markets, combine news + real data from tools
- Clearly state confidence levels and assumptions
- Respond in the same language the user is using (Vietnamese / English)

DISCLAIMER: All analysis represents personal opinions, not investment advice.
When uncertain, clearly state "I do not have enough data to conclude."
```

---

## 9. Telegram Bot (`src/telegram.ts`)

```ts
import { Bot, Context } from "grammy";

class TelegramNewsBot {
  private bot: Bot;
  private llm: LlmAssistant;
  private adminChatId: string; // Sole owner
  private allowedChatIds: Set<string>; // Whitelisted user IDs

  constructor(token: string, llm: LlmAssistant);

  setupAccessControl(): void;
  // Access control middleware

  setupCommands(): void;
  // Register all command handlers (including admin commands)

  start(): Promise<void>;
  // bot.start() → long polling
}
```

### 9.1. Access Control — Cơ chế phân quyền

#### Thiết kế

Bot chỉ phục vụ **cá nhân** và **một số người được share**. Cơ chế:

| Role              | Quyền                                                 | Cách xác thực                                            |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| **Admin** (owner) | Toàn quyền: dùng bot + `/allow` + `/block` + `/users` | `ADMIN_CHAT_ID` trong `.env`                             |
| **Allowed user**  | Dùng bot bình thường (tất cả commands + free text)    | Được admin `/allow` hoặc define trong `ALLOWED_CHAT_IDS` |
| **Unknown user**  | Bị từ chối, nhận thông báo "Unauthorized"             | Mọi người khác                                           |

#### Lưu trữ danh sách user

```ts
// Initialize from environment variables
const adminChatId = process.env.ADMIN_CHAT_ID || "";
const allowedChatIds = new Set<string>(
  (process.env.ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

// Admin is always allowed
if (adminChatId) allowedChatIds.add(adminChatId);
```

**Lưu ý:** Danh sách `allowedChatIds` được lưu **in-memory** (Set). Khi container restart, chỉ giữ lại những user trong `.env`. Các user được `/allow` runtime sẽ mất. Đây là trade-off chấp nhận được cho bot cá nhân — nếu cần persist, có thể lưu ra file JSON sau.

#### Middleware kiểm tra quyền

```ts
setupAccessControl(): void {
  // Middleware runs BEFORE all handlers
  this.bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    // Admin always allowed
    if (chatId === this.adminChatId) {
      return next();
    }

    // Whitelisted users allowed
    if (this.allowedChatIds.has(chatId)) {
      return next();
    }

    // Reject — notify user
    await ctx.reply(
      "⛔ This bot is private. Access restricted.\n" +
      "Contact admin for access.\n" +
      `Your Chat ID: \`${chatId}\``
    );

    // Notify admin (optional — know who tried to access)
    if (this.adminChatId) {
      const userName = ctx.from?.username || ctx.from?.first_name || "Unknown";
      await this.bot.api.sendMessage(
        this.adminChatId,
        `🔔 Unauthorized access attempt:\n` +
        `User: ${userName}\nChat ID: \`${chatId}\`\n` +
        `Use /allow ${chatId} to grant access.`
      );
    }
  });
}
```

#### Admin commands

```ts
// /allow <chat_id> — Add user to whitelist
bot.command("allow", async (ctx) => {
  if (ctx.chat.id.toString() !== this.adminChatId) return;
  const targetId = ctx.match?.trim();
  if (!targetId) return ctx.reply("Usage: /allow <chat_id>");

  this.allowedChatIds.add(targetId);
  await ctx.reply(`✅ Added ${targetId} to whitelist.`);

  // Notify the allowed user
  try {
    await this.bot.api.sendMessage(
      targetId,
      "🎉 You have been granted access to the bot!",
    );
  } catch {
    /* user hasn't started the bot yet */
  }
});

// /block <chat_id> — Remove user from whitelist
bot.command("block", async (ctx) => {
  if (ctx.chat.id.toString() !== this.adminChatId) return;
  const targetId = ctx.match?.trim();
  if (!targetId) return ctx.reply("Usage: /block <chat_id>");

  this.allowedChatIds.delete(targetId);
  await ctx.reply(`🚫 Removed ${targetId} from whitelist.`);
});

// /users — List current whitelist
bot.command("users", async (ctx) => {
  if (ctx.chat.id.toString() !== this.adminChatId) return;
  const list = [...this.allowedChatIds]
    .map((id) => (id === this.adminChatId ? `${id} (admin)` : id))
    .join("\n");
  await ctx.reply(`📋 Allowed users:\n${list || "(empty)"}`);
});
```

#### Flow minh hoạ

```
User lạ gửi message → Middleware chặn → Reply "⛔ Unauthorized"
                                        → Notify admin: "🔔 User X cố truy cập"

Admin gõ: /allow 555666777 → Set.add("555666777") → Bot gửi "🎉" cho user đó

User 555666777 gửi message → Middleware check Set → ✅ Pass → Handler xử lý bình thường

Admin gõ: /block 555666777 → Set.delete("555666777") → User bị chặn từ message tiếp theo
```

### 9.2. Commands

| Command                      | Mô tả                       | Claude nhận được                                               |
| ---------------------------- | --------------------------- | -------------------------------------------------------------- |
| `/start`                     | Welcome + hướng dẫn sử dụng | (hard-coded, không gọi Claude)                                 |
| `/news [topic]`              | Tin tức mới nhất            | "Hãy lấy tin tức mới nhất {topic} và phân tích"                |
| `/market`                    | Tổng quan thị trường        | "Cho tôi tổng quan thị trường crypto + chứng khoán VN hôm nay" |
| `/sentiment [crypto\|stock]` | Phân tích tâm lý            | "Phân tích sentiment thị trường {market}"                      |
| `/risk`                      | Đánh giá rủi ro vĩ mô       | "Đánh giá rủi ro vĩ mô hiện tại, risk score"                   |
| `/plan [crypto\|stock]`      | Trading plan                | "Đề xuất trading plan cho {market}"                            |
| `/reset`                     | Xóa history                 | claude.clearHistory(chatId)                                    |
| `/allow <id>`                | 🔒 Admin: thêm user         | allowedChatIds.add(id)                                         |
| `/block <id>`                | 🔒 Admin: xóa user          | allowedChatIds.delete(id)                                      |
| `/users`                     | 🔒 Admin: xem whitelist     | Liệt kê allowed IDs                                            |
| Free text                    | Hỏi đáp tự do               | Gửi thẳng message tới Claude                                   |

### 9.3. Message handling

```ts
// Handle all text messages (including parsed commands)
bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const text = ctx.message.text;

  // Typing indicator (Claude + tools có thể mất 10-30s)
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing");
  }, 4000);

  try {
    const response = await this.llm.chat(chatId, text);
    clearInterval(typingInterval);

    // Split response nếu > 4096 chars (Telegram limit)
    await this.sendLongMessage(ctx, response);
  } catch (error) {
    clearInterval(typingInterval);
    await ctx.reply("⚠️ An error occurred. Please try again later.");
  }
});
```

### 9.4. Send long message helper — Markdown-safe

Claude trả về Markdown tự do, nhưng Telegram Markdown parser rất strict —
ký tự `_`, `*`, `[`, `)` không đúng cặp sẽ gây crash. Giải pháp: **try Markdown → fallback plain text**.

```ts
/**
 * Gửi message dài với Markdown formatting.
 * Nếu Telegram parse Markdown lỗi → tự động fallback sang plain text.
 */
async sendLongMessage(ctx: Context, text: string): Promise<void> {
  const MAX_LENGTH = 4096;
  const chunks = text.length <= MAX_LENGTH
    ? [text]
    : splitByParagraphs(text, MAX_LENGTH);

  for (const chunk of chunks) {
    await this.safeSendMarkdown(ctx, chunk);
  }
}

/**
 * Try Markdown → fallback plain text nếu parse lỗi.
 */
private async safeSendMarkdown(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (error: any) {
    // Telegram trả 400 Bad Request nếu Markdown syntax sai
    if (error?.description?.includes("can't parse entities")) {
      // Fallback: gửi plain text (không format)
      await ctx.reply(text);
    } else {
      throw error; // Re-throw nếu lỗi khác (network, etc.)
    }
  }
}
```

---

## 10. Entry Point (`src/bot-main.ts`)

```ts
import "dotenv/config";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server"; // factory function instead of singleton
import { McpClientWrapper } from "./mcp-client";
import { LlmAssistant, type LlmConfig } from "./llm";
import { TelegramNewsBot } from "./telegram";

function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

async function main() {
  // ---- 1. Validate env & configure AI ----
  const telegramToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const aiApiKey = requireEnv("AI_API_KEY");
  const aiProvider = (process.env.AI_PROVIDER?.trim() ||
    "openai") as LlmConfig["provider"];
  const aiModel = process.env.AI_MODEL?.trim() || "gpt-4o";
  const aiBaseUrl = process.env.AI_BASE_URL?.trim() || undefined;
  const mcpServerUrl =
    process.env.MCP_SERVER_URL ?? "http://localhost:3001/mcp";
  const port = parseInt(process.env.PORT ?? "3001", 10);

  console.log(`AI Provider: ${aiProvider}, Model: ${aiModel}`);

  // ---- 2. Start MCP Server ----
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const mcpServer = createServer();
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const httpServer = app.listen(port);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  console.log(`MCP Server running at http://localhost:${port}/mcp`);

  // ---- 3. Initialize LLM + MCP Client ----
  await new Promise((r) => setTimeout(r, 300));

  const mcpClient = new McpClientWrapper(mcpServerUrl);
  const llm = new LlmAssistant(
    {
      provider: aiProvider,
      model: aiModel,
      apiKey: aiApiKey,
      baseUrl: aiBaseUrl,
    },
    mcpClient,
  );
  await llm.initialize();
  console.log("LLM Assistant initialized");

  // ---- 4. Start Telegram Bot ----
  const bot = new TelegramNewsBot(telegramToken, llm);
  await bot.start();

  // ---- 5. Graceful Shutdown ----
  const shutdown = async () => {
    console.log("Shutting down...");
    bot.stop();
    await mcpClient.disconnect();
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

**Note on `server.ts` change:** Export `createServer()` factory function instead of a singleton:

```ts
// server.ts — updated export
export function createServer(): McpServer {
  const server = new McpServer({ name: "vnexpress-finance", version: "1.0.0" });
  // ... register 8 tools + 4 prompts ...
  return server;
}
```

### Additional package.json scripts

```json
{
  "scripts": {
    "dev:bot": "nodemon --exec node --signal SIGINT -r ts-node/register ./src/bot-main.ts",
    "start:bot": "node ./lib/src/bot-main.js"
  }
}
```

---

## 11. Docker Deployment

### 11.0. `.dockerignore`

Tránh copy file không cần thiết vào Docker build context (tăng tốc build + bảo mật):

```
node_modules
npm-debug.log*
.env
.git
.gitignore
lib
*.md
.vscode
.idea
```

**Tại sao quan trọng:**

- `node_modules/` — Docker sẽ `npm ci` lại, copy vào chỉ tốn thời gian (có thể hàng trăm MB)
- `.env` — chứa secrets, KHÔNG được bake vào Docker image
- `.git/` — lịch sử git có thể rất lớn, không cần trong container

### 11.1. `Dockerfile`

```dockerfile
# ===== Stage 1: Build =====
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ===== Stage 2: Production =====
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/lib ./lib

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -q --spider http://localhost:3001/mcp || exit 1

CMD ["node", "lib/src/bot-main.js"]
```

**Giải thích:**

- **Multi-stage build**: Stage 1 có TypeScript compiler (devDeps), Stage 2 chỉ runtime
- **node:22-alpine**: Image nhỏ (~180MB final vs ~900MB full node image)
- **npm ci --omit=dev**: Chỉ install production dependencies
- **HEALTHCHECK**: Docker tự kiểm tra MCP Server mỗi 30s, restart nếu fail 3 lần

### 11.2. `docker-compose.yml`

```yaml
version: "3.8"

services:
  news-bot:
    build: .
    container_name: vnexpress-news-bot
    restart: unless-stopped
    env_file: .env
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/mcp"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

**Giải thích:**

- `restart: unless-stopped` — tự restart nếu crash, trừ khi user stop thủ công
- `env_file: .env` — load secrets từ file (không hard-code trong compose)
- `logging` — giới hạn log size (10MB x 3 files = max 30MB)
- `ports` — expose MCP Server (optional, bỏ nếu không cần access từ ngoài)

### 11.3. Deploy lên VPS

#### Yêu cầu VPS

- OS: Ubuntu 22.04+ / Debian 12+
- RAM: >= 512MB (Node process ~100-200MB)
- CPU: 1 vCPU đủ
- Docker + Docker Compose installed
- Chi phí: ~$5-10/tháng (DigitalOcean, Vultr, Hetzner...)

#### Các bước deploy

```bash
# 1. SSH vào VPS
ssh user@your-vps-ip

# 2. Clone repo
git clone <your-repo-url>
cd McpTest

# 3. Tạo .env từ template
cp .env.example .env
nano .env   # paste real TELEGRAM_BOT_TOKEN + LLM_API_KEY

# 4. Build & chạy
docker compose up -d --build

# 5. Kiểm tra
docker compose ps          # STATUS: healthy
docker compose logs -f     # xem logs real-time
```

#### Quản lý hàng ngày

```bash
# Xem logs
docker compose logs -f news-bot

# Restart
docker compose restart

# Stop
docker compose down

# Update code & redeploy
git pull && docker compose up -d --build

# Xem resource usage
docker stats vnexpress-news-bot
```

---

## 12. Implementation Order (step-by-step)

| #   | Task              | File(s)                                             | Description                                                                                                      |
| --- | ----------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Install deps      | `package.json`                                      | `npm install cheerio axios grammy ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google dotenv`                     |
| 2   | Env setup         | `.env.example`, `.env`, `.gitignore`                | Template + secrets + gitignore (including AI_PROVIDER/AI_MODEL/AI_BASE_URL/access control vars)                  |
| 3   | VnExpress crawler | `src/vnexpress.ts`                                  | RSS parsing, article fetching, cache, search                                                                     |
| 4   | CoinGecko client  | `src/crypto.ts`                                     | Crypto prices, global data, trending                                                                             |
| 5   | KBS stock client  | `src/stock.ts`                                      | VN-Index, stock prices, foreign flow, history                                                                    |
| 6   | MCP Server        | `src/server.ts`                                     | Remove get_weather, export `createServer()` factory, register 8 tools + 4 prompts                                |
| 7   | MCP Client        | `src/mcp-client.ts`                                 | Connect, listTools, callTool with ToolCallResult (no Anthropic dependency)                                       |
| 8   | LLM wrapper       | `src/llm.ts`                                        | Provider factory (LlmConfig), AI SDK generateText() loop, conversation history, retry logic, AI_BASE_URL support |
| 9   | Telegram bot      | `src/telegram.ts`                                   | Access control middleware + commands + Markdown-safe messaging                                                   |
| 10  | Entry point       | `src/bot-main.ts`                                   | Single process: MCP Server (factory pattern) + Bot                                                               |
| 11  | Docker            | `.dockerignore`, `Dockerfile`, `docker-compose.yml` | dockerignore + multi-stage build + healthcheck                                                                   |
| 12  | Test & verify     | —                                                   | Local dev → Docker → deploy VPS                                                                                  |

---

## 13. Verification Checklist

### MCP Server

- [ ] `npm run dev:http` → server starts on http://localhost:3001/mcp
- [ ] MCP Inspector: all 8 tools appear correctly
- [ ] MCP Inspector: all 4 prompts appear correctly
- [ ] `vnexpress_get_latest_news` → returns 10 latest articles (JSON)
- [ ] `vnexpress_search_news` keyword "bitcoin" → returns matching articles
- [ ] `vnexpress_get_article_content` → returns full article body
- [ ] `crypto_get_overview` → returns global data + top coins
- [ ] `stock_vn_overview` → returns VNINDEX + top volume
- [ ] Tool error: invalid category or missing URL → returns `isError: true` with `[TOOL_ERROR]` prefix

### Tool Retry & Error Notification

- [ ] Tool fails once → user receives interim message: "⚠️ Tool `X` failed (attempt 1/3). Reason: ... Retrying in 1s..."
- [ ] Tool succeeds on retry (e.g. attempt 2) → user receives: "✅ Tool `X` succeeded on attempt 2."
- [ ] Tool fails all 3 attempts → user receives: "❌ Tool `X` failed after 3 attempts. Reason: ... Please try again later."
- [ ] After max retries failure, Claude still responds using available data (partial analysis, not silence)
- [ ] Multiple tools called in same turn — each tracked and retried independently
- [ ] `notifyUser` callback sends interim messages in real-time (not batched)
- [ ] `chat()` called without `notifyUser` (e.g. in tests) → no crash (default no-op)

### Telegram Bot

- [ ] `/start` → nhận welcome message + hướng dẫn
- [ ] `/news` → Claude gọi tools → phân tích tin tức + quan điểm
- [ ] `/market` → tổng quan crypto + chứng khoán VN
- [ ] `/sentiment crypto` → sentiment analysis
- [ ] `/risk` → risk assessment + risk score
- [ ] `/plan crypto` → trading plan recommendations
- [ ] Free text "Vàng tăng giá vì sao?" → Claude search + phân tích
- [ ] Hỏi tiếp "Vậy nên mua không?" → Claude nhớ context (conversation history)
- [ ] `/reset` → xóa history, bắt đầu mới
- [ ] Response > 4096 chars → tự split thành nhiều Telegram messages
- [ ] Markdown lỗi → tự fallback sang plain text (không crash)
- [ ] Bot crash → tự khởi động lại (không mất conversation)

### Access Control

- [ ] Unknown user gửi message → nhận "⛔ Unauthorized" + admin được notify
- [ ] Admin `/allow <chat_id>` → user được thêm vào whitelist
- [ ] Admin `/block <chat_id>` → user bị xóa khỏi whitelist
- [ ] Admin `/users` → liệt kê tất cả allowed user IDs
- [ ] Allowed user dùng bot bình thường
- [ ] Chỉ admin mới thấy/dùng được `/allow`, `/block`, `/users`

### Docker

- [ ] `docker compose up -d --build` → build thành công
- [ ] `docker compose ps` → STATUS: healthy
- [ ] Container crash → tự restart (test: `docker kill vnexpress-news-bot`)
- [ ] Logs rotated: max 10MB x 3 files
- [ ] `docker stats` → RAM < 300MB
