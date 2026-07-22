// Security middleware: HTTPS redirect, helmet + CSP (strict nonce by default),
// CSRF (double-submit cookie), HTML serving with nonce injection, rate limiters.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";

const CSRF_COOKIE = "cru_csrf";
const rand = (n = 24) => crypto.randomBytes(n).toString("hex");
const AD_HOSTS = ["https://*.googlesyndication.com", "https://*.google.com", "https://*.doubleclick.net", "https://*.media.net"];

export function httpsOnly(req, res, next) {
  if (config.prod && req.headers["x-forwarded-proto"] === "http")
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  next();
}

// Generates a per-request nonce and builds a CSP that trusts only that nonce for
// inline scripts (dropping 'unsafe-inline'). If CSP_ALLOW_INLINE=true (some ad
// networks require it), falls back to 'unsafe-inline' and skips the nonce.
export function securityHeaders() {
  return (req, res, next) => {
    res.locals.nonce = rand(16);
    const scriptSrc = config.cspAllowInline
      ? ["'self'", "'unsafe-inline'", ...AD_HOSTS]
      : ["'self'", `'nonce-${res.locals.nonce}'`, ...AD_HOSTS];
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc,
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:"],
          frameSrc: AD_HOSTS,
        },
      },
      crossOriginEmbedderPolicy: false,
    })(req, res, next);
  };
}

export function csrfCookie(req, res, next) {
  if (!req.cookies[CSRF_COOKIE])
    res.cookie(CSRF_COOKIE, rand(24), { httpOnly: false, secure: config.prod, sameSite: "lax", path: "/" });
  next();
}
export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const c = req.cookies[CSRF_COOKIE], h = req.get("x-csrf-token");
  if (!c || !h || c !== h) return res.status(403).json({ error: "Invalid session token. Refresh and try again." });
  next();
}

// Serves an HTML view, injecting the per-request nonce into inline <script> tags
// (unless we're in unsafe-inline mode). Files are read fresh so edits show without restart in dev.
const VIEWS = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "views");
export function sendView(res, file) {
  let html;
  try { html = fs.readFileSync(path.join(VIEWS, file), "utf8"); }
  catch { return res.status(404).send("Not found"); }
  if (!config.cspAllowInline) html = html.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${res.locals.nonce}"`);
  res.type("html").send(html);
}

// Rate limiter factory. Uses Redis if REDIS_URL is set AND the optional packages
// (ioredis, rate-limit-redis) are installed; otherwise memory (fine for one node).
export async function makeLimiter({ windowMs, max }) {
  if (config.redisUrl) {
    try {
      const [{ default: RedisStore }, { default: IORedis }] = await Promise.all([
        import("rate-limit-redis"), import("ioredis"),
      ]);
      const client = new IORedis(config.redisUrl);
      return rateLimit({ windowMs, max, store: new RedisStore({ sendCommand: (...a) => client.call(...a) }) });
    } catch (e) { console.warn("Redis rate-limit unavailable, using memory store:", e.message); }
  }
  return rateLimit({ windowMs, max });
}
