import express from "express";
import { Admin } from "../lib/db.js";
import { auth, requireAdmin } from "../middleware/auth.js";

export function adminRoutes() {
  const r = express.Router();
  // Cost/usage dashboard data. Gated to ADMIN_EMAILS.
  r.get("/stats", auth, requireAdmin, async (req, res) => res.json(await Admin.stats()));
  return r;
}
