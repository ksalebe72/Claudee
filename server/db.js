import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH || resolve(root, 'data', 'taller.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, company TEXT, email TEXT, phone TEXT,
  tags TEXT DEFAULT '[]', source TEXT, address TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL, value REAL DEFAULT 0, stage TEXT DEFAULT 'nuevo',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  job_id INTEGER, type TEXT NOT NULL, direction TEXT DEFAULT 'interno',
  body TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  job_id INTEGER, title TEXT NOT NULL, due_date TEXT, assignee TEXT,
  done INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT, name TEXT NOT NULL, brand TEXT, category TEXT,
  base_cost REAL DEFAULT 0, colors TEXT DEFAULT '[]', sizes TEXT DEFAULT '[]',
  supplier TEXT, active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS decoration_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  setup_fee REAL DEFAULT 0, setup_per_color INTEGER DEFAULT 0,
  color_price REAL DEFAULT 0, tiers TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'quote',
  number TEXT, order_number TEXT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  title TEXT, status TEXT NOT NULL DEFAULT 'borrador',
  due_date TEXT, priority TEXT DEFAULT 'normal', assignee TEXT,
  notes TEXT, discount REAL DEFAULT 0, tax_rate REAL DEFAULT 0,
  subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0,
  token TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT, color TEXT, sizes TEXT DEFAULT '{}', decorations TEXT DEFAULT '[]',
  custom_price REAL, qty INTEGER DEFAULT 0, unit_price REAL DEFAULT 0, setup REAL DEFAULT 0, total REAL DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  version INTEGER DEFAULT 1, file_url TEXT, note TEXT,
  status TEXT DEFAULT 'pendiente', customer_comment TEXT,
  created_at TEXT DEFAULT (datetime('now')), decided_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  amount REAL NOT NULL, method TEXT, reference TEXT,
  paid_at TEXT DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, trigger TEXT NOT NULL, condition TEXT DEFAULT '{}',
  action TEXT NOT NULL, params TEXT DEFAULT '{}', active INTEGER DEFAULT 1,
  runs INTEGER DEFAULT 0, last_run TEXT
);
`);

// ---------- helpers ----------
const JSON_COLS = new Set(['tags', 'colors', 'sizes', 'decorations', 'tiers', 'condition', 'params']);

export function parseRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (JSON_COLS.has(k) && typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch { /* deja el texto */ }
    }
  }
  return out;
}

export const all = (sql, ...p) => db.prepare(sql).all(...p).map(parseRow);
export const get = (sql, ...p) => parseRow(db.prepare(sql).get(...p));
export const run = (sql, ...p) => db.prepare(sql).run(...p);

const enc = (k, v) => (JSON_COLS.has(k) && typeof v !== 'string' ? JSON.stringify(v ?? null) : v ?? null);

export function insert(table, data) {
  const keys = Object.keys(data);
  const r = run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map((k) => enc(k, data[k]))
  );
  return Number(r.lastInsertRowid);
}

export function update(table, id, data, allowed) {
  const keys = Object.keys(data).filter((k) => !allowed || allowed.includes(k));
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => enc(k, data[k])), id);
}

export function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function methodsMap() {
  return Object.fromEntries(all('SELECT * FROM decoration_methods').map((m) => [m.code, m]));
}

export function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
