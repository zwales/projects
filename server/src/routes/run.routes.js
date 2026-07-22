import express from "express";
import { config } from "../config.js";
import { Runs, Usage } from "../lib/db.js";
import { runCrucible } from "../lib/crucible.js";
import { modelForPlan, monthlyTokenCap } from "../lib/pricing.js";
import { auth, publicUser } from "../middleware/auth.js";

export function runRoutes({ limiter }) {
  const r = express.Router();

  r.post("/run", auth, limiter, async (req, res) => {
    const decision = String(req.body.decision || "").trim();
    const kind = String(req.body.kind || "Decision");
    const stakes = String(req.body.stakes || "Costly to undo");
    if (!decision) return res.status(400).json({ error: "Write the decision you want tested." });
    if (decision.length > 4000) return res.status(400).json({ error: "Keep the decision under 4000 characters." });
    if (config.requireVerify && !req.user.email_verified)
      return res.status(403).json({ error: "Confirm your email to run the crucible. Check your inbox." });

    const plan = req.user.plan;
    if (plan === "free") {
      if ((await Runs.countForUser.get(req.user.id)).n >= config.freeRunLimit)
        return res.status(402).json({ error: "You've used your free runs.", upgrade: true });
    } else {
      const cap = monthlyTokenCap(plan);
      if (cap > 0) {
        const u = await Usage.get(req.user.id);
        if (u.input_tokens + u.output_tokens >= cap)
          return res.status(429).json({ error: "You've hit this month's fair-use limit. It resets on the 1st, or contact us to raise it." });
      }
    }

    try {
      const model = modelForPlan(plan);
      const result = await runCrucible(decision, kind, stakes, model);
      await Usage.add(req.user.id, result.usage.input, result.usage.output, result.usage.cost);
      const info = await Runs.create.run({
        user_id: req.user.id, decision, kind, stakes,
        integrity: result.verdict?.integrity ?? null, verdict: result.verdict?.verdict ?? null,
        payload: JSON.stringify({ strikes: result.strikes, verdict: result.verdict }),
        input_tokens: result.usage.input, output_tokens: result.usage.output, cost_usd: result.usage.cost,
      });
      res.json({ runId: info.lastInsertRowid, strikes: result.strikes, verdict: result.verdict, user: await publicUser(req.user) });
    } catch (e) {
      if (e.code === "ALL_FAILED") return res.status(502).json({ error: "The AI service could not be reached. Try again in a moment." });
      console.error("run error", e);
      res.status(500).json({ error: "Something broke while running the crucible." });
    }
  });

  r.get("/verdicts", auth, async (req, res) => res.json({ verdicts: await Runs.listForUser.all(req.user.id) }));
  r.get("/verdicts/:id", auth, async (req, res) => {
    const row = await Runs.byId.get(Number(req.params.id), req.user.id);
    if (!row) return res.status(404).json({ error: "Not found." });
    res.json({ ...row, payload: JSON.parse(row.payload) });
  });

  return r;
}
