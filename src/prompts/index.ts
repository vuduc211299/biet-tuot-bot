export { SYSTEM_PROMPT } from "./system.js";
export {
  buildWelcomeMessage,
  buildNewsPrompt,
  MARKET_PROMPT,
  buildSentimentPrompt,
  RISK_PROMPT,
  buildPlanPrompt,
} from "./commands.js";
export { registerAnalyzeNewsPrompt } from "./mcp/analyze-news.js";
export { registerMarketSentimentPrompt } from "./mcp/market-sentiment.js";
export { registerRiskAssessmentPrompt } from "./mcp/risk-assessment.js";
export { registerTradingPlanPrompt } from "./mcp/trading-plan.js";
