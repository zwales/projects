import { config } from "../config.js";

// USD per 1M tokens. Update as Anthropic pricing changes.
const RATES = {
  "claude-haiku-4-5":  { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-sonnet-5":   { in: 3, out: 15 },
  "claude-opus-4-8":   { in: 5, out: 25 },
};

export function costUSD(model, inputTokens, outputTokens) {
  const r = RATES[model] || RATES["claude-sonnet-4-6"];
  return (inputTokens / 1e6) * r.in + (outputTokens / 1e6) * r.out;
}
export function monthlyTokenCap(plan) {
  if (plan === "team") return config.caps.team;
  if (plan === "pro") return config.caps.pro;
  return 0; // free tier gated by run count, not tokens
}
export function modelForPlan(plan) {
  return plan === "free" ? config.anthropic.modelFree : config.anthropic.modelPaid;
}
