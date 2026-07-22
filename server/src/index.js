import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { initSchema } from "./lib/db.js";
import { httpsOnly, securityHeaders, csrfCookie, requireCsrf, sendView, makeLimiter } from "./middleware/security.js";
import { authRoutes } from "./routes/auth.routes.js";
import { runRoutes } from "./routes/run.routes.js";
import { accountRoutes } from "./routes/account.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { billingRoutes, webhookHandler, billingEnabled } from "./routes/billing.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

async function main() {
  await initSchema();

  const app = express();
  app.set("trust proxy", 1);
  app.use(httpsOnly);
  app.use(securityHeaders());

  // Stripe webhook needs the RAW body — mount before express.json.
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), webhookHandler);

  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(csrfCookie);

  const authLimiter = await makeLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
  const runLimiter = await makeLimiter({ windowMs: 60 * 1000, max: 12 });

  app.get("/api/config", (req, res) => res.json({
    freeLimit: config.freeRunLimit,
    billingEnabled,
    requireVerify: config.requireVerify,
    plans: [
      { id: "pro", name: "Pro", price: "$12/mo", perks: ["Unlimited runs", "Saved verdicts", "No ads"] },
      { id: "team", name: "Team", price: "$39/mo", perks: ["Everything in Pro", "Shared crucibles", "Export to docs & Slack"] },
    ],
    ads: config.ads,
  }));

  app.use("/api/auth", requireCsrf, authRoutes({ limiter: authLimiter }));
  app.use("/api/billing", requireCsrf, billingRoutes());
  app.use("/api", requireCsrf, runRoutes({ limiter: runLimiter }));
  app.use("/api/account", requireCsrf, accountRoutes());
  app.use("/api/admin", adminRoutes());

  // Static assets (ads.txt, future css/js). HTML is served via views with nonce injection.
  app.use(express.static(PUBLIC));
  app.get("/", (req, res) => sendView(res, "index.html"));
  app.get(["/app", "/app/*"], (req, res) => sendView(res, "app.html"));
  app.get("/admin", (req, res) => sendView(res, "admin.html"));
  app.get("/privacy", (req, res) => sendView(res, "privacy.html"));
  app.get("/terms", (req, res) => sendView(res, "terms.html"));

  app.listen(config.port, () => {
    console.log(`Crucible on ${config.appUrl}`);
    if (!config.anthropic.key) console.warn("  ! ANTHROPIC_API_KEY not set — runs will fail until you add it.");
    if (!billingEnabled) console.warn("  ! Stripe not configured — paid upgrades disabled (free tier still works).");
    if (!config.prod) console.warn("  ! NODE_ENV != production — cookies aren't Secure and HTTPS redirect is off.");
  });
}

main().catch((e) => { console.error("Failed to start:", e); process.exit(1); });
