// Automated API tests for Crucible.
// New file only — no app source is modified. Node built-in test runner + assert.
//
// IMPORTANT ORDER-OF-OPERATIONS:
//   1. Set every env var config.js reads BEFORE anything imports config.js.
//   2. Mock globalThis.fetch BEFORE importing index.js, because index.js boots
//      the server synchronously on import and crucible.js calls the *global*
//      fetch at request time (no captured reference). The real Anthropic API is
//      never contacted.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

process.env.PORT = "8099";
process.env.DB_PATH = path.join(os.tmpdir(), `crucible-test-${Date.now()}-${process.pid}.db`);
process.env.ANTHROPIC_API_KEY = "test-key"; // dummy: fetch is mocked, key only needs to be truthy
process.env.JWT_SECRET = "test-secret";
process.env.FREE_RUN_LIMIT = "2";
process.env.PRO_MONTHLY_TOKEN_CAP = "100"; // small so one mocked run (120 tokens) exceeds it
process.env.REQUIRE_EMAIL_VERIFICATION = "false";
process.env.NODE_ENV = "test";

// --- Fetch mock -------------------------------------------------------------
// Each mocked adversary/judge call returns 10 input + 10 output tokens.
// runCrucible fires 5 adversaries + 1 judge = 6 calls => 60 in + 60 out = 120
// tokens per successful /api/run. A fresh Response per call so concurrent reads
// never collide on a consumed body.
const realFetch = globalThis.fetch;
const anthropicBody = () => JSON.stringify({
  content: [{
    type: "text",
    text: JSON.stringify({
      severity: 50, headline: "test strike", strike: "test", blindspot: "test", test: "test",
      integrity: 50, verdict: "SOUND", verdict_line: "test", deadliest: [], fixes: [], kill_criteria: [],
    }),
  }],
  usage: { input_tokens: 10, output_tokens: 10 },
});
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.anthropic.com")) {
    return new Response(anthropicBody(), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, opts);
};

// Boot the real server (side effect of import). It listens on PORT 8099.
await import("../src/index.js");
// Import the data layer directly — same module instance / same DB connection the
// server uses (ESM singleton), so row checks below observe the server's writes.
const dbmod = await import("../src/lib/db.js");
const db = dbmod.default;
const { Users, Runs, eraseUser } = dbmod;

const BASE = "http://localhost:8099";

// --- Minimal cookie-jar HTTP client ----------------------------------------
function makeClient() {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const store = (res) => {
    const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      if (i === -1) continue;
      jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  };
  async function req(method, p, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (Object.keys(jar).length) headers.cookie = cookieHeader();
    if (body !== undefined) headers["content-type"] = "application/json";
    // realFetch: bypass our anthropic mock entirely for localhost calls.
    const res = await realFetch(BASE + p, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    store(res);
    return res;
  }
  return {
    jar,
    get: (p, h) => req("GET", p, undefined, h),
    // POST with the double-submit CSRF header derived from the cru_csrf cookie.
    post: (p, b, h = {}) => req("POST", p, b, { ...h, ...(jar.cru_csrf ? { "x-csrf-token": jar.cru_csrf } : {}) }),
    // POST that deliberately omits the CSRF header.
    postNoCsrf: (p, b, h = {}) => req("POST", p, b, h),
    del: (p, b, h = {}) => req("DELETE", p, b, { ...h, ...(jar.cru_csrf ? { "x-csrf-token": jar.cru_csrf } : {}) }),
  };
}

let seq = 0;
const uniqEmail = () => `test${Date.now()}-${seq++}@example.com`;

// Signs up a fresh user and returns { client, email, user, id }.
async function signup() {
  const client = makeClient();
  await client.get("/api/config"); // receive cru_csrf cookie
  const email = uniqEmail();
  const res = await client.post("/api/auth/signup", { email, password: "password123" });
  assert.equal(res.status, 200, `signup expected 200, got ${res.status}`);
  const body = await res.json();
  return { client, email, user: body.user, id: body.user.id };
}

async function doRun(client) {
  return client.post("/api/run", { decision: "Ship the feature on Friday", kind: "Decision", stakes: "Costly to undo" });
}

// --- Readiness --------------------------------------------------------------
before(async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await realFetch(BASE + "/api/config");
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become ready on " + BASE);
});

// --- Tests ------------------------------------------------------------------

test("1. signup then login returns a session and publicUser", async () => {
  const { client, email } = await signup();
  // signup set a session cookie
  assert.ok(client.jar.cru_session, "expected cru_session cookie after signup");

  // fresh client for login to prove login independently issues a session
  const c2 = makeClient();
  await c2.get("/api/config");
  const res = await c2.post("/api/auth/login", { email, password: "password123" });
  assert.equal(res.status, 200, `login expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(client.jar.cru_session, "session cookie missing"); // from signup
  assert.ok(c2.jar.cru_session, "login did not set cru_session cookie");

  const u = body.user;
  assert.ok(u, "login response missing user");
  // publicUser shape: {id, email, plan, emailVerified, runsUsed, runsLeft}
  for (const k of ["id", "email", "plan", "emailVerified", "runsUsed", "runsLeft"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(u, k), `publicUser missing key: ${k}`);
  }
  assert.equal(u.email, email);
  assert.equal(u.plan, "free");
  assert.equal(u.emailVerified, false);
  assert.equal(u.runsUsed, 0);
  assert.equal(u.runsLeft, 2);
});

test("2. CSRF rejects a POST with no x-csrf-token header (403)", async () => {
  const client = makeClient();
  await client.get("/api/config"); // now holds a cru_csrf cookie
  assert.ok(client.jar.cru_csrf, "expected cru_csrf cookie from GET");
  const res = await client.postNoCsrf("/api/auth/signup", { email: uniqEmail(), password: "password123" });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.error, "Invalid session token. Refresh and try again.");
});

test("3. free-run gate returns 402 after FREE_RUN_LIMIT runs", async () => {
  const { client } = await signup(); // FREE_RUN_LIMIT = 2
  for (let i = 0; i < 2; i++) {
    const r = await doRun(client);
    assert.equal(r.status, 200, `run ${i + 1} expected 200, got ${r.status} (${await r.text().catch(() => "")})`);
  }
  const gated = await doRun(client);
  assert.equal(gated.status, 402, `3rd run expected 402, got ${gated.status}`);
  const body = await gated.json();
  assert.equal(body.upgrade, true);
});

test("4. monthly token cap returns 429 when exceeded", async () => {
  const { client, id } = await signup();
  // Flip to a paid plan via the existing exported db API (not app-logic change).
  Users.setPlan.run("pro", id);

  // First run succeeds and accumulates 120 tokens (> cap of 100).
  const first = await doRun(client);
  assert.equal(first.status, 200, `first pro run expected 200, got ${first.status} (${await first.text().catch(() => "")})`);

  // Second run is blocked by the monthly token cap.
  const second = await doRun(client);
  assert.equal(second.status, 429, `second pro run expected 429, got ${second.status}`);
});

test("5. eraseUser removes the user and their runs and usage", async () => {
  const { client, id } = await signup();
  const run = await doRun(client);
  assert.equal(run.status, 200, `run expected 200, got ${run.status}`);

  // Pre-conditions: rows exist for this user.
  assert.ok(Users.byId.get(id), "user row should exist before erase");
  assert.equal(Runs.countForUser.get(id).n, 1, "expected 1 run row before erase");
  const usageBefore = db.prepare("SELECT * FROM usage_month WHERE user_id = ?").get(id);
  assert.ok(usageBefore, "expected a usage_month row before erase");

  eraseUser(id);

  assert.equal(Users.byId.get(id), undefined, "user row should be gone after erase");
  assert.equal(Runs.countForUser.get(id).n, 0, "run rows should be gone after erase");
  const usageAfter = db.prepare("SELECT * FROM usage_month WHERE user_id = ?").get(id);
  assert.equal(usageAfter, undefined, "usage_month rows should be gone after erase");
});
