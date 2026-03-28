import { Bot, Context } from "grammy";
import { LlmAssistant } from "./llm.js";
import {
  buildWelcomeMessage,
  buildNewsPrompt,
  MARKET_PROMPT,
  buildSentimentPrompt,
  RISK_PROMPT,
  buildPlanPrompt,
} from "./prompts/index.js";

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

      await ctx.reply(
        `⛔ This bot is private. Access restricted.\n` +
        `Contact the admin for access.\n\n` +
        `Your Chat ID: \`${chatId}\``,
        { parse_mode: "Markdown" }
      );

      // Notify admin
      if (this.adminChatId) {
        try {
          await this.bot.api.sendMessage(
            this.adminChatId,
            `🔔 *Unauthorized access attempt*\n` +
            `User: ${userName}\n` +
            `Chat ID: \`${chatId}\`\n\n` +
            `Use /allow ${chatId} to grant access.`,
            { parse_mode: "Markdown" }
          );
        } catch { /* admin not available */ }
      }
    });
  }

  private async safeSendMarkdown(ctx: Context, text: string): Promise<void> {
    try {
      await ctx.reply(text, { parse_mode: "Markdown" });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("can't parse entities") || errMsg.includes("Bad Request")) {
        await ctx.reply(text); // plain text fallback
      } else {
        throw err;
      }
    }
  }

  private async sendLongMessage(ctx: Context, text: string): Promise<void> {
    const chunks = splitByParagraphs(text, 4096);
    for (const chunk of chunks) {
      await this.safeSendMarkdown(ctx, chunk);
    }
  }

  private async handleUserMessage(ctx: Context, message: string): Promise<void> {
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
      const response = await this.llm.chat(chatId, message, notifyUser);
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
      await ctx.reply(buildWelcomeMessage(name), { parse_mode: "Markdown" });
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

    // /sentiment [crypto|stock|all]
    this.bot.command("sentiment", async ctx => {
      const market = ctx.match?.trim() || "all";
      await this.handleUserMessage(ctx, buildSentimentPrompt(market));
    });

    // /risk
    this.bot.command("risk", async ctx => {
      await this.handleUserMessage(ctx, RISK_PROMPT);
    });

    // /plan [crypto|stock]
    this.bot.command("plan", async ctx => {
      const market = ctx.match?.trim() || "crypto";
      await this.handleUserMessage(ctx, buildPlanPrompt(market));
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
      await ctx.reply(
        `🤖 *Bot Status*\n` +
        `History: ${histLen} messages\n` +
        `Chat ID: \`${chatId}\``,
        { parse_mode: "Markdown" }
      );
    });

    // ---- Admin-only commands ----
    this.bot.command("allow", async ctx => {
      if (!this.isAdmin(ctx.chat.id.toString())) return;
      const targetId = ctx.match?.trim();
      if (!targetId) return ctx.reply("Usage: /allow <chat_id>");

      this.allowedChatIds.add(targetId);
      await ctx.reply(`✅ Added \`${targetId}\` to whitelist.`, { parse_mode: "Markdown" });

      try {
        await this.bot.api.sendMessage(targetId, "🎉 You have been granted access to the bot! Send /start to begin.");
      } catch { /* user hasn't started the bot yet */ }
    });

    this.bot.command("block", async ctx => {
      if (!this.isAdmin(ctx.chat.id.toString())) return;
      const targetId = ctx.match?.trim();
      if (!targetId) return ctx.reply("Usage: /block <chat_id>");

      this.allowedChatIds.delete(targetId);
      await ctx.reply(`🚫 Removed \`${targetId}\` from whitelist.`, { parse_mode: "Markdown" });
    });

    this.bot.command("users", async ctx => {
      if (!this.isAdmin(ctx.chat.id.toString())) return;
      const list = [...this.allowedChatIds]
        .map(id => id === this.adminChatId ? `${id} (admin)` : id)
        .join("\n");
      await ctx.reply(
        `📋 *Allowed users:*\n\`\`\`\n${list || "(none)"}\n\`\`\``,
        { parse_mode: "Markdown" }
      );
    });

    // Free-text handler (catch-all for regular messages)
    this.bot.on("message:text", async ctx => {
      const text = ctx.message.text;
      if (text.startsWith("/")) return; // already handled by commands
      await this.handleUserMessage(ctx, text);
    });
  }

  async start(): Promise<void> {
    this.setupAccessControl();
    this.setupCommands();

    // Set bot commands for Telegram menu
    await this.bot.api.setMyCommands([
      { command: "news", description: "Latest news + analysis" },
      { command: "market", description: "Crypto + VN stock overview" },
      { command: "sentiment", description: "Market sentiment [crypto|stock]" },
      { command: "risk", description: "Macro risk assessment" },
      { command: "plan", description: "Trading plan [crypto|stock]" },
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
