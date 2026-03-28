import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerRiskAssessmentPrompt(server: McpServer): void {
  server.registerPrompt(
    "risk_assessment",
    {
      title: "Macro Risk Assessment",
      description: "Assesses macro-level risks across geopolitics, economics, and financial markets.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Perform a comprehensive macro risk assessment.

DATA COLLECTION (call all of these):
1. vnexpress_get_latest_news with category "the-gioi" (world/conflict news)
2. vnexpress_get_latest_news with category "thoi-su" (domestic politics)
3. vnexpress_get_latest_news with category "kinh-doanh" (economic news)
4. crypto_get_overview (crypto market health)
5. stock_vn_overview (Vietnam market health)

RISK ANALYSIS:
For each risk factor, assign a score 1-10 (10 = extreme risk):
- Geopolitical risk (wars, sanctions, trade tensions)
- Inflation / FED policy risk
- Currency risk (USD/VND, emerging markets)
- Vietnam-specific domestic risk
- Crypto market risk
- Vietnam stock market risk

DELIVERABLE:
## Risk Matrix
| Risk Factor | Score (1-10) | Key Drivers | Trend |
|-------------|-------------|-------------|-------|

## Top 3 Risks to Watch
## Protective Strategies
## Overall Risk Verdict: LOW / MEDIUM / HIGH / EXTREME

Be specific — cite actual news events driving each risk score.
Respond in the same language the user is using.`,
          },
        },
      ],
    })
  );
}
