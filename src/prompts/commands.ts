// Telegram bot command prompt builders — pure string functions, no framework deps.

export function buildWelcomeMessage(name: string): string {
  return (
    `👋 *Hello ${name}!*\n\n` +
    `I'm your independent financial & news analysis assistant.\n\n` +
    `*Available commands:*\n` +
    `/news [topic] — Latest news + analysis\n` +
    `/market — Crypto + VN stock overview\n` +
    `/sentiment [crypto|stock] — Market sentiment\n` +
    `/risk — Macro risk assessment\n` +
    `/plan [crypto|stock] — Trading plan\n` +
    `/reset — Clear conversation history\n\n` +
    `Or just ask me anything! 💬\n\n` +
    `_⚠️ Analysis only, not investment advice._`
  );
}

export function buildNewsPrompt(topic?: string): string {
  return topic
    ? `Hãy tìm kiếm và phân tích tin tức về: ${topic}`
    : "Hãy lấy tin tức mới nhất từ VnExpress và đưa ra phân tích tổng quan tình hình hiện tại.";
}

export const MARKET_PROMPT =
  "Hãy cho tôi tổng quan thị trường hôm nay: giá crypto (BTC, ETH) và chứng khoán Việt Nam (VN-Index). Kết hợp với tin tức kinh tế mới nhất để đưa ra nhận định.";

export function buildSentimentPrompt(market: string): string {
  const scope = market === "all" ? "crypto và chứng khoán Việt Nam" : market;
  return `Phân tích sentiment thị trường ${scope}. Đánh giá xu hướng Bullish/Bearish/Neutral với các chỉ số cụ thể.`;
}

export const RISK_PROMPT =
  "Đánh giá rủi ro vĩ mô hiện tại. Lấy tin tức thế giới, thời sự trong nước và dữ liệu thị trường để cho điểm risk score từng sector.";

export function buildPlanPrompt(market: string): string {
  return `Đề xuất trading plan cho thị trường ${market} trong tuần này. Bao gồm: watchlist, entry/exit zone, stop-loss và key catalysts cần theo dõi.`;
}
