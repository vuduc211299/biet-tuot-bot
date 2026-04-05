// Telegram bot command prompt builders — pure string functions, no framework deps.

export function buildWelcomeMessage(name: string): string {
  return (
    `👋 *Hello ${name}!*\n\n` +
    `I'm your independent financial & news analysis assistant.\n\n` +
    `*Available commands:*\n` +
    `/news [topic] — Latest news by topic\n` +
    `/stock — Vietnam stock market update\n` +
    `/crypto — Crypto market update\n` +
    `/bds — Real estate news\n` +
    `/gold — Gold prices (domestic & world)\n` +
    `/analysis [topic] — 🧠 Deep analysis (reasoner mode)\n` +
    `/reset — Clear conversation history\n\n` +
    `Or just ask me anything! 💬\n` +
    `_(tip: messages with "phân tích", "tại sao"... auto-switch to reasoner mode)_\n\n` +
    `_⚠️ Analysis only, not investment advice._`
  );
}

export function buildNewsPrompt(topic?: string): string {
  return topic
    ? `Search and get the latest news about: ${topic}`
    : "";
}

export const STOCK_PROMPT =
  "Get the latest Vietnam stock market update. Call stock_vn_overview for top stocks (volume, foreign flow), stock_get_index for VNINDEX, and cafef_get_macro_news(category='chung-khoan') for market headlines. Present as a concise bullet list.";

export const CRYPTO_PROMPT =
  "Get the latest crypto market update. Call crypto_get_overview for market data (top coins, BTC dominance, trending) and cryptocurrency_get_news for headlines. Present as a concise bullet list.";

export const BDS_PROMPT =
  "Get the latest Vietnam real estate news update. Call realestate_get_news and realestate_get_interest_rates for BDS news and bank interest rates. Present as a concise bullet list. Do NOT call realestate_search_listings.";

export const GOLD_PROMPT =
  "Get the latest domestic and world gold price update. Call gold_get_prices for gold prices and gold_get_news for gold news. Present as a concise bullet list.";

export function buildAnalysisPrompt(topic?: string): string {
  return topic
    ? `Provide an in-depth analysis of: ${topic}. Evaluate from multiple angles, give independent opinions and forecast trends.`
    : "";
}
