// Telegram bot command prompt builders — pure string functions, no framework deps.

export function buildWelcomeMessage(name: string): string {
  return (
    `👋 *Hello ${name}!*\n\n` +
    `I'm your independent financial & news analysis assistant.\n\n` +
    `*Available commands:*\n` +
    `/news [topic] — Latest news + analysis\n` +
    `/market — Crypto + VN stock overview\n` +
    `/plan [crypto|stock] — Trading plan\n` +
    `/analysis [topic] — 🧠 Deep analysis (reasoner mode)\n` +
    `/reset — Clear conversation history\n\n` +
    `Or just ask me anything! 💬\n` +
    `_(tip: messages with "phân tích", "tại sao"... auto-switch to reasoner mode)_\n\n` +
    `_⚠️ Analysis only, not investment advice._`
  );
}

export function buildNewsPrompt(topic?: string): string {
  return topic
    ? `Hãy tìm kiếm: ${topic}`
    : "Hãy lấy tin tức mới nhất từ các công cụ bạn có";
}

export const MARKET_PROMPT =
  "Hãy cho tôi tổng quan thị trường hôm nay: giá crypto (BTC, ETH) và chứng khoán Việt Nam (VN-Index) kết hợp với tin tức kinh tế mới nhất";

export function buildPlanPrompt(market: string): string {
  return `Đề xuất trading plan cho thị trường ${market} trong tuần này. Bao gồm: watchlist, entry/exit zone, stop-loss và key catalysts cần theo dõi.`;
}

export function buildAnalysisPrompt(topic?: string): string {
  return topic
    ? `Phân tích chuyên sâu về: ${topic}. Đánh giá đa chiều, đưa ra nhận định độc lập và dự báo xu hướng.`
    : "Phân tích chuyên sâu tình hình thị trường hiện tại. Tổng hợp tin tức, dữ liệu và đưa ra nhận định độc lập về xu hướng.";
}
