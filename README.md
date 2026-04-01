# BietTuotBot — Telegram Chatbot Phân Tích Tin Tức & Tài Chính

Bot Telegram thông minh tích hợp AI để phân tích tin tức, thị trường chứng khoán Việt Nam và thị trường crypto. Tổng hợp dữ liệu từ 6 nguồn (VnExpress, CafeF, KBS Securities, CoinGecko, cryptocurrency.cv, ThuanCapital) qua 20 MCP tools. Hỗ trợ mọi LLM provider (OpenAI, Anthropic, Google Gemini, Ollama v.v...) với 2 chế độ AI (chat nhanh + reasoner phân tích sâu).

---

## Tính năng

- **Tin tức thời sự**: Crawl RSS từ VnExpress (thế giới, kinh doanh, thời sự, bất động sản, pháp luật...)
- **Tin tức tài chính**: Tin vĩ mô, chứng khoán, ngân hàng, quốc tế, vàng/hàng hóa từ CafeF
- **Phân tích sâu**: AI đọc nội dung full bài viết từ nhiều nguồn, đưa ra nhận định độc lập đa chiều
- **Crypto market**: Giá BTC/ETH/SOL... theo thời gian thực, phân tích kỹ thuật (RSI/MACD/SMA/EMA/ATH/ATL) từ CoinGecko
- **Crypto news**: Tin crypto quốc tế (200+ nguồn EN) + tin & kiến thức crypto tiếng Việt từ ThuanCapital
- **Chứng khoán VN**: VNINDEX, HNX, UPCOM, giá cổ phiếu, dòng tiền ngoại, profile công ty, giao dịch nội bộ, chỉ số tài chính từ KBS Securities + CafeF
- **Phân tích kỹ thuật cổ phiếu**: SMA/EMA/RSI/MACD/ATH/ATL tính tự động từ dữ liệu OHLCV
- **2 chế độ AI**: Chat mode (nhanh, data-forward) + Reasoner mode (phân tích sâu, đa chiều, nhận định độc lập)
- **Hội thoại liên tục**: Nhớ ngữ cảnh theo từng chat — có thể hỏi tiếp mà không cần giải thích lại
- **Đa provider LLM**: Đổi model chỉ cần sửa biến môi trường, không cần thay code
- **Access control**: Quản lý whitelist user, admin có thể /allow và /block trực tiếp trên Telegram

### Lệnh bot

| Lệnh                    | Mô tả                                             |
| ----------------------- | ------------------------------------------------- |
| `/news [chủ đề]`        | Tin tức mới nhất, có thể lọc theo chủ đề          |
| `/market`               | Tổng quan thị trường: crypto + chứng khoán VN     |
| `/plan [crypto\|stock]` | Gợi ý trading plan có phân tích kỹ thuật + cơ bản |
| `/analysis [chủ đề]`    | 🧠 Phân tích chuyên sâu (reasoner mode)           |
| `/status`               | Thông tin bot: model, chat ID, lịch sử hội thoại  |
| `/reset`                | Xóa lịch sử hội thoại                             |
| `/allow <chat_id>`      | _(Admin)_ Cấp quyền truy cập cho user             |
| `/block <chat_id>`      | _(Admin)_ Thu hồi quyền truy cập                  |
| `/users`                | _(Admin)_ Danh sách user được phép                |
| Tin nhắn tự do          | Hỏi bất cứ điều gì về tin tức / tài chính         |

> Tin nhắn chứa từ khóa "phân tích", "tại sao", "xu hướng"... tự động chuyển sang reasoner mode.

---

## Kiến trúc

Toàn bộ hệ thống chạy trong **một Node.js process duy nhất**:

```
User (Telegram App)
        │ HTTPS long-polling
        ▼
┌──────────────────────────────────── Process ────────────────────────────────────┐
│                                                                                 │
│   bot-main.ts (Orchestrator)                                                    │
│        │                │                      │                                │
│  telegram.ts       llm.ts                   server.ts                           │
│  (grammY Bot)   (Vercel AI SDK)           (MCP Server)                          │
│                   │    │                    :3001/mcp                            │
│            chat mode  reasoner      ┌─────┬────┼────┬──────┐                    │
│                   │   mode         vnexpress cafef crypto  stock                 │
│               mcp-client.ts        .ts     .ts   .ts     .ts                    │
│               (MCP Client)                  crypto-news.ts                      │
└─────────────────────────────────────────────────────────────────────────────────┘
        │              │              │             │              │
   LLM Provider   VnExpress RSS   CafeF HTML    CoinGecko     KBS Securities
   API             + Article      Scraping       API           API
                                    │
                            cryptocurrency.cv RSS
                            ThuanCapital HTML
```

**Luồng xử lý một tin nhắn:**

1. User gửi tin → `telegram.ts` nhận, auto-detect mode (chat/reasoner) theo từ khóa
2. `llm.ts` gọi `generateText()` với system prompt tương ứng + danh sách 20 MCP tools
3. AI tự quyết định cần gọi tool nào (tìm tin VnExpress/CafeF, giá crypto, giá cổ phiếu, tin crypto...)
4. `mcp-client.ts` forward tool call → `server.ts` qua HTTP (StreamableHTTP)
5. `server.ts` dispatch đến module tương ứng → trả kết quả (có cache + retry)
6. AI tổng hợp kết quả từ nhiều tool → sinh phản hồi cuối (có disclaimer)
7. `telegram.ts` gửi lại User (tự động split nếu > 4096 ký tự, Markdown formatting)

### 20 MCP Tools

| Nhóm            | Tool                            | Mô tả                                                                      |
| --------------- | ------------------------------- | -------------------------------------------------------------------------- |
| **VnExpress**   | `vnexpress_get_latest_news`     | Tin mới nhất theo chuyên mục (8 categories)                                |
|                 | `vnexpress_search_news`         | Tìm kiếm bài viết theo keyword                                             |
|                 | `vnexpress_get_article_content` | Đọc nội dung full bài viết                                                 |
| **Crypto**      | `crypto_get_overview`           | Tổng quan thị trường: market cap, BTC dominance, top 10, trending          |
|                 | `crypto_get_prices`             | Giá realtime cho list coin cụ thể                                          |
|                 | `crypto_get_technical`          | Phân tích kỹ thuật: RSI, SMA, EMA, MACD, ATH/ATL                           |
| **Crypto News** | `cryptocurrency_get_news`       | Tin crypto EN từ 200+ nguồn quốc tế                                        |
|                 | `thuancapital_get_news`         | Tin crypto VN: tin-tuc (tin/phân tích) hoặc kien-thuc (kiến thức/giáo dục) |
|                 | `thuancapital_get_article`      | Đọc full bài viết ThuanCapital                                             |
| **Stock VN**    | `stock_vn_overview`             | Top khối lượng + dòng tiền ngoại                                           |
|                 | `stock_get_ohlcv`               | OHLCV lịch sử (1 mã, N ngày)                                               |
|                 | `stock_get_index`               | OHLCV index (VNINDEX/HNX/UPCOM/VN30)                                       |
|                 | `stock_price_board`             | Bảng giá realtime nhiều mã cùng lúc                                        |
|                 | `stock_get_profile`             | Profile công ty: ngành, sàn, vốn, mô tả                                    |
|                 | `stock_get_technical`           | Phân tích kỹ thuật: SMA/EMA/RSI/MACD/ATH/ATL                               |
| **CafeF**       | `cafef_get_macro_news`          | Tin vĩ mô: chứng khoán, vĩ mô, quốc tế, vàng/hàng hóa, ngân hàng           |
|                 | `cafef_get_article_content`     | Đọc full bài viết CafeF                                                    |
|                 | `cafef_get_company_news`        | Tin tức & sự kiện công ty                                                  |
|                 | `cafef_get_insider_trading`     | Giao dịch cổ đông nội bộ & lớn                                             |
|                 | `cafef_get_financials`          | Chỉ số tài chính: EPS, P/E, P/B, vốn hóa                                   |

---

## Onboarding — Chạy từ đầu

### Yêu cầu

- **Node.js** >= 18 (khuyến nghị v22)
- **npm** >= 8
- Telegram Bot Token (lấy từ [@BotFather](https://t.me/BotFather))
- API key của LLM provider (OpenAI / Anthropic / Google / Groq / Ollama...)

### Bước 1 — Clone và cài dependencies

```bash
git clone <repo-url>
cd biettuotbot
npm install
```

### Bước 2 — Tạo file `.env`

Tạo file `.env` từ template:

```bash
cp .env.example .env
```

Mở `.env` và điền thông tin:

```env
# Telegram
TELEGRAM_BOT_TOKEN=7xxxxxx:AAxxxxxxxxxxxxxxxx

# LLM Provider — Chat mode (chọn 1 trong các provider bên dưới)
AI_PROVIDER=openai
AI_MODEL=gpt-4o
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_BASE_URL=

# LLM Provider — Reasoner mode (tuỳ chọn, nếu muốn dùng model khác cho phân tích sâu)
AI_REASONER_MODEL=
AI_REASONER_API_KEY=
AI_REASONER_BASE_URL=

# MCP Server
MCP_SERVER_URL=http://localhost:3001/mcp
PORT=3001

# Telegram Access Control
# ADMIN_CHAT_ID: chat ID của bạn (dùng @userinfobot để lấy)
# ALLOWED_CHAT_IDS: danh sách chat ID được phép dùng bot (phân cách bằng dấu phẩy)
ADMIN_CHAT_ID=123456789
ALLOWED_CHAT_IDS=123456789
```

**Lấy Telegram Chat ID:** Mở [@userinfobot](https://t.me/userinfobot) trên Telegram → gửi `/start` → bot trả về chat ID của bạn.

### Bước 3 — Chọn LLM provider

Sửa 3 biến `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` trong `.env`:

| Provider                 | AI_PROVIDER | AI_MODEL                   | AI_BASE_URL                      |
| ------------------------ | ----------- | -------------------------- | -------------------------------- |
| OpenAI                   | `openai`    | `gpt-4o`                   | _(để trống)_                     |
| Anthropic                | `anthropic` | `claude-sonnet-4-20250514` | _(để trống)_                     |
| Google Gemini            | `google`    | `gemini-2.0-flash`         | _(để trống)_                     |
| DeepSeek                 | `openai`    | `deepseek-chat`            | `https://api.deepseek.com`       |
| DeepSeek V3.2 + Thinking | `openai`    | `deepseek-reasoner`        | `https://api.deepseek.com`       |
| Groq (miễn phí)          | `openai`    | `llama-3.1-70b-versatile`  | `https://api.groq.com/openai/v1` |
| Ollama (local)           | `openai`    | `llama3`                   | `http://localhost:11434/v1`      |

> **Tip:** Có thể dùng model nhanh (DeepSeek Chat / GPT-4o) cho chat mode và model mạnh hơn (DeepSeek Reasoner / Claude) cho reasoner mode bằng cách cấu hình `AI_REASONER_MODEL`, `AI_REASONER_API_KEY`, `AI_REASONER_BASE_URL`.

### Bước 4 — Build và chạy

**Chạy development (có hot-reload):**

```bash
npm run build       # compile TypeScript → lib/
npm run dev:bot     # chạy bot (nodemon)
```

**Hoặc chạy production:**

```bash
npm run build
npm run start:bot
```

Khi thấy log:

```
MCP server started on port 3001
Loaded 20 MCP tools
Telegram bot started
```

→ Bot đã sẵn sàng. Mở Telegram, tìm bot của bạn, gửi `/start`.

### Bước 5 — Kiểm tra

Gửi thử các lệnh trong Telegram:

```
/market                              → tổng quan thị trường
/news vàng                           → tin tức về vàng
/analysis Bitcoin                    → phân tích chuyên sâu (reasoner mode)
/plan crypto                         → trading plan crypto
/status                              → xem model đang dùng, chat ID
Tại sao Bitcoin tăng mạnh hôm nay?   → câu hỏi tự do (auto reasoner mode)
FPT đang giá bao nhiêu?              → giá cổ phiếu (auto chat mode)
```

---

## Deploy lên VPS (Docker)

### Yêu cầu VPS

- Ubuntu 22.04+ hoặc Debian 12
- RAM >= 512MB, CPU 1 vCPU, Disk 5GB
- Docker + Docker Compose đã cài

### Deploy

```bash
# 1. Copy code lên VPS
scp -r . user@your-vps:/opt/biettuotbot

# 2. SSH vào VPS
ssh user@your-vps
cd /opt/biettuotbot

# 3. Tạo .env trên VPS (điền thông tin thực)
cp .env.example .env
nano .env

# 4. Khởi động
docker compose up -d

# 5. Kiểm tra logs
docker compose logs -f
```

Container tự động restart khi VPS reboot (`restart: unless-stopped`). Healthcheck kiểm tra `/health` endpoint mỗi 30 giây.

### Cập nhật code

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

---

## Cấu trúc project

```
src/
├── bot-main.ts          # Entry point — khởi động MCP server + Telegram bot
├── telegram.ts          # Telegram bot layer (grammY) — lệnh, access control, auto mode detection
├── llm.ts               # LLM wrapper (Vercel AI SDK) — tool-use loop, chat history, retry logic
├── mcp-client.ts        # MCP HTTP client — kết nối đến MCP server
├── server.ts            # MCP server — đăng ký 20 tools
├── vnexpress.ts         # VnExpress RSS + bài viết (cache 5 phút)
├── cafef.ts             # CafeF macro news + company data (HTML scraping, cache 5 phút)
├── crypto.ts            # CoinGecko API — giá, technical analysis (cache 3 phút)
├── crypto-news.ts       # cryptocurrency.cv RSS + ThuanCapital scraping (cache 5 phút)
├── stock.ts             # KBS Securities — OHLCV, price board, profile, technicals (cache 5 phút)
└── prompts/
    ├── system.ts        # System prompt: CHAT mode + REASONER mode + tool routing
    ├── commands.ts      # Command prompt builders (/news, /market, /plan, /analysis)
    └── mcp/             # MCP prompt templates
```

| File             | Vai trò                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `bot-main.ts`    | Orchestrator — start server và bot, validate env vars               |
| `telegram.ts`    | UI layer — nhận lệnh, auto-detect mode, gửi trả lời, access control |
| `llm.ts`         | AI brain — tool-use loop, quản lý lịch sử, retry ECONNRESET         |
| `mcp-client.ts`  | Bridge — chuyển tool call từ AI xuống MCP server                    |
| `server.ts`      | Tool registry — định nghĩa 20 tools cho AI gọi                      |
| `vnexpress.ts`   | Data source — VnExpress RSS + full article                          |
| `cafef.ts`       | Data source — CafeF macro news, company news, financials, insider   |
| `crypto.ts`      | Data source — CoinGecko giá + technical analysis                    |
| `crypto-news.ts` | Data source — cryptocurrency.cv (EN) + ThuanCapital (VN)            |
| `stock.ts`       | Data source — KBS Securities OHLCV, price board, profile, ATH/ATL   |

---

## Debug với MCP Inspector

Để test các tool trực tiếp (không qua bot):

```bash
npm run dev:http       # khởi động MCP server standalone tại :3001
npm run dev:inspector:http   # mở MCP Inspector tại localhost:5173
```

Trình duyệt mở → click **Connect** → **List Tools** → chọn tool → điền params → **Run Tool**.

---

## Biến môi trường — đầy đủ

| Biến                   | Bắt buộc | Mô tả                                                    |
| ---------------------- | -------- | -------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`   | ✅       | Token từ @BotFather                                      |
| `AI_PROVIDER`          | ✅       | `openai` \| `anthropic` \| `google`                      |
| `AI_MODEL`             | ✅       | Tên model chat, vd: `gpt-4o`                             |
| `AI_API_KEY`           | ✅       | API key của provider                                     |
| `AI_BASE_URL`          | ❌       | Custom endpoint (Ollama, Groq, DeepSeek...)              |
| `AI_REASONER_MODEL`    | ❌       | Model cho reasoner mode (fallback: dùng AI_MODEL)        |
| `AI_REASONER_API_KEY`  | ❌       | API key riêng cho reasoner (fallback: dùng AI_API_KEY)   |
| `AI_REASONER_BASE_URL` | ❌       | Base URL riêng cho reasoner (fallback: dùng AI_BASE_URL) |
| `MCP_SERVER_URL`       | ❌       | Mặc định: `http://localhost:3001/mcp`                    |
| `PORT`                 | ❌       | Mặc định: `3001`                                         |
| `ADMIN_CHAT_ID`        | ❌       | Chat ID admin (có thể dùng /allow, /block, /users)       |
| `ALLOWED_CHAT_IDS`     | ❌       | Danh sách chat ID được phép (phân cách bằng `,`)         |
