// Data layer. Presents ONE async interface backed by either SQLite (default) or
// Postgres (when DATABASE_URL is set). Every exported query returns a Promise in
// BOTH backends so call sites are identical: just `await` them.
//
// The dotted access pattern (`Users.byEmail.get(email)`, `Runs.create.run({...})`)
// is preserved from the original better-sqlite3 shape to keep call-site diffs to a
// single `await`. `.run()` results expose `{ changes, lastInsertRowid }` in both
// backends (Postgres uses `RETURNING id`, cast to a Number to match SQLite).
import { config } from "../config.js";

const ym = () => new Date().toISOString().slice(0, 7);

// Only the selected driver is loaded (dynamic import), so the SQLite path never
// pulls in `pg` and the Postgres path never loads the native better-sqlite3 binding.
const backend = config.databaseUrl ? await makePostgres() : await makeSqlite();

export const { Users, Runs, Usage, Events, Admin, eraseUser, initSchema } = backend;
export default backend.db;

// ---------------------------------------------------------------------------
// SQLite backend (default). Wraps synchronous better-sqlite3 results in
// Promise.resolve so it presents the same async interface as Postgres.
// ---------------------------------------------------------------------------
async function makeSqlite() {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  // better-sqlite3 validates table existence at prepare() time, so the schema
  // must exist before we prepare the statements below. createSchema is idempotent
  // (CREATE TABLE IF NOT EXISTS), so the awaited initSchema() in index.js can call
  // it again harmlessly to satisfy the shared awaited-init contract.
  const createSchema = () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        email_verified INTEGER NOT NULL DEFAULT 0,
        verify_token TEXT, verify_expires TEXT,
        reset_token TEXT, reset_expires TEXT,
        stripe_customer_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        decision TEXT NOT NULL, kind TEXT, stakes TEXT,
        integrity INTEGER, verdict TEXT, payload TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS usage_month (
        user_id INTEGER NOT NULL, ym TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, ym)
      );
      CREATE TABLE IF NOT EXISTS processed_events (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    for (const stmt of [
      "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN verify_token TEXT",
      "ALTER TABLE users ADD COLUMN verify_expires TEXT",
      "ALTER TABLE users ADD COLUMN reset_token TEXT",
      "ALTER TABLE users ADD COLUMN reset_expires TEXT",
      "ALTER TABLE runs ADD COLUMN input_tokens INTEGER DEFAULT 0",
      "ALTER TABLE runs ADD COLUMN output_tokens INTEGER DEFAULT 0",
      "ALTER TABLE runs ADD COLUMN cost_usd REAL DEFAULT 0",
    ]) { try { db.exec(stmt); } catch { /* column exists */ } }
  };
  createSchema();

  // Wrap a prepared statement so get/run/all each return a Promise.
  const S = (sql) => {
    const s = db.prepare(sql);
    return {
      get: (...a) => Promise.resolve(s.get(...a)),
      run: (...a) => Promise.resolve(s.run(...a)),
      all: (...a) => Promise.resolve(s.all(...a)),
    };
  };

  const Users = {
    create: S("INSERT INTO users (email, password_hash, verify_token, verify_expires) VALUES (?, ?, ?, ?)"),
    byEmail: S("SELECT * FROM users WHERE email = ?"),
    byId: S("SELECT * FROM users WHERE id = ?"),
    byVerifyToken: S("SELECT * FROM users WHERE verify_token = ?"),
    byResetToken: S("SELECT * FROM users WHERE reset_token = ?"),
    setPlan: S("UPDATE users SET plan = ? WHERE id = ?"),
    setCustomer: S("UPDATE users SET stripe_customer_id = ? WHERE id = ?"),
    setPlanByCustomer: S("UPDATE users SET plan = ? WHERE stripe_customer_id = ?"),
    markVerified: S("UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?"),
    setReset: S("UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?"),
    applyReset: S("UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?"),
    deleteById: S("DELETE FROM users WHERE id = ?"),
  };

  const Runs = {
    create: S(`INSERT INTO runs (user_id, decision, kind, stakes, integrity, verdict, payload, input_tokens, output_tokens, cost_usd)
      VALUES (@user_id, @decision, @kind, @stakes, @integrity, @verdict, @payload, @input_tokens, @output_tokens, @cost_usd)`),
    countForUser: S("SELECT COUNT(*) AS n FROM runs WHERE user_id = ?"),
    listForUser: S("SELECT id, decision, kind, stakes, integrity, verdict, created_at FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"),
    allForUser: S("SELECT decision, kind, stakes, integrity, verdict, payload, created_at FROM runs WHERE user_id = ? ORDER BY created_at DESC"),
    byId: S("SELECT * FROM runs WHERE id = ? AND user_id = ?"),
    deleteForUser: S("DELETE FROM runs WHERE user_id = ?"),
  };

  const _usageGet = db.prepare("SELECT * FROM usage_month WHERE user_id = ? AND ym = ?");
  const _usageUpsert = db.prepare(`INSERT INTO usage_month (user_id, ym, input_tokens, output_tokens, cost_usd)
    VALUES (@user_id, @ym, @input_tokens, @output_tokens, @cost_usd)
    ON CONFLICT(user_id, ym) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cost_usd = cost_usd + excluded.cost_usd`);
  const _usageDelete = db.prepare("DELETE FROM usage_month WHERE user_id = ?");
  const Usage = {
    ym,
    get: (userId) => Promise.resolve(_usageGet.get(userId, ym()) || { input_tokens: 0, output_tokens: 0, cost_usd: 0 }),
    add: (userId, i, o, c) => Promise.resolve(_usageUpsert.run({ user_id: userId, ym: ym(), input_tokens: i, output_tokens: o, cost_usd: c })),
    deleteForUser: (userId) => Promise.resolve(_usageDelete.run(userId)),
  };

  const Events = {
    seen: S("SELECT 1 FROM processed_events WHERE id = ?"),
    mark: S("INSERT OR IGNORE INTO processed_events (id) VALUES (?)"),
  };

  const _adminTotals = db.prepare("SELECT COUNT(*) AS users FROM users");
  const _adminByPlan = db.prepare("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan");
  const _adminRuns = db.prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost FROM runs");
  const _adminMonthCost = db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens FROM usage_month WHERE ym = ?");
  const _adminTopUsers = db.prepare(`SELECT u.email, u.plan, m.input_tokens+m.output_tokens AS tokens, m.cost_usd AS cost
    FROM usage_month m JOIN users u ON u.id = m.user_id WHERE m.ym = ? ORDER BY m.cost_usd DESC LIMIT 10`);
  const Admin = {
    stats: () => Promise.resolve({
      users: _adminTotals.get().users,
      byPlan: _adminByPlan.all(),
      runsAllTime: _adminRuns.get(),
      thisMonth: { ym: ym(), ..._adminMonthCost.get(ym()) },
      topUsers: _adminTopUsers.all(ym()),
    }),
  };

  // Deletes a user and all their data in one transaction (GDPR/CPRA erasure).
  const _erase = db.transaction((userId) => {
    db.prepare("DELETE FROM runs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM usage_month WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  const eraseUser = (userId) => Promise.resolve(_erase(userId));

  const initSchema = async () => createSchema();

  return { Users, Runs, Usage, Events, Admin, eraseUser, initSchema, db };
}

// ---------------------------------------------------------------------------
// Postgres backend (DATABASE_URL set). Real network I/O via `pg`.
// Type parsers keep the surface identical to SQLite: bigints come back as JS
// numbers (matching SQLite ids/counts), and timestamps come back as orderable
// strings (call sites treat created_at as a string, never a Date).
// ---------------------------------------------------------------------------
async function makePostgres() {
  const pg = (await import("pg")).default;
  const { Pool, types } = pg;
  types.setTypeParser(20, (v) => (v == null ? v : Number(v)));        // int8 / bigint -> Number
  types.setTypeParser(1700, (v) => (v == null ? v : Number(v)));      // numeric -> Number
  types.setTypeParser(1114, (v) => v);                               // timestamp -> raw string
  types.setTypeParser(1184, (v) => v);                               // timestamptz -> raw string

  // NOT VERIFIED: no explicit `ssl` option here. Most hosted Postgres (Render,
  // Supabase, Railway, etc.) requires SSL, and whether `pg` negotiates it
  // correctly depends on `sslmode` in DATABASE_URL and the provider's cert
  // chain — this was only tested against a local, trust-auth Postgres in a
  // sandbox, which exercises none of that. Confirm a real signup works
  // against the actual deployed DATABASE_URL before relying on this in
  // production; if it fails on cert validation, add
  // `ssl: { rejectUnauthorized: false }` (or the provider's documented value).
  const pool = new Pool({ connectionString: config.databaseUrl });

  const rows = async (text, params) => (await pool.query(text, params)).rows;
  const row = async (text, params) => (await pool.query(text, params)).rows[0];
  const exec = async (text, params) => {
    const r = await pool.query(text, params);
    return { changes: r.rowCount, lastInsertRowid: r.rows[0] ? Number(r.rows[0].id) : undefined };
  };

  const Users = {
    create: { run: (email, password_hash, verify_token, verify_expires) =>
      exec("INSERT INTO users (email, password_hash, verify_token, verify_expires) VALUES ($1,$2,$3,$4) RETURNING id",
        [email, password_hash, verify_token, verify_expires]) },
    byEmail: { get: (email) => row("SELECT * FROM users WHERE email = $1", [email]) },
    byId: { get: (id) => row("SELECT * FROM users WHERE id = $1", [id]) },
    byVerifyToken: { get: (token) => row("SELECT * FROM users WHERE verify_token = $1", [token]) },
    byResetToken: { get: (token) => row("SELECT * FROM users WHERE reset_token = $1", [token]) },
    setPlan: { run: (plan, id) => exec("UPDATE users SET plan = $1 WHERE id = $2", [plan, id]) },
    setCustomer: { run: (customerId, id) => exec("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, id]) },
    setPlanByCustomer: { run: (plan, customerId) => exec("UPDATE users SET plan = $1 WHERE stripe_customer_id = $2", [plan, customerId]) },
    markVerified: { run: (id) => exec("UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = $1", [id]) },
    setReset: { run: (token, expires, id) => exec("UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3", [token, expires, id]) },
    applyReset: { run: (hash, id) => exec("UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2", [hash, id]) },
    deleteById: { run: (id) => exec("DELETE FROM users WHERE id = $1", [id]) },
  };

  const Runs = {
    create: { run: (p) => exec(
      `INSERT INTO runs (user_id, decision, kind, stakes, integrity, verdict, payload, input_tokens, output_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [p.user_id, p.decision, p.kind, p.stakes, p.integrity, p.verdict, p.payload, p.input_tokens, p.output_tokens, p.cost_usd]) },
    countForUser: { get: (userId) => row("SELECT COUNT(*) AS n FROM runs WHERE user_id = $1", [userId]) },
    listForUser: { all: (userId) => rows("SELECT id, decision, kind, stakes, integrity, verdict, created_at FROM runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [userId]) },
    allForUser: { all: (userId) => rows("SELECT decision, kind, stakes, integrity, verdict, payload, created_at FROM runs WHERE user_id = $1 ORDER BY created_at DESC", [userId]) },
    byId: { get: (id, userId) => row("SELECT * FROM runs WHERE id = $1 AND user_id = $2", [id, userId]) },
    deleteForUser: { run: (userId) => exec("DELETE FROM runs WHERE user_id = $1", [userId]) },
  };

  const Usage = {
    ym,
    get: async (userId) =>
      (await row("SELECT * FROM usage_month WHERE user_id = $1 AND ym = $2", [userId, ym()])) ||
      { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
    add: (userId, i, o, c) => exec(
      `INSERT INTO usage_month (user_id, ym, input_tokens, output_tokens, cost_usd) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, ym) DO UPDATE SET
         input_tokens = usage_month.input_tokens + excluded.input_tokens,
         output_tokens = usage_month.output_tokens + excluded.output_tokens,
         cost_usd = usage_month.cost_usd + excluded.cost_usd`,
      [userId, ym(), i, o, c]),
    deleteForUser: (userId) => exec("DELETE FROM usage_month WHERE user_id = $1", [userId]),
  };

  const Events = {
    seen: { get: (id) => row("SELECT 1 AS seen FROM processed_events WHERE id = $1", [id]) },
    mark: { run: (id) => exec("INSERT INTO processed_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]) },
  };

  const Admin = {
    stats: async () => {
      const m = ym();
      return {
        users: (await row("SELECT COUNT(*) AS users FROM users")).users,
        byPlan: await rows("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan"),
        runsAllTime: await row("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost FROM runs"),
        thisMonth: { ym: m, ...(await row("SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens FROM usage_month WHERE ym = $1", [m])) },
        topUsers: await rows(`SELECT u.email, u.plan, m.input_tokens+m.output_tokens AS tokens, m.cost_usd AS cost
          FROM usage_month m JOIN users u ON u.id = m.user_id WHERE m.ym = $1 ORDER BY m.cost_usd DESC LIMIT 10`, [m]),
      };
    },
  };

  // Atomic erasure across runs/usage_month/users on a dedicated client.
  const eraseUser = async (userId) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM runs WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM usage_month WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM users WHERE id = $1", [userId]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };

  const initSchema = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        email_verified INTEGER NOT NULL DEFAULT 0,
        verify_token TEXT, verify_expires TEXT,
        reset_token TEXT, reset_expires TEXT,
        stripe_customer_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS runs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        decision TEXT NOT NULL, kind TEXT, stakes TEXT,
        integrity SMALLINT, verdict TEXT, payload TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cost_usd DOUBLE PRECISION DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS usage_month (
        user_id BIGINT NOT NULL, ym TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, ym)
      );
      CREATE TABLE IF NOT EXISTS processed_events (
        id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  };

  return { Users, Runs, Usage, Events, Admin, eraseUser, initSchema, db: pool };
}
