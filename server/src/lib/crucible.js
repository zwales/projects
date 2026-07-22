// Server-side orchestration: 5 adversaries + judge, prompt caching, cost accounting.
import { config } from "../config.js";
import { costUSD } from "./pricing.js";

const API_URL = "https://api.anthropic.com/v1/messages";

export const ADVERSARIES = [
  { id: "investor", name: "The Investor", glyph: "$", angle: "Money",
    lens: "You judge capital efficiency and returns. You have seen a thousand decks and assume most bets return nothing." },
  { id: "rival", name: "The Rival", glyph: "\u25B2", angle: "Competition",
    lens: "You are a well-funded competitor. Your job is to copy, undercut, or out-position this the moment it shows traction." },
  { id: "defector", name: "The Defector", glyph: "\u21B6", angle: "Demand",
    lens: "You are the customer who never buys, or buys once and leaves. You are busy, skeptical, and loyal to your current habit." },
  { id: "operator", name: "The Operator", glyph: "\u2699", angle: "Execution",
    lens: "You have to actually build and run this. You know where execution breaks: dependencies, single points of failure, the unglamorous middle." },
  { id: "realist", name: "The Realist", glyph: "\u00A7", angle: "Reality",
    lens: "You track second-order effects, legal and ethical exposure, and shocks nobody planned for. You ask what happens when the world does not cooperate." },
];

function parseJSON(text) {
  if (!text) throw new Error("empty model response");
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a !== -1 && b !== -1) t = t.slice(a, b + 1);
  return JSON.parse(t);
}
const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

async function callClaude(system, user, model) {
  if (!config.anthropic.key) throw new Error("ANTHROPIC_API_KEY is not set");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(API_URL, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": config.anthropic.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: 700,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const u = data.usage || {};
    return { json: parseJSON(text), usage: {
      input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      output: u.output_tokens || 0 } };
  } finally { clearTimeout(timer); }
}

const advSystem = (a) => `You are ${a.name}. ${a.lens} You pressure-test decisions to find exactly where they fail. ` +
  `Be ruthless but fair and completely concrete. No hedging, no praise, no encouragement, no "it depends." ` +
  `Every claim must be specific to THIS decision, never generic advice. Respond ONLY with a JSON object, no markdown, no preamble.`;
const advUser = (a, d, k, s) => `DECISION UNDER TEST \u2014 type: ${k}; stakes: ${s}.\n\n"""${d}"""\n\n` +
  `Attack it through your lens only. Return JSON exactly:\n{"severity": <integer 0-100>,"headline": "<=8 word strike, no period>",` +
  `"strike": "<2-3 sentences: the specific mechanism by which this fails>","blindspot": "<the one assumption not questioned>",` +
  `"test": "<one cheap concrete thing to do within a week to check if your threat is real>"}`;
const JUDGE_SYSTEM = `You are the presiding judge of a decision crucible. Five adversaries each struck a decision from a different angle. ` +
  `Weigh the strikes by likelihood and how fatal each is, resolve a composite structural integrity, and issue a verdict a decision-maker can act on today. ` +
  `Be decisive and specific \u2014 reference the actual strikes. Respond ONLY with a JSON object, no markdown.`;

export async function runCrucible(decision, kind, stakes, model) {
  const settled = [], strikes = [];
  let inTok = 0, outTok = 0;
  await Promise.all(ADVERSARIES.map(async (adv) => {
    try {
      const { json: d, usage } = await callClaude(advSystem(adv), advUser(adv, decision, kind, stakes), model);
      inTok += usage.input; outTok += usage.output;
      const rec = { id: adv.id, name: adv.name, glyph: adv.glyph, angle: adv.angle, severity: clamp(d.severity),
        headline: String(d.headline || "").slice(0, 120), strike: String(d.strike || ""),
        blindspot: String(d.blindspot || ""), test: String(d.test || ""), state: "done" };
      strikes.push(rec); settled.push(rec);
    } catch { strikes.push({ id: adv.id, name: adv.name, glyph: adv.glyph, angle: adv.angle, state: "failed" }); }
  }));
  if (settled.length === 0) { const e = new Error("The crucible could not reach any adversary."); e.code = "ALL_FAILED"; throw e; }
  strikes.sort((a, b) => ADVERSARIES.findIndex((x) => x.id === a.id) - ADVERSARIES.findIndex((x) => x.id === b.id));

  let verdict = null;
  try {
    const strikeText = settled.map((r) => `- ${r.name} (severity ${r.severity}): ${r.headline} \u2014 ${r.strike}`).join("\n");
    const judgeUser = `DECISION (${kind}):\n"""${decision}"""\n\nADVERSARY STRIKES:\n${strikeText}\n\n` +
      `Return JSON exactly:\n{"integrity": <integer 0-100>,"verdict": "<SOUND | REINFORCE | RECAST>",` +
      `"verdict_line": "<one punchy sentence>","deadliest": ["...up to 3"],"fixes": ["...up to 3"],"kill_criteria": ["...up to 2"]}`;
    const { json: v, usage } = await callClaude(JUDGE_SYSTEM, judgeUser, model);
    inTok += usage.input; outTok += usage.output;
    verdict = { integrity: clamp(v.integrity),
      verdict: ["SOUND", "REINFORCE", "RECAST"].includes(String(v.verdict).toUpperCase()) ? String(v.verdict).toUpperCase() : "REINFORCE",
      verdict_line: String(v.verdict_line || ""), deadliest: (v.deadliest || []).slice(0, 3).map(String),
      fixes: (v.fixes || []).slice(0, 3).map(String), kill_criteria: (v.kill_criteria || []).slice(0, 2).map(String) };
  } catch { verdict = null; }

  return { strikes, verdict, usage: { input: inTok, output: outTok, cost: costUSD(model, inTok, outTok) } };
}
