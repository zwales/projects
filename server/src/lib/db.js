import Database from "better-sqlite3";
import { config } from "../config.js";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

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

export const Users = {
  create: db.prepare("INSERT INTO users (email, password_hash, verify_token, verify_expires) VALUES (?, ?, ?, ?)"),
  byEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  byId: db.prepare("SELECT * FROM users WHERE id = ?"),
  byVerifyToken: db.prepare("SELECT * FROM users WHERE verify_token = ?"),
  byResetToken: db.prepare("SELECT * FROM users WHERE reset_token = ?"),
  setPlan: db.prepare("UPDATE users SET plan = ? WHERE id = ?"),
  setCustomer: db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?"),
  setPlanByCustomer: db.prepare("UPDATE users SET plan = ? WHERE stripe_customer_id = ?"),
  markVerified: db.prepare("UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?"),
  setReset: db.prepare("UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?"),
  applyReset: db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?"),
  deleteById: db.prepare("DELETE FROM users WHERE id = ?"),
};

export const Runs = {
  create: db.prepare(`INSERT INTO runs (user_id, decision, kind, stakes, integrity, verdict, payload, input_tokens, output_tokens, cost_usd)
    VALUES (@user_id, @decision, @kind, @stakes, @integrity, @verdict, @payload, @input_tokens, @output_tokens, @cost_usd)`),
  countForUser: db.prepare("SELECT COUNT(*) AS n FROM runs WHERE user_id = ?"),
  listForUser: db.prepare("SELECT id, decision, kind, stakes, integrity, verdict, created_at FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"),
  allForUser: db.prepare("SELECT decision, kind, stakes, integrity, verdict, payload, created_at FROM runs WHERE user_id = ? ORDER BY created_at DESC"),
  byId: db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?"),
  deleteForUser: db.prepare("DELETE FROM runs WHERE user_id = ?"),
};

const _usageGet = db.prepare("SELECT * FROM usage_month WHERE user_id = ? AND ym = ?");
const _usageUpsert = db.prepare(`INSERT INTO usage_month (user_id, ym, input_tokens, output_tokens, cost_usd)
  VALUES (@user_id, @ym, @input_tokens, @output_tokens, @cost_usd)
  ON CONFLICT(user_id, ym) DO UPDATE SET
    input_tokens = input_tokens + excluded.input_tokens,
    output_tokens = output_tokens + excluded.output_tokens,
    cost_usd = cost_usd + excluded.cost_usd`);
const _usageDelete = db.prepare("DELETE FROM usage_month WHERE user_id = ?");
export const Usage = {
  ym: () => new Date().toISOString().slice(0, 7),
  get(userId) { return _usageGet.get(userId, Usage.ym()) || { input_tokens: 0, output_tokens: 0, cost_usd: 0 }; },
  add(userId, i, o, c) { _usageUpsert.run({ user_id: userId, ym: Usage.ym(), input_tokens: i, output_tokens: o, cost_usd: c }); },
  deleteForUser(userId) { _usageDelete.run(userId); },
};

export const Events = {
  seen: db.prepare("SELECT 1 FROM processed_events WHERE id = ?"),
  mark: db.prepare("INSERT OR IGNORE INTO processed_events (id) VALUES (?)"),
};

const _adminTotals = db.prepare("SELECT COUNT(*) AS users FROM users");
const _adminByPlan = db.prepare("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan");
const _adminRuns = db.prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost FROM runs");
const _adminMonthCost = db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens FROM usage_month WHERE ym = ?");
const _adminTopUsers = db.prepare(`SELECT u.email, u.plan, m.input_tokens+m.output_tokens AS tokens, m.cost_usd AS cost
  FROM usage_month m JOIN users u ON u.id = m.user_id WHERE m.ym = ? ORDER BY m.cost_usd DESC LIMIT 10`);
export const Admin = {
  stats() {
    const ym = Usage.ym();
    return {
      users: _adminTotals.get().users,
      byPlan: _adminByPlan.all(),
      runsAllTime: _adminRuns.get(),
      thisMonth: { ym, ..._adminMonthCost.get(ym) },
      topUsers: _adminTopUsers.all(ym),
    };
  },
};

// Deletes a user and all their data in one transaction (GDPR/CPRA erasure).
export const eraseUser = db.transaction((userId) => {
  Runs.deleteForUser.run(userId);
  Usage.deleteForUser(userId);
  Users.deleteById.run(userId);
});

export default db;
