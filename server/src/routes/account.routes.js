import express from "express";
import { Runs, eraseUser } from "../lib/db.js";
import { auth, clearSession } from "../middleware/auth.js";

export function accountRoutes() {
  const r = express.Router();

  // GDPR/CPRA data export: everything we hold on this user.
  r.get("/export", auth, (req, res) => {
    const runs = Runs.allForUser.all(req.user.id).map((x) => ({ ...x, payload: JSON.parse(x.payload) }));
    res.setHeader("Content-Disposition", "attachment; filename=crucible-data.json");
    res.json({
      account: { email: req.user.email, plan: req.user.plan, created_at: req.user.created_at },
      runs,
      exported_at: new Date().toISOString(),
    });
  });

  // Right to erasure: delete the account and all associated data, then end the session.
  r.delete("/", auth, (req, res) => {
    eraseUser(req.user.id);
    clearSession(res);
    res.json({ ok: true });
  });

  return r;
}
