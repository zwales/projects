# Crucible

Adversarial decision testing. Five hostile AIs attack a decision from five angles; a judge
issues a structural-integrity verdict with the ways it dies, the cheapest fixes, and kill criteria.

This is the production build: secure cookie auth, enforced free-tier gating, Stripe subscriptions,
cost controls, an ad-supported free tier, account export/erasure, and an admin cost dashboard.

> **New here? Read `IMPLEMENTATION_GUIDE.md`.** It walks you from "I have never run code"
> to a live, paid app, step by step, assuming nothing.

## Structure

```
crucible-app/
  README.md                 this file
  IMPLEMENTATION_GUIDE.md    granular, do-this-then-that launch guide
  .gitignore
  server/
    package.json  Dockerfile  render.yaml  fly.toml  .env.example
    src/
      index.js              composes the app (async bootstrap)
      config.js             ONE place that reads env
      lib/
        db.js               SQLite: users, runs, usage, erasure, admin stats
        crucible.js         5 adversaries + judge (prompt caching, cost accounting)
        pricing.js          cost table, model routing, fair-use caps
        mailer.js           Resend (prod) / console (dev)
      middleware/
        security.js         helmet + strict-nonce CSP, CSRF, HTTPS, nonce view server, limiters
        auth.js             session cookies, publicUser, admin guard
      routes/
        auth.routes.js      signup / login / logout / verify / reset
        run.routes.js       /api/run (gated, cost-capped) + saved verdicts
        billing.routes.js   Stripe checkout + idempotent webhook
        account.routes.js   data export + account deletion (GDPR/CPRA)
        admin.routes.js     cost/usage stats (ADMIN_EMAILS only)
    views/                  HTML served with per-request CSP nonce
      index.html (landing)  app.html  admin.html  privacy.html  terms.html
    public/                 static assets served as-is (ads.txt)
```

## What's in this version

- **Security:** httpOnly Secure SameSite session cookies (no token in localStorage), double-submit
  **CSRF**, **helmet + strict nonce CSP** (no `unsafe-inline` for scripts), bcrypt(12), email
  verification, password reset (no user-enumeration), Stripe **webhook signature + idempotency**,
  auth/run rate limits (Redis-optional).
- **Economics:** **prompt caching** on fixed prompts, **cheap model on free / better on paid**,
  **per-run token + cost accounting**, **monthly fair-use token caps** on unlimited plans.
- **Product:** shareable **verdict card** (PNG), saved history, consent-gated **ads** on free tier.
- **Compliance/ops:** **data export** + **account erasure**, **admin cost dashboard** at `/admin`.

## Run it in 60 seconds (local)

```bash
cd server
cp .env.example .env      # fill ANTHROPIC_API_KEY + JWT_SECRET at minimum
npm install
npm start                 # http://localhost:8080  (/app is the product)
```

Full setup, accounts, Stripe, email, deploy, and ads: see **IMPLEMENTATION_GUIDE.md**.

## The permanent rule about secrets

Every secret is referenced by name (`process.env.*`) via `src/config.js`. Put real values in your
host's secret store or a local `.env` (never committed). Do not paste live keys into chat tools or
commits. If a key is ever exposed, rotate it.

## Before charging real customers

A lawyer must review `views/privacy.html` and `views/terms.html` and your consent/CMP setup; you
must do a security review and load test. See the checklist at the end of the implementation guide.

## Autonomous build loop (optional, advanced)

This repo carries a plan → execute → judge loop for Claude Code:

```
.claude/commands/fable.md     the orchestrator (/fable) — plans and judges, never codes
.claude/agents/opus-executor.md  the worker — builds and verifies, reports back
FABLE_TASKS.md                a ready-to-paste brain-dump of the remaining work
```

Because these live in the repo, any Claude Code session (including **Claude Code on the web**, which
you can drive from the mobile app) auto-loads them. Put the repo on GitHub, open a web session on it,
type `/fable`, and paste the contents of `FABLE_TASKS.md`. Workers run on Opus by default for
reliability; switch `model: opus` → `model: sonnet` in the agent file to cut cost once you trust it.
Review every pull request before merging — especially anything touching auth, billing, or secrets.
