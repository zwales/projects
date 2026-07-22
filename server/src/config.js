// Central configuration. Every module reads env through this file — one source of truth.
import "dotenv/config";

const bool = (v, d = false) => (v == null ? d : String(v).toLowerCase() === "true");
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const port = num(process.env.PORT, 8080);

export const config = {
  port,
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  prod: process.env.NODE_ENV === "production",
  jwtSecret: process.env.JWT_SECRET || "dev-insecure-secret-change-me",
  dbPath: process.env.DB_PATH || "./crucible.db",
  databaseUrl: process.env.DATABASE_URL || "",
  freeRunLimit: num(process.env.FREE_RUN_LIMIT, 2),
  requireVerify: bool(process.env.REQUIRE_EMAIL_VERIFICATION, false),
  redisUrl: process.env.REDIS_URL || "",
  cspAllowInline: bool(process.env.CSP_ALLOW_INLINE, false),
  adminEmails: (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),

  anthropic: {
    key: process.env.ANTHROPIC_API_KEY || "",
    modelFree: process.env.ANTHROPIC_MODEL_FREE || "claude-haiku-4-5",
    modelPaid: process.env.ANTHROPIC_MODEL_PAID || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  },
  caps: {
    pro: num(process.env.PRO_MONTHLY_TOKEN_CAP, 2_000_000),
    team: num(process.env.TEAM_MONTHLY_TOKEN_CAP, 6_000_000),
  },
  mail: {
    resendKey: process.env.RESEND_API_KEY || "",
    from: process.env.MAIL_FROM || "Crucible <noreply@localhost>",
  },
  stripe: {
    secret: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    pricePro: process.env.STRIPE_PRICE_PRO || "",
    priceTeam: process.env.STRIPE_PRICE_TEAM || "",
  },
  ads: {
    enabled: bool(process.env.ADS_ENABLED, false),
    network: process.env.AD_NETWORK || "adsense",
    clientId: process.env.AD_CLIENT_ID || "",
    slotResults: process.env.AD_SLOT_RESULTS || "",
    requireConsent: bool(process.env.ADS_REQUIRE_CONSENT, true),
  },
};

export default config;
