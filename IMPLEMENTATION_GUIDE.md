# Crucible — Implementation Guide

This guide takes you from **nothing installed** to a **live app that takes payments**. It assumes
you have never run code before. Do the phases in order. Each step tells you exactly what to type or
click and what you should see. When you see a box like this:

```
some command
```

it means "type that line into your terminal and press Enter."

There are four checkpoints. You can stop at any checkpoint and have something that works:
- **Checkpoint A** — the app runs on your own computer.
- **Checkpoint B** — it's live on the internet (free tier).
- **Checkpoint C** — it takes payments (Stripe).
- **Checkpoint D** — email, ads, and scale.

---

## Phase 0 — What you're building and what you'll need

Crucible is a website with a small server behind it. The server talks to Anthropic (the AI),
Stripe (payments), and optionally an email service and an ad network. You will need accounts with
those companies. **You** hold all the passwords and keys; the code only ever refers to them by name.

Time: Checkpoint A ~30 min. B ~30 min. C ~45 min. D ~60 min.

---

## Phase 1 — Install the tools (one time)

### 1.1 Install Node.js
Node.js is the program that runs the server.

1. Go to <https://nodejs.org>.
2. Download the button that says **LTS** (it will say a version like "20.x LTS").
3. Open the downloaded file and click through the installer (accept defaults).
4. Verify it worked. Open a terminal:
   - **macOS:** press Cmd+Space, type `Terminal`, press Enter.
   - **Windows:** press the Start key, type `PowerShell`, press Enter.
5. In the terminal, type:
   ```
   node --version
   ```
   You should see something like `v20.11.0`. If you see "command not found," restart the terminal
   (close it and open a new one). If still failing, reinstall Node and restart your computer.

### 1.2 Install Git
Git downloads the code and, later, pushes it to your host.

- **macOS:** in the terminal type `git --version`. If it's missing, it will offer to install
  "command line developer tools" — click Install.
- **Windows:** download from <https://git-scm.com/download/win>, run the installer, accept defaults.
- Verify: `git --version` shows a version number.

### 1.3 Install a code editor (recommended)
Download **VS Code** from <https://code.visualstudio.com>. You'll use it to edit the `.env` file.
(Any plain-text editor works. Do **not** use Word.)

---

## Phase 2 — Get the code onto your computer

1. Put the `crucible-app` folder somewhere you'll find it, e.g. your Desktop.
2. In the terminal, move into the server folder. Type `cd ` (with a space), then drag the
   `crucible-app/server` folder from your file browser onto the terminal window (this pastes the
   path), then press Enter. It looks like:
   ```
   cd /Users/you/Desktop/crucible-app/server
   ```
3. Confirm you're in the right place:
   ```
   ls
   ```
   You should see `package.json`, `src`, `views`, `public`.

---

## Phase 3 — Get your Anthropic key (the only key you need for Checkpoint A)

1. Go to <https://console.anthropic.com/> and sign up / log in.
2. Add a payment method and a little credit (Billing). Runs cost cents; a few dollars lasts a long time.
3. Go to **API Keys** → **Create Key**. Copy the key that starts with `sk-ant-`.
   You will paste it in the next phase. **Treat it like a password.** If it leaks, delete it and make a new one.

---

## Phase 4 — Configure the app (`.env` file)

The `.env` file holds your secrets. It is never shared or committed.

1. Make your own copy of the template:
   ```
   cp .env.example .env
   ```
2. Open it in VS Code:
   ```
   code .env
   ```
   (If `code` doesn't work, open VS Code, then File → Open, and pick the `.env` file in the server folder.)
3. Fill in these two lines at minimum:
   - `ANTHROPIC_API_KEY=` → paste your `sk-ant-...` key right after the `=` (no spaces, no quotes).
   - `JWT_SECRET=` → this must be a long random string. Generate one: in the terminal run
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
     Copy the long output and paste it after `JWT_SECRET=`.
4. Leave everything else as-is for now. Save the file (Cmd/Ctrl+S).

---

## Phase 5 — Run it locally  ✅ CHECKPOINT A

1. Install the code's dependencies (one time, needs internet):
   ```
   npm install
   ```
   Wait for it to finish (it prints a summary). Warnings are usually fine; a red "ERR!" is not.
2. Start the server:
   ```
   npm start
   ```
   You should see `Crucible on http://localhost:8080`. Leave this terminal running.
3. Open a web browser and go to <http://localhost:8080>. You'll see the landing page.
4. Click **Run the crucible** (top right) to open the app at `/app`.
5. Click **Create an account**, enter any email and a password (8+ characters), and submit.
6. A decision is pre-filled. Click **Run the crucible**. In a few seconds you'll get a verdict,
   five strikes, and a gauge. **That's the whole product working on your machine.**
   - The verification email link is printed in the terminal (you haven't set up email yet — that's expected).
7. To stop the server later: click the terminal and press Ctrl+C. To start again: `npm start`.

**If a run fails** with "AI service could not be reached," your `ANTHROPIC_API_KEY` is wrong or has
no credit. Fix it in `.env`, stop the server (Ctrl+C), and `npm start` again.

---

## Phase 6 — Make yourself the admin (see cost dashboard)

1. In `.env`, set `ADMIN_EMAILS=` to the exact email you signed up with, e.g.
   `ADMIN_EMAILS=you@example.com`.
2. Stop (Ctrl+C) and restart (`npm start`).
3. Sign in at `/app`, then visit <http://localhost:8080/admin>. You'll see users, runs, and cost.

---

## Phase 7 — Put it on the internet  ✅ CHECKPOINT B (using Render)

Render hosts the app for a small monthly fee and gives you an `https://` address.

### 7.1 Put your code in a GitHub repo
1. Create a free account at <https://github.com>.
2. Install GitHub Desktop from <https://desktop.github.com> (easiest, no commands).
3. In GitHub Desktop: **File → Add local repository →** choose the top `crucible-app` folder →
   it will offer to create a repository → **Create a repository** → **Publish repository**
   (choose **Private**). Your code is now on GitHub.
   - The `.gitignore` already prevents your `.env` and database from being uploaded. Good.

### 7.2 Create the service on Render
1. Sign up at <https://render.com> and connect your GitHub.
2. **New → Blueprint**. Pick your `crucible-app` repository. Render reads `server/render.yaml`
   and proposes a web service with a disk. Click **Apply**.
3. When it asks for the secret values (the ones marked "sync: false"), fill in at least:
   - `ANTHROPIC_API_KEY` = your `sk-ant-...`
   - `APP_URL` = leave blank for now; you'll set it once you know your URL.
   - `ADMIN_EMAILS` = your email.
   (JWT_SECRET is generated for you.)
4. Deploy. When it's live, Render shows a URL like `https://crucible-xxxx.onrender.com`.
5. Set `APP_URL` to that exact URL (Environment tab), and save — this triggers a redeploy.
6. Visit the URL. Sign up, run a decision. **You're live.**

> Fly.io alternative: `fly.toml` is included. Install the Fly CLI, run `fly launch --no-deploy`,
> then `fly secrets set ANTHROPIC_API_KEY=... JWT_SECRET=... ADMIN_EMAILS=... APP_URL=https://yourapp.fly.dev`,
> then `fly deploy`.

---

## Phase 8 — Take payments with Stripe  ✅ CHECKPOINT C

Do everything in **Test mode** first (there's a toggle in the Stripe dashboard). Test mode uses fake
cards so you can rehearse safely.

### 8.1 Create the products
1. Sign up at <https://dashboard.stripe.com>. Turn ON **Test mode** (top-right toggle).
2. **Product catalog → Add product.**
   - Product 1: name "Crucible Pro", price **$12**, **Recurring / monthly**. Save.
     Open it and copy the **Price ID** (starts with `price_`).
   - Product 2: name "Crucible Team", price **$39**, **Recurring / monthly**. Save. Copy its Price ID.

### 8.2 Get your secret key
- **Developers → API keys →** copy the **Secret key** (`sk_test_...` in test mode).

### 8.3 Create the webhook
The webhook lets Stripe tell your app when someone pays.
1. **Developers → Webhooks → Add endpoint.**
2. Endpoint URL: `https://YOUR-RENDER-URL/api/billing/webhook`
3. **Select events:** add `checkout.session.completed` and `customer.subscription.deleted`.
4. Save, then click **Reveal** on the **Signing secret** and copy it (`whsec_...`).

### 8.4 Put the four values into your host
In Render → your service → **Environment**, add:
- `STRIPE_SECRET_KEY` = `sk_test_...`
- `STRIPE_WEBHOOK_SECRET` = `whsec_...`
- `STRIPE_PRICE_PRO` = the Pro `price_...`
- `STRIPE_PRICE_TEAM` = the Team `price_...`
Save (redeploys).

### 8.5 Test a purchase
1. On your live site, use up your 2 free runs, then click a paid plan in the popup.
2. On the Stripe checkout page use the test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
3. After paying you're returned to the app, now on the Pro plan with no ads and no limit.
4. When it works in test mode, repeat 8.1–8.4 with Stripe **Live mode** to take real money.

> To test payments on your own computer instead, install the Stripe CLI and run
> `stripe listen --forward-to localhost:8080/api/billing/webhook` — it prints a `whsec_...` to use locally.

---

## Phase 9 — Email, ads, and scale  ✅ CHECKPOINT D

### 9.1 Real emails (verification + password reset)
1. Sign up at <https://resend.com>, verify a sending domain (follow their DNS steps).
2. Create an API key, and in your host set `RESEND_API_KEY=` and
   `MAIL_FROM=Crucible <noreply@yourdomain.com>`. Save. Emails now send for real.

### 9.2 Ads on the free tier
Do this only after your site is live with the Privacy and Terms pages (they are, at `/privacy` and
`/terms` — but **have a lawyer review them first**, see Phase 10).
1. Apply to **Google AdSense** (<https://adsense.com>) or **Media.net**. Approval needs a public site
   with content and policy pages, which you have.
2. Once approved, AdSense gives you a **publisher ID** (`ca-pub-...`) and, when you create an ad unit,
   a **slot ID**. AdSense also gives you an **ads.txt line**.
3. Edit `server/public/ads.txt` and replace the placeholder with the exact line AdSense gives you.
   Commit and redeploy (GitHub Desktop → Commit → Push).
4. In your host set:
   - `ADS_ENABLED=true`
   - `AD_NETWORK=adsense`
   - `AD_CLIENT_ID=ca-pub-...`
   - `AD_SLOT_RESULTS=` your ad unit's slot id
   - `ADS_REQUIRE_CONSENT=true`
   Save. Free users now see one ad on the results screen; Pro users never do.
5. **If ads don't show and the browser console mentions CSP**, some ad code needs inline scripts.
   Set `CSP_ALLOW_INLINE=true` and redeploy. This is the documented security trade-off for ad
   compatibility — see **9.5** below for exactly what we observed and why this flag exists.

### 9.3 Cost controls (already on — how to tune)
- Free users run on the cheaper model (`ANTHROPIC_MODEL_FREE`, default Haiku). Paid users get the
  better model (`ANTHROPIC_MODEL_PAID`, default Sonnet). Change either in env.
- "Unlimited" plans have a monthly token ceiling: `PRO_MONTHLY_TOKEN_CAP`, `TEAM_MONTHLY_TOKEN_CAP`.
  Raise or lower them as your margins dictate. Watch spend at `/admin`.

### 9.4 Scale (only when you have real traffic)
- **Redis rate-limiting across instances:** set `REDIS_URL` (from any managed Redis) and run
  `npm install ioredis rate-limit-redis`, redeploy. Without it, the built-in single-node limiter is used.
- **Postgres instead of SQLite:** SQLite is fine for a single instance. When you outgrow it, migrate
  the data layer (`src/lib/db.js`) to Postgres (the `pg` library). This is a code change, not a config
  toggle — ask a developer (or me) to port `db.js`; the rest of the app is written to not care which
  database is underneath.

### 9.5 CSP and ad script compatibility (the `CSP_ALLOW_INLINE` trade-off)
By default the app ships a **strict Content-Security-Policy**: `script-src` trusts only `'self'`, a
fresh **per-request nonce**, and the ad hosts (`*.googlesyndication.com`, `*.google.com`,
`*.doubleclick.net`, `*.media.net`). It does **not** include `'unsafe-inline'`. The server injects the
nonce into the app's own inline `<script>` as it serves each page (`sendView()` in
`middleware/security.js`), so the app's first-party code — including the Google Consent Mode v2 setup —
runs fine under this strict policy.

**What we tested and observed (Playwright + Chromium, real flow: sign up → mocked run → results →
consent "Allow", with a `securitypolicyviolation` listener capturing every violation):**

- Under the strict default (`CSP_ALLOW_INLINE=false`), the whole first-party flow produced **zero CSP
  violations**. The app also successfully injects the AdSense loader
  `<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js">` and the browser
  attempts to fetch it — **CSP does not block that loader tag**, because its host is allow-listed in
  `script-src`. So loading Google's script is fine; the question is what that script does next.
- AdSense renders real ad creatives by having `adsbygoogle.js` **dynamically inject further inline
  `<script>` elements client-side at runtime**. Those injected inline scripts are created by Google's
  code, not served through `sendView()`, so **they never carry the server's nonce**. We reproduced this
  exact case against the app's real CSP headers: a client-injected inline `<script>` (no nonce) is
  **blocked under the strict default** — a `securitypolicyviolation` fires with `blockedURI: "inline"`,
  `violatedDirective: "script-src-elem"` — while under `CSP_ALLOW_INLINE=true` the identical inline
  script runs with **no violation**. (Note: this CSP does not set `'strict-dynamic'`, which would let a
  nonced loader vouch for the scripts it injects; and `eval`/`new Function` were observed to still run
  under both modes, since the policy sets no `'unsafe-eval'` restriction either way.)
- **Sandbox limitation — read this before trusting a "no ad" result:** in our test environment,
  outbound network to Google's ad servers is blocked (the loader request failed at the network layer,
  not at CSP), so Google's real `adsbygoogle.js` never executed and **no real ad creative could be
  observed rendering under either policy**. We could not, and do not claim to have, proven an ad fully
  renders end-to-end here. What we *did* prove is the CSP mechanism: the strict nonce policy blocks the
  kind of runtime-injected inline scripts AdSense relies on, and `CSP_ALLOW_INLINE=true` unblocks them.

**What this means for you:** keep the strict default (it's the safer policy). If, on your live site
with an approved `ca-pub-...` account, ads render blank **and** the browser console shows CSP
violations on inline scripts, set `CSP_ALLOW_INLINE=true` and redeploy. That switch replaces the
per-request nonce with `'unsafe-inline'` for **all** scripts on the page — a real reduction in your XSS
defenses, applied site-wide, in exchange for ad compatibility. It is the intended, documented escape
hatch; do not weaken the default policy in code instead. To confirm the end-to-end behavior on your
deployment, open the results screen as a free user, accept consent, and watch the browser console /
Network tab for CSP violations from `googlesyndication`/`doubleclick` inline scripts.

---

## Phase 10 — Before you charge strangers (do not skip)

These are the things software cannot finish for you:

1. **Lawyer review.** `views/privacy.html` and `views/terms.html` are honest drafts that match how the
   app behaves — they are **not legal advice**. A lawyer must adapt them to you and your jurisdiction,
   and confirm your ad-consent obligations (GDPR/UK GDPR/CPRA). For personalized ads to EEA/UK users
   you need a certified consent management platform (CMP); the app has the on/off hook but you must
   supply a compliant CMP.
2. **Security review.** Have someone do a basic security pass / pen-test before real accounts and cards.
3. **Load test.** Confirm it holds up under the traffic you expect; move to Postgres/Redis if needed.
4. **Business terms.** You own the relationships and terms with Anthropic, Stripe, your email provider,
   and your ad network. Read their policies.

---

## Troubleshooting

- **"command not found: node/npm/git"** — the tool isn't installed or the terminal is stale. Reinstall,
  then open a brand-new terminal.
- **`npm install` fails on `better-sqlite3`** — it needs build tools. On Windows, reinstall Node.js and
  check "Tools for Native Modules" in the installer. On Mac, run `xcode-select --install` first.
- **Runs fail / "AI service could not be reached"** — bad or unfunded `ANTHROPIC_API_KEY`. Fix in env, restart.
- **"Invalid session token" on actions** — a stale page. Refresh the browser tab.
- **Stripe payment doesn't upgrade the account** — the webhook URL is wrong or the events aren't
  selected. Recheck Phase 8.3, and look at Stripe → Webhooks → your endpoint → recent deliveries for errors.
- **Ads blank** — not approved yet, wrong IDs, or CSP (see 9.5). Ad approval can take days.
- **Locked out of `/admin`** — your signed-in email isn't in `ADMIN_EMAILS`. Fix env, restart, sign in again.

---

You now have a running, secure, monetizable app. Work the checkpoints in order, and don't enable ads
or take live payments until Phase 10 is genuinely done.