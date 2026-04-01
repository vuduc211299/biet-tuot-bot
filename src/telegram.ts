import { Bot, Context } from "grammy";
import { LlmAssistant, type LlmMode } from "./llm.js";
import {
  buildWelcomeMessage,
  buildNewsPrompt,
  MARKET_PROMPT,
  buildPlanPrompt,
  buildAnalysisPrompt,
} from "./prompts/index.js";

// Keywords that trigger reasoner mode for free-text messages
const REASONER_KEYWORDS = [
  // Vietnamese
  "phân tích", "đánh giá", "tại sao", "vì sao", "nhận định",
  "dự báo", "so sánh", "ảnh hưởng", "nguyên nhân", "xu hướng", "rủi ro",
  // English
  "analyze", "analysis", "why", "assess", "evaluate", "forecast",
  "compare", "impact", "risk", "trend",
];

function detectMode(text: string): LlmMode {
  const lower = text.toLowerCase();
  const matched = REASONER_KEYWORDS.find(kw => lower.includes(kw));
  if (matched) {
    console.log(`[Mode] Auto-detected reasoner mode (keyword: "${matched}")`);
    return "reasoner";
  }
  return "chat";
}

/** Escape HTML special characters for use in Telegram HTML parse_mode */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert LLM Markdown output to Telegram-compatible HTML.
 * Handles: **bold**, *bold*, _italic_, `code`, ```pre```, pipe tables → bullet lists, [text](url), ## headers.
 * Uses a stash-restore approach so preserved blocks are not affected by later transforms.
 */
function convertToTelegramHtml(text: string): string {
  const preserved: string[] = [];
  function stash(html: string): string {
    preserved.push(html);
    return `\x02${preserved.length - 1}\x03`;
  }

  // 1. Stash fenced code blocks (```...```)
  text = text.replace(/```(?:\w*)\n?([\s\S]*?)```/g, (_, code) =>
    stash(`<pre>${escapeHtml(code.trimEnd())}</pre>`)
  );

  // 2. Convert pipe tables → bullet lists.
  //    Strip the separator row (|---|---|), then for each data row extract cell values.
  text = text.replace(/((?:^\|[^\n]+\n?)+)/gm, (match) => {
    const rows = match.trimEnd().split("\n").filter(r => r.trim());
    // Detect header row as first row, separator as any row like |---|---|
    const dataRows = rows.filter(r => !/^\|[-:\s|]+\|?$/.test(r));
    if (dataRows.length === 0) return "";

    const [headerRow, ...bodyRows] = dataRows;
    // Parse cells: split on |, drop first/last empty strings from leading/trailing |
    const parseCells = (row: string) =>
      row.split("|").slice(1, -1).map(c => c.trim().replace(/\*\*/g, "").replace(/\*/g, "").replace(/_/g, ""));

    const headers = parseCells(headerRow);

    if (bodyRows.length === 0) {
      // Single row with no body — just show as bullet
      return headers.map(h => `• ${escapeHtml(h)}`).join("\n") + "\n";
    }

    // Multi-row table: each body row → bullet "• Col1: Val1 | Col2: Val2 ..."
    const lines = bodyRows.map(row => {
      const cells = parseCells(row);
      const parts = headers
        .map((h, i) => {
          const val = cells[i] ?? "";
          return val ? `${escapeHtml(h)}: ${escapeHtml(val)}` : null;
        })
        .filter(Boolean);
      return `• ${parts.join(" | ")}`;
    });
    return lines.join("\n") + "\n";
  });

  // 3. Stash inline code (`...`)
  text = text.replace(/`([^`\n]+)`/g, (_, code) =>
    stash(`<code>${escapeHtml(code)}</code>`)
  );

  // 4. Stash markdown links [text](url) before HTML-escaping to preserve URLs intact
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) =>
    stash(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`)
  );

  // 5. Escape remaining HTML special characters in plain text
  text = escapeHtml(text);

  // 6. Convert Markdown emphasis to HTML tags
  text = text
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")     // **bold**
    .replace(/\*([^*\n]+?)\*/g, "<b>$1</b>")       // *bold*
    .replace(/_([^_\n]+?)_/g, "<i>$1</i>")         // _italic_
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")    // ## headers
    .replace(/^[-*]{3,}$/gm, "");                  // --- dividers

  // 7. Restore stashed blocks
  text = text.replace(/\x02(\d+)\x03/g, (_, i) => preserved[parseInt(i, 10)]);

  // 8. Collapse excessive blank lines
  return text.replace(/\n{3,}/g, "\n\n");
}

function splitByParagraphs(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      // If a single paragraph is too long, split by lines
      if (para.length > maxLen) {
        const lines = para.split("\n");
        let lineBuf = "";
        for (const line of lines) {
          const lineCand = lineBuf ? `${lineBuf}\n${line}` : line;
          if (lineCand.length <= maxLen) {
            lineBuf = lineCand;
          } else {
            if (lineBuf) chunks.push(lineBuf);
            lineBuf = line.slice(0, maxLen);
          }
        }
        current = lineBuf;
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(c => c.trim());
}

export class TelegramNewsBot {
  private bot: Bot;
  private llm: LlmAssistant;
  private adminChatId: string;
  private allowedChatIds: Set<string>;

  constructor(token: string, llm: LlmAssistant) {
    this.bot = new Bot(token);
    this.llm = llm;
    this.adminChatId = process.env.ADMIN_CHAT_ID?.trim() ?? "";

    // Initialize whitelist from env
    this.allowedChatIds = new Set(
      (process.env.ALLOWED_CHAT_IDS ?? "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean)
    );
    if (this.adminChatId) this.allowedChatIds.add(this.adminChatId);
  }

  private isAllowed(chatId: string): boolean {
    if (!this.adminChatId) return true; // No access control configured
    return this.allowedChatIds.has(chatId);
  }

  private isAdmin(chatId: string): boolean {
    return !!this.adminChatId && chatId === this.adminChatId;
  }

  private setupAccessControl(): void {
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id?.toString();
      if (!chatId) return next();

      if (this.isAllowed(chatId)) return next();

      // Reject unknown user
      const userName = ctx.from?.username
        ? `@${ctx.from.username}`
        : (ctx.from?.first_name ?? "Unknown");

      await this.safeSendMarkdown(ctx,
        `⛔ This bot is private. Access restricted.\n` +
        `Contact the admin for access.\n\n` +
        `Your Chat ID: \`${chatId}\``
      );

      // Notify admin
      if (this.adminChatId) {
        try {
          await this.bot.api.sendMessage(
            this.adminChatId,
            convertToTelegramHtml(
              `🔔 **Unauthorized access attempt**\n` +
              `User: ${userName}\n` +
              `Chat ID: \`${chatId}\`\n\n` +
              `Use /allow ${chatId} to grant access.`
            ),
            { parse_mode: "HTML" }
          );
        } catch { /* admin not available */ }
      }
    });
  }

  private async safeSendHtml(ctx: Context, html: string): Promise<void> {
    try {
      await ctx.reply(html, { parse_mode: "HTML" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("can't parse entities") || errMsg.includes("Bad Request")) {
        // Strip HTML tags and decode entities for plain text fallback
        const plain = html
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        await ctx.reply(plain);
      } else {
        throw err;
      }
    }
  }

  /** Convert Markdown to HTML, then send. Use for any hardcoded or LLM Markdown strings. */
  private async safeSendMarkdown(ctx: Context, md: string): Promise<void> {
    await this.safeSendHtml(ctx, convertToTelegramHtml(md));
  }

  private async sendLongMessage(ctx: Context, text: string): Promise<void> {
    const html = convertToTelegramHtml(text);
    const chunks = splitByParagraphs(html, 4096);
    for (const chunk of chunks) {
      await this.safeSendHtml(ctx, chunk);
    }
  }

  private async handleUserMessage(ctx: Context, message: string, mode: LlmMode = "chat"): Promise<void> {
    const chatId = ctx.chat!.id.toString();

    // Typing indicator loop
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => { });
    }, 4000);
    await ctx.replyWithChatAction("typing");

    // Real-time callback: sends interim retry/error notifications during tool-use loop
    const notifyUser = async (msg: string): Promise<void> => {
      await ctx.reply(msg).catch(() => { });
    };

    try {
      const response = await this.llm.chat(chatId, message, notifyUser, mode);
      clearInterval(typingInterval);
      await this.sendLongMessage(ctx, response);
    } catch (err) {
      clearInterval(typingInterval);
      console.error("Chat error:", err);
      await ctx.reply("⚠️ An error occurred. Please try again later.\n\nIf the issue persists, use /reset to clear history.");
    }
  }

  private setupCommands(): void {
    // /start
    this.bot.command("start", async ctx => {
      const name = ctx.from?.first_name ?? "there";
      await this.safeSendMarkdown(ctx, buildWelcomeMessage(name));
    });

    // /news [topic]
    this.bot.command("news", async ctx => {
      const topic = ctx.match?.trim();
      await this.handleUserMessage(ctx, buildNewsPrompt(topic));
    });

    // /market
    this.bot.command("market", async ctx => {
      await this.handleUserMessage(ctx, MARKET_PROMPT);
    });

    // /plan [crypto|stock]
    this.bot.command("plan", async ctx => {
      const market = ctx.match?.trim() || "crypto";
      await this.handleUserMessage(ctx, buildPlanPrompt(market));
    });

    // /analysis [topic] — deep analysis, always uses reasoner mode
    this.bot.command("analysis", async ctx => {
      const topic = ctx.match?.trim();
      await this.handleUserMessage(ctx, buildAnalysisPrompt(topic), "reasoner");
    });

    // /reset
    this.bot.command("reset", async ctx => {
      const chatId = ctx.chat.id.toString();
      this.llm.clearHistory(chatId);
      await ctx.reply("✅ Conversation history cleared. Starting fresh!");
    });

    // /status (info about bot)
    this.bot.command("status", async ctx => {
      const chatId = ctx.chat.id.toString();
      const histLen = this.llm.getHistoryLength(chatId);
      const modelInfo = this.llm.getModelInfo();
      const reasonerLine = modelInfo.reasoner
        ? `Reasoner: \`${modelInfo.reasoner}\``
        : `Reasoner: _not configured, fallback to chat model_`;
      await this.safeSendMarkdown(ctx,
        `🤖 **Bot Status**\n` +
        `History: ${histLen} messages\n` +
        `Chat ID: \`${chatId}\`\n` +
        `Chat model: \`${modelInfo.chat}\`\n` +
        `${reasonerLine}`
      );
    });

    // ---- Admin-only commands ----
    this.bot.command("allow", async ctx => {
      if (!this.isAdmin(ctx.chat.id.toString())) return;
      const targetId = ctx.match?.trim();
      if (!targetId) return ctx.reply("Usage: /allow <chat_id>");

      this.allowedChatIds.add(targetId);
      await this.safeSendMarkdown(ctx, `✅ Added \`${targetId}\` to whitelist.`);

      try {
        await this.bot.api.sendMessage(targetId, "🎉 You have been granted access to the bot! Send /start to begin.");
      } catch { /* user hasn't started the bot yet */ }
    });

    this.bot.command("block", async ctx => {
      if (!this.isAdmin(ctx.chat.id.toString())) return;
      const targetId = ctx.match?.trim();
      if (!targetId) return ctx.reply("Usage: /block <chat_id>");

      this.allowedChatIds.delete(targetId);
      await this.safeSendMarkdown(ctx, `🚫 Removed \`${targetId}\` from whitelist.`);
    });

    this.bot.command("users", async ctx => {
      if (!this.isAdmin(ctx.chat.id.toString())) return;
      const list = [...this.allowedChatIds]
        .map(id => id === this.adminChatId ? `${id} (admin)` : id)
        .join("\n");
      await this.safeSendMarkdown(ctx,
        `📋 **Allowed users:**\n\`\`\`\n${list || "(none)"}\n\`\`\``
      );
    });

    // Free-text handler (catch-all for regular messages)
    this.bot.on("message:text", async ctx => {
      const text = ctx.message.text;
      if (text.startsWith("/")) return; // already handled by commands
      const mode = detectMode(text);
      await this.handleUserMessage(ctx, text, mode);
    });
  }

  async start(): Promise<void> {
    this.setupAccessControl();
    this.setupCommands();

    // Set bot commands for Telegram menu
    await this.bot.api.setMyCommands([
      { command: "news", description: "Latest news + analysis" },
      { command: "market", description: "Crypto + VN stock overview" },
      { command: "plan", description: "Trading plan [crypto|stock]" },
      { command: "analysis", description: "🧠 Deep analysis — reasoner mode [topic]" },
      { command: "reset", description: "Clear conversation history" },
      { command: "status", description: "Bot status & chat info" },
    ]);

    // Start long polling (non-blocking)
    this.bot.start({
      onStart: info => console.log(`Telegram Bot started: @${info.username}`),
    });
  }

  stop(): void {
    this.bot.stop();
  }
}
