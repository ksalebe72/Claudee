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

// ---------- migraciones ----------
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('proofs').includes('design')) db.exec('ALTER TABLE proofs ADD COLUMN design TEXT');
const addColumn = (table, col, def) => { if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };

// --- Costos, rentabilidad y comisiones (ColorPlus OS) ---
for (const [c, d] of Object.entries({
  pricing_version_id: 'INTEGER', shipping_charged: 'REAL DEFAULT 0', shipping_cost: 'REAL', extra_costs: "TEXT DEFAULT '[]'",
  tax_exempt: 'INTEGER DEFAULT 0', salesperson_id: 'INTEGER', commission_rule_id: 'INTEGER', client_status: 'TEXT',
  client_status_manual: 'INTEGER DEFAULT 0', invoice_date: 'TEXT', costs_confirmed_at: 'TEXT', costs_confirmed_by: 'TEXT',
  margin_approval: 'TEXT', fin: 'TEXT',
  idioma: 'TEXT', // idioma de los documentos de esta orden; vacío = el del cliente
})) addColumn('jobs', c, d);
for (const [c, d] of Object.entries({
  line_type: "TEXT DEFAULT 'prenda'", unit_cost: 'REAL', size_costs: "TEXT DEFAULT '{}'", price_mode: "TEXT DEFAULT 'auto'",
  manual_price: 'REAL', override: 'TEXT', line_discount: 'REAL DEFAULT 0', commissionable: 'INTEGER DEFAULT 1', cost_total: 'REAL', calc: 'TEXT',
  ajuste_pct: 'REAL DEFAULT 0',
})) addColumn('job_items', c, d);
for (const [c, d] of Object.entries({
  kind: "TEXT DEFAULT 'prenda'", commissionable: 'INTEGER DEFAULT 1', markup_mode: 'TEXT', markup_value: 'REAL',
  size_costs: "TEXT DEFAULT '{}'", price: 'REAL',
})) addColumn('products', c, d);
addColumn('contacts', 'tax_exempt', 'INTEGER DEFAULT 0');
addColumn('contacts', 'salesperson_id', 'INTEGER'); // vendedor dueño del cliente
addColumn('contacts', 'idioma', "TEXT DEFAULT 'es'"); // idioma de facturas y proofs del cliente (es/en)

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL, salesperson_id INTEGER, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pricing_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, config TEXT NOT NULL, note TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT (datetime('now')), user_id INTEGER, user_name TEXT,
  area TEXT, field TEXT, old_value TEXT, new_value TEXT, ref TEXT
);
CREATE TABLE IF NOT EXISTS salespeople (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS commission_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, salesperson_id INTEGER, name TEXT NOT NULL,
  base TEXT NOT NULL DEFAULT 'venta_neta', client_type TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS commission_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER NOT NULL REFERENCES commission_rules(id) ON DELETE CASCADE,
  rate REAL NOT NULL, effective_from TEXT NOT NULL, created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_actual_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE, category TEXT NOT NULL,
  supplier TEXT, invoice_ref TEXT, amount REAL NOT NULL, cost_date TEXT, note TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE, type TEXT NOT NULL,
  amount REAL NOT NULL, credit_date TEXT, note TEXT, created_by TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS liquidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT NOT NULL, salesperson_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'borrador',
  total REAL DEFAULT 0, reviewed_by TEXT, reviewed_at TEXT, approved_by TEXT, approved_at TEXT,
  paid_at TEXT, paid_reference TEXT, paid_by TEXT, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(period, salesperson_id)
);
CREATE TABLE IF NOT EXISTS commission_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, liquidation_id INTEGER REFERENCES liquidations(id) ON DELETE CASCADE,
  job_id INTEGER, salesperson_id INTEGER, period TEXT, type TEXT NOT NULL, amount REAL NOT NULL, snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);
addColumn('salespeople', 'default_rule_id', 'INTEGER'); // regla de comisión automática del vendedor

// Historial de compras traído de otros sistemas (DecoNetwork): se guarda aparte de las órdenes de producción,
// con los montos tal como vinieron. No genera comisiones ni cobranza; sirve para la ficha del cliente,
// «cliente existente», el tablero de ventas y la IA.
db.exec(`
CREATE TABLE IF NOT EXISTS historial_ordenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  origen TEXT NOT NULL DEFAULT 'DecoNetwork', numero TEXT NOT NULL, fecha TEXT, tienda TEXT, po TEXT, trabajo TEXT,
  ventas REAL, envio REAL, impuesto REAL, total REAL, unidades INTEGER, importado_por TEXT,
  created_at TEXT DEFAULT (datetime('now')), UNIQUE(origen, numero)
);
CREATE TABLE IF NOT EXISTS historial_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, orden_id INTEGER REFERENCES historial_ordenes(id) ON DELETE CASCADE,
  producto TEXT, codigo TEXT, color TEXT, tallas TEXT, cantidad REAL, precio_unitario REAL, descuento REAL,
  total REAL, impuesto REAL, decoracion TEXT, proveedor TEXT, costo_proveedor REAL
);
CREATE INDEX IF NOT EXISTS idx_historial_contacto ON historial_ordenes(contact_id);
`);
addColumn('contacts', 'deco_customer_id', 'TEXT'); // Customer ID de DecoNetwork (para no duplicar al importar)

// ---------- helpers ----------
const JSON_COLS = new Set(['tallas', 'tags', 'colors', 'sizes', 'decorations', 'tiers', 'condition', 'params', 'size_costs', 'extra_costs', 'override', 'margin_approval', 'fin', 'calc', 'config', 'snapshot']);

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
