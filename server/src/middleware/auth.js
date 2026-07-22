import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { Users, Runs } from "../lib/db.js";

const SESSION_COOKIE = "cru_session";

export function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: "30d" });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.prod, sameSite: "lax", maxAge: 30 * 864e5, path: "/" });
}
export function clearSession(res) { res.clearCookie(SESSION_COOKIE, { path: "/" }); }

export async function publicUser(u) {
  const used = (await Runs.countForUser.get(u.id)).n;
  return { id: u.id, email: u.email, plan: u.plan, emailVerified: !!u.email_verified,
    runsUsed: used, runsLeft: u.plan === "free" ? Math.max(0, config.freeRunLimit - used) : null };
}

export async function auth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try {
    const { uid } = jwt.verify(token, config.jwtSecret);
    const user = await Users.byId.get(uid);
    if (!user) return res.status(401).json({ error: "Session expired. Sign in again." });
    req.user = user; next();
  } catch { return res.status(401).json({ error: "Session expired. Sign in again." }); }
}

export function requireAdmin(req, res, next) {
  if (!req.user || !config.adminEmails.includes(req.user.email.toLowerCase()))
    return res.status(403).json({ error: "Not authorized." });
  next();
}
