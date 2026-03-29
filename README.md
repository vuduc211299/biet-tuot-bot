# BietTuotBot — Telegram Chatbot Phân Tích Tin Tức & Tài Chính

Bot Telegram thông minh tích hợp AI để phân tích tin tức từ VnExpress, thị trường chứng khoán Việt Nam và thị trường crypto. Hỗ trợ mọi LLM provider (OpenAI, Anthropic, Google Gemini, Ollama v.v...) và chạy 24/7 trên VPS qua Docker.

---

## Tính năng

- **Tin tức thời sự**: Crawl RSS từ VnExpress (thế giới, kinh doanh, thời sự, bất động sản, pháp luật...)
- **Phân tích sâu**: AI đọc nội dung full bài viết, đưa ra nhận định độc lập — không chỉ tóm tắt
- **Crypto market**: Giá BTC/ETH/SOL... theo thời gian thực từ CoinGecko
- **Chứng khoán VN**: VNINDEX, HNX, UPCOM, giá cổ phiếu, dòng tiền ngoại từ KBS Securities
- **Hội thoại liên tục**: Nhớ ngữ cảnh theo từng chat — có thể hỏi tiếp mà không cần giải thích lại
- **Đa provider LLM**: Đổi model chỉ cần sửa biến môi trường, không cần thay code

### Lệnh bot

| Lệnh                    | Mô tả                                              |
| ----------------------- | -------------------------------------------------- |
| `/news [chủ đề]`        | Tin tức mới nhất, có thể lọc theo chủ đề           |
| `/market`               | Tổng quan thị trường: crypto + chứng khoán VN      |
| `/sentiment`            | Phân tích tâm lý thị trường (Fear/Greed, xu hướng) |
| `/risk`                 | Đánh giá rủi ro vĩ mô theo từng sector             |
| `/plan [crypto\|stock]` | Gợi ý trading plan có phân tích kỹ thuật + cơ bản  |
| `/reset`                | Xóa lịch sử hội thoại                              |
| Tin nhắn tự do          | Hỏi bất cứ điều gì về tin tức / tài chính          |

---

## Kiến trúc

Toàn bộ hệ thống chạy trong **một Node.js process duy nhất** bên trong Docker container:

```
User (Telegram App)
        │ HTTPS long-polling
        ▼
┌─────────────────────────────── Docker Container ───────────────────────────────┐
│                                                                                │
│   bot-main.ts (Orchestrator)                                                   │
│        │                │                   │                                  │
│  telegram.ts       llm.ts               server.ts                              │
│  (grammY Bot)   (Vercel AI SDK)       (MCP Server)                             │
│                      │                  :3001/mcp                              │
│               mcp-client.ts          ┌────┼────┐                               │
│               (MCP Client)      vnexpress  crypto  stock                       │
│                                .ts       .ts      .ts                          │
└────────────────────────────────────────────────────────────────────────────────┘
        │                    │                    │
   LLM Provider API    VnExpress RSS         CoinGecko API
   (OpenAI/Anthropic    + Article HTML        KBS Securities
   /Google/Ollama...)
```

**Luồng xử lý một tin nhắn:**

1. User gửi tin → `telegram.ts` nhận
2. `llm.ts` gọi `generateText()` với danh sách MCP tools
3. AI tự quyết định cần gọi tool nào (tìm tin, giá crypto, giá cổ phiếu...)
4. `mcp-client.ts` forward tool call → `server.ts` qua HTTP (StreamableHTTP)
5. `server.ts` gọi `vnexpress.ts` / `crypto.ts` / `stock.ts` → trả kết quả
6. AI tổng hợp kết quả từ các tool → sinh phản hồi cuối
7. `telegram.ts` gửi lại User (tự động split nếu > 4096 ký tự)

**8 MCP Tools:** `vnexpress_get_latest_news`, `vnexpress_search_news`, `vnexpress_get_article_content`, `crypto_get_overview`, `crypto_get_prices`, `stock_vn_overview`, `stock_get_price`, `stock_get_history`

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

# LLM Provider (chọn 1 trong các provider bên dưới)
AI_PROVIDER=openai
AI_MODEL=gpt-4o
AI_API_KEY=sk-xxxxxxxxxxxxxxxx
AI_BASE_URL=

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

### Bước 4 — Build và chạy

**Chạy development (có hot-reload):**

```bash
npm run build       # compile TypeScript → lib/
npm run dev:bot     # chạy bot (nodemon)
```

**Hoặc chạy production:**

```bash
npm run build
npm start
```

Khi thấy log:

```
MCP server started on port 3001
Loaded 8 MCP tools
Telegram bot started
```

→ Bot đã sẵn sàng. Mở Telegram, tìm bot của bạn, gửi `/start`.

### Bước 5 — Kiểm tra

Gửi thử các lệnh trong Telegram:

```
/market          → tổng quan thị trường
/news vàng       → tin tức về vàng
Tại sao Bitcoin tăng mạnh hôm nay?   → câu hỏi tự do
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

Container tự động restart khi VPS reboot (`restart: unless-stopped`). Healthcheck kiểm tra `/mcp` endpoint mỗi 30 giây.

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
├── telegram.ts          # Telegram bot layer (grammY) — lệnh, access control
├── llm.ts               # LLM wrapper (Vercel AI SDK) — tool-use loop, chat history
├── mcp-client.ts        # MCP HTTP client — kết nối đến MCP server
├── server.ts            # MCP server — đăng ký 8 tools + 4 prompts
├── vnexpress.ts         # Crawl VnExpress RSS + bài viết
├── crypto.ts            # CoinGecko API client
├── stock.ts             # KBS Vietnam stock API client
└── prompts/
    ├── system.ts        # System prompt cho AI
    └── mcp/             # MCP prompt templates
```

| File            | Vai trò                                               |
| --------------- | ----------------------------------------------------- |
| `bot-main.ts`   | Orchestrator — start server và bot song song          |
| `telegram.ts`   | UI layer — nhận lệnh, gửi trả lời, kiểm soát truy cập |
| `llm.ts`        | AI brain — tool-use loop, quản lý lịch sử hội thoại   |
| `mcp-client.ts` | Bridge — chuyển tool call từ AI xuống MCP server      |
| `server.ts`     | Tool registry — định nghĩa 8 tools cho AI gọi         |
| `vnexpress.ts`  | Data source — RSS feed + full article (cache 5 phút)  |
| `crypto.ts`     | Data source — CoinGecko (cache 3 phút)                |
| `stock.ts`      | Data source — KBS Securities (cache 5 phút)           |

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

| Biến                 | Bắt buộc | Mô tả                                            |
| -------------------- | -------- | ------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | ✅       | Token từ @BotFather                              |
| `AI_PROVIDER`        | ✅       | `openai` \| `anthropic` \| `google`              |
| `AI_MODEL`           | ✅       | Tên model, vd: `gpt-4o`                          |
| `AI_API_KEY`         | ✅       | API key của provider                             |
| `AI_BASE_URL`        | ❌       | Custom endpoint (Ollama, Groq...)                |
| `MCP_SERVER_URL`     | ❌       | Mặc định: `http://localhost:3001/mcp`            |
| `PORT`               | ❌       | Mặc định: `3001`                                 |
| `ADMIN_CHAT_ID`      | ❌       | Chat ID admin (có thể dùng /allow, /block)       |
| `ALLOWED_CHAT_IDS`   | ❌       | Danh sách chat ID được phép (phân cách bằng `,`) |
