# Crucible — remaining work, as a Fable brain-dump

**How to use this:** in a Claude Code session on this repo, type `/fable` and then paste
*everything below the line*. Fable will restate it, ask any questions once, split it into
workstreams, and fan them out to workers. Review the pull requests before merging — especially
anything touching auth, billing, or the ads/consent layer.

Two of these workstreams (3 and 4) both touch the ads/CSP area, so they must run one at a time.
Workstreams 1 and 2 are independent and can run in parallel.

---

Here is everything I need done on the Crucible app. Keep every change consistent with the existing
conventions (ES modules, central `config.js`, the `db.js` exported contract, `node --check` as the
minimum gate, verify by actually running the server on localhost).

**Workstream 1 — Add a Postgres option to the data layer (keep SQLite as the default).**
- Goal: when `DATABASE_URL` is set, use Postgres; otherwise keep using the current SQLite file. The
  rest of the app must not change at all.
- Touch `server/src/lib/db.js` and add the `pg` dependency to `server/package.json`. Add
  `DATABASE_URL` to `server/src/config.js` and to `server/.env.example` with a comment.
- Keep the exported surface identical: `Users`, `Runs`, `Usage`, `Events`, `Admin`, `eraseUser`,
  with the same method names and return shapes the routes already call. The cleanest approach is a
  thin driver: same object API, two implementations behind one `if (config.databaseUrl)`.
- Port the schema (users, runs, usage_month, processed_events) to Postgres types, and the
  `ON CONFLICT` upsert in `usage_month`, and the `eraseUser` transaction.
- Verify: with no `DATABASE_URL`, prove SQLite still works (start server, curl `/api/config`, sign
  up + `/api/me`). With a local Postgres `DATABASE_URL`, prove the same paths work. If no Postgres is
  reachable in the sandbox, mark the Postgres path "deploy-verify" and show the SQLite path passing.

**Workstream 2 — Automated tests.** (new files only; do not change app logic to fit tests)
- Use Node's built-in `node:test` and `node:assert`. Add an `npm test` script.
- Cover, against a throwaway SQLite DB (set `DB_PATH` to a temp file): signup then login returns a
  session and `publicUser`; CSRF rejects a POST with no `x-csrf-token`; the free-run gate returns 402
  after `FREE_RUN_LIMIT` runs (stub the Anthropic call so no network is needed — inject a fake runner
  or set a test flag; do NOT hit the real API); the monthly token cap returns 429 when exceeded;
  `eraseUser` removes the user and their runs and usage.
- Verify: paste the real `node --test` output. Green means green; if something can't be tested
  without the real API, say so rather than faking it.

**Workstream 3 — Real consent for ads (EEA/UK). HIGH RISK: ads + legal, flag for human review.**
- Today `views/app.html` has a simple allow/deny consent banner and `ADS_REQUIRE_CONSENT`. Upgrade it
  to Google **Consent Mode v2**: set consent state to denied by default, and only update to granted
  after the user allows, before any ad script loads.
- Keep it config-driven; do not hardcode IDs. If the region can't be detected client-side, default to
  the stricter (consent-required) path.
- Explicitly flag in the report that a fully compliant setup for EEA/UK needs a certified CMP and a
  lawyer's review — this workstream wires the mechanism, it does not make us legally compliant.
- Verify: with ads enabled in config, show that no ad network script loads until consent is granted
  (observe network/DOM), and that granting consent then loads it.

**Workstream 4 — Confirm the strict CSP works with ads, document the trade-off.** (run AFTER #3)
- With the nonce-based CSP in `server/src/middleware/security.js`, verify whether AdSense actually
  renders. If ad code needs inline scripts and breaks under the nonce, document exactly that and make
  `CSP_ALLOW_INLINE=true` the documented escape hatch (it already exists) — do not weaken the default.
- Update the relevant section of `IMPLEMENTATION_GUIDE.md` (Phase 9) with what you actually observed.
- Verify: describe the observed ad-load behavior under strict CSP vs. `CSP_ALLOW_INLINE=true`.

Do not auto-merge anything. Deliver each workstream as its own pull request with a terse note on what
shipped and how you verified it. Escalate anything under-specified instead of guessing.
