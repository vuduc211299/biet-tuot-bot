import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerAnalyzeNewsPrompt(server: McpServer): void {
  server.registerPrompt(
    "analyze_news",
    {
      title: "Analyze News with Independent Opinion",
      description: "Guides analysis of a news topic with independent perspective and multi-dimensional outlook.",
      argsSchema: {
        topic: z.string().describe("Topic to analyze, e.g. 'xung đột Trung Đông', 'FED lãi suất'"),
        focus: z
          .enum(["geopolitics", "economics", "financial_markets", "social_impact", "general"])
          .optional()
          .describe("Analysis focus area"),
      },
    },
    ({ topic, focus }) => {
      const focusGuide: Record<string, string> = {
        geopolitics: "Focus on power dynamics between nations, alliances, and strategic interests.",
        economics: "Analyze economic indicators, trade flows, supply chains, and policy implications for Vietnam.",
        financial_markets: "Analyze impacts on VN-Index, crypto markets, gold, oil prices, and USD/VND exchange rate.",
        social_impact: "Analyze how this affects ordinary Vietnamese citizens, public opinion, and social stability.",
        general: "Cover geopolitical, economic, and social dimensions.",
      };
      const guide = focusGuide[focus ?? "general"];

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `You are an independent analyst. Analyze the topic: "${topic}"

STEPS:
1. Use vnexpress_get_latest_news to fetch relevant categories (the-gioi, kinh-doanh, thoi-su as needed)
2. Use vnexpress_search_news with relevant Vietnamese keywords to find specific articles
3. Read 2-3 key articles in full using vnexpress_get_article_content
4. If topic involves markets, also call crypto_get_overview and/or stock_vn_overview

ANALYSIS REQUIREMENTS:
- Provide YOUR OWN independent analysis, not just a summary
- ${guide}
- Consider what Vietnamese media might be framing in a particular way
- Discuss potential future developments and risks
- Cite specific article titles and facts when making points
- State your confidence level clearly

FORMAT (use this structure):
## Tổng quan tình hình
## Phân tích độc lập
## Tác động dự kiến
## Dự báo & Rủi ro
## Câu hỏi mở

Respond in the same language the user is using.`,
            },
          },
        ],
      };
    }
  );
}
