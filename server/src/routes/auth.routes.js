import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { Users } from "../lib/db.js";
import { send, verifyEmail, resetEmail } from "../lib/mailer.js";
import { setSession, clearSession, publicUser, auth } from "../middleware/auth.js";

const rand = (n = 24) => crypto.randomBytes(n).toString("hex");

export function authRoutes({ limiter }) {
  const r = express.Router();

  r.post("/signup", limiter, async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (Users.byEmail.get(email)) return res.status(409).json({ error: "That email already has an account." });
    const token = rand();
    const info = Users.create.run(email, await bcrypt.hash(password, 12), token, new Date(Date.now() + 864e5).toISOString());
    const user = Users.byId.get(info.lastInsertRowid);
    try { await send({ to: email, ...verifyEmail(config.appUrl, token) }); } catch (e) { console.error("verify email failed", e.message); }
    setSession(res, user);
    res.json({ user: publicUser(user) });
  });

  r.post("/login", limiter, async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const user = Users.byEmail.get(email);
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash)))
      return res.status(401).json({ error: "Email or password is wrong." });
    setSession(res, user);
    res.json({ user: publicUser(user) });
  });

  r.post("/logout", (req, res) => { clearSession(res); res.json({ ok: true }); });
  r.get("/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.get("/verify", (req, res) => {
    const user = Users.byVerifyToken.get(String(req.query.token || ""));
    if (!user || (user.verify_expires && new Date(user.verify_expires) < new Date())) return res.redirect("/app?verify=failed");
    Users.markVerified.run(user.id);
    res.redirect("/app?verify=ok");
  });

  r.post("/forgot", limiter, async (req, res) => {
    const user = Users.byEmail.get(String(req.body.email || "").trim().toLowerCase());
    if (user) {
      const token = rand();
      Users.setReset.run(token, new Date(Date.now() + 36e5).toISOString(), user.id);
      try { await send({ to: user.email, ...resetEmail(config.appUrl, token) }); } catch (e) { console.error("reset email failed", e.message); }
    }
    res.json({ ok: true }); // never reveal whether the email exists
  });

  r.post("/reset", limiter, async (req, res) => {
    const password = String(req.body.password || "");
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    const user = Users.byResetToken.get(String(req.body.token || ""));
    if (!user || (user.reset_expires && new Date(user.reset_expires) < new Date()))
      return res.status(400).json({ error: "That reset link is invalid or expired." });
    Users.applyReset.run(await bcrypt.hash(password, 12), user.id);
    res.json({ ok: true });
  });

  return r;
}
