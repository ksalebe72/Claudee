import express from 'express';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, insert, update, getSetting, setSetting, transaction } from './db.js';
import { fire, registerHandler, TRIGGERS, ACTIONS } from './automations.js';
import { PROCESOS, precioPrenda } from '../shared/pricing.js';
import { computeJob, productSnapshot, computeClientStatus, assertMarginApproved, today as hoy } from './finance.js';
import { currentPricing, pricingVersion, audit, listRules } from './config.js';
import { ROLES, requireRole } from './auth.js';
import { getBrand, setBrandColors, saveLogo, removeLogo } from './brand.js';
import { iaConfigurada } from './ia.js';
import { sendMessage } from './messaging.js';
import { sanmar, sanmarConfigured, cacheImage, getStyleAreas, setStyleAreas, clearSanmarCache } from './sanmar.js';

// Carpeta de archivos (pruebas de arte, logos, fotos de SanMar). En producción va en el disco permanente.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || resolve(dirname(fileURLToPath(import.meta.url)), 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const OPP_STAGES = ['nuevo', 'contactado', 'cotizado', 'negociacion', 'ganado', 'perdido'];
export const QUOTE_STATUSES = ['borrador', 'enviada', 'aprobada', 'rechazada'];
export const ORDER_STATUSES = ['arte', 'aprobacion', 'compras', 'produccion', 'calidad', 'listo', 'entregado'];

const api = express.Router();
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const awrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    console.error(e.codigo ? `[SanMar ${e.codigo}] ${e.message}` : e.message);
    res.status(e.status || 500).json({ error: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
  }
};
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const token = () => randomBytes(12).toString('hex');
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---------- helpers de dominio ----------
function contactById(id) { return id ? get('SELECT * FROM contacts WHERE id = ?', id) : null; }

function nextNumber(prefix, key) {
  const n = getSetting(key, 1000) + 1;
  setSetting(key, n);
  return `${prefix}-${n}`;
}

function loadJob(id) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) throw fail(404, 'No encontrado');
  job.items = all(
    'SELECT i.*, p.name AS product_name, p.sku AS product_sku, p.category AS product_category, p.brand AS product_brand, p.supplier AS product_supplier FROM job_items i LEFT JOIN products p ON p.id = i.product_id WHERE job_id = ? ORDER BY position, id',
    id
  );
  job.proofs = all('SELECT id, job_id, version, file_url, note, status, customer_comment, created_at, decided_at, design IS NOT NULL AS has_design FROM proofs WHERE job_id = ? ORDER BY version DESC', id);
  job.payments = all('SELECT * FROM payments WHERE job_id = ? ORDER BY paid_at DESC, id DESC', id);
  job.paid = job.payments.reduce((a, p) => a + p.amount, 0);
  job.balance = Math.round((job.total - job.paid) * 100) / 100;
  job.contact = contactById(job.contact_id);
  job.opportunity = job.opportunity_id ? get('SELECT * FROM opportunities WHERE id = ?', job.opportunity_id) : null;
  const { fin } = computeJob(job, { persist: false });
  job.finanzas = fin;
  job.pricing = pricingVersion(job.pricing_version_id);
  job.costosReales = all('SELECT * FROM job_actual_costs WHERE job_id = ? ORDER BY id', id);
  job.creditos = all('SELECT * FROM job_credits WHERE job_id = ? ORDER BY id', id);
  return job;
}

const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Guarda las líneas. Al agregar un producto se congela su costo y su excepción de markup en la línea. */
function saveItems(jobId, items) {
  run('DELETE FROM job_items WHERE job_id = ?', jobId);
  items.forEach((it, idx) => {
    const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', it.product_id) : null;
    const snap = it.unit_cost === undefined && product ? productSnapshot(product) : {};
    const lineType = product ? (product.kind === 'servicio' ? 'servicio' : 'prenda') : it.line_type || 'prenda';
    insert('job_items', {
      job_id: jobId, product_id: it.product_id || null, description: it.description || product?.name || '',
      color: it.color || '', sizes: it.sizes || {}, decorations: lineType === 'prenda' ? it.decorations || [] : [],
      line_type: lineType,
      unit_cost: it.unit_cost !== undefined ? numOrNull(it.unit_cost) : snap.unit_cost ?? null,
      size_costs: it.size_costs ?? snap.size_costs ?? {},
      price_mode: it.price_mode === 'manual' ? 'manual' : 'auto',
      manual_price: numOrNull(it.manual_price),
      override: it.override !== undefined ? it.override : snap.override ?? null,
      unit_price: it.unit_price !== undefined ? numOrNull(it.unit_price) : snap.unit_price ?? null,
      line_discount: numOrNull(it.line_discount) || 0,
      // «Comisionable» es parte de la matriz: lo define el producto, no la línea. Diseño/Digitalizado nunca comisiona.
      commissionable: lineType === 'diseno' ? 0 : product ? (product.commissionable === 0 ? 0 : 1) : it.commissionable === false || it.commissionable === 0 ? 0 : 1,
      qty: Number(it.qty) || 0, position: idx,
    });
  });
  computeJob(jobId);
}

function logSystem(job, body) {
  insert('activities', { contact_id: job.contact_id, job_id: job.id, type: 'sistema', body });
}

function moveOpportunity(id, stage) {
  const opp = get('SELECT * FROM opportunities WHERE id = ?', id);
  if (!opp || opp.stage === stage) return;
  if (!OPP_STAGES.includes(stage)) throw fail(400, 'Etapa inválida');
  run("UPDATE opportunities SET stage = ?, updated_at = datetime('now') WHERE id = ?", stage, id);
  fire('opportunity.stage_changed', { opportunity: { ...opp, stage }, contact: contactById(opp.contact_id), from: opp.stage, to: stage });
}

function setOrderStatus(id, status) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job || job.kind !== 'order' || job.status === status) return;
  if (!ORDER_STATUSES.includes(status)) throw fail(400, 'Estado inválido');
  run("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
  logSystem(job, `Orden ${job.order_number}: ${job.status} → ${status}`);
  fire('order.status_changed', { job: { ...job, status }, contact: contactById(job.contact_id), from: job.status, to: status });
}

function convertToOrder(id) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) throw fail(404, 'No encontrado');
  if (job.kind === 'order') return job;
  assertMarginApproved(id);
  const orderNumber = nextNumber('OT', 'seq_order');
  const clientStatus = job.client_status_manual ? job.client_status : computeClientStatus(job.contact_id, job.id);
  run(
    "UPDATE jobs SET kind = 'order', status = 'arte', order_number = ?, invoice_date = ?, client_status = ?, updated_at = datetime('now') WHERE id = ?",
    orderNumber, hoy(), clientStatus, id
  );
  computeJob(id);
  const updated = get('SELECT * FROM jobs WHERE id = ?', id);
  logSystem(updated, `Cotización ${job.number} convertida en orden ${orderNumber}`);
  fire('order.created', { job: updated, contact: contactById(job.contact_id) });
  return updated;
}

function decideProof(proofId, status, comment) {
  const proof = get('SELECT * FROM proofs WHERE id = ?', proofId);
  if (!proof) throw fail(404, 'Prueba no encontrada');
  if (!['aprobada', 'rechazada'].includes(status)) throw fail(400, 'Decisión inválida');
  run("UPDATE proofs SET status = ?, customer_comment = ?, decided_at = datetime('now') WHERE id = ?", status, comment || null, proofId);
  const job = get('SELECT * FROM jobs WHERE id = ?', proof.job_id);
  logSystem(job, `Prueba v${proof.version} ${status}${comment ? `: "${comment}"` : ''}`);
  fire(status === 'aprobada' ? 'proof.approved' : 'proof.rejected', { job, proof: { ...proof, status, customer_comment: comment }, contact: contactById(job.contact_id) });
}

function approveQuote(id, approved, comment) {
  const job = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job || job.kind !== 'quote') throw fail(400, 'Solo se pueden aprobar cotizaciones');
  const status = approved ? 'aprobada' : 'rechazada';
  run("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
  logSystem(job, `Cotización ${job.number} ${status} por el cliente${comment ? `: "${comment}"` : ''}`);
  fire(approved ? 'quote.approved' : 'quote.rejected', { job: { ...job, status }, contact: contactById(job.contact_id) });
}

registerHandler('setOrderStatus', setOrderStatus);
registerHandler('convertToOrder', convertToOrder);
registerHandler('moveOpportunity', moveOpportunity);

// ---------- meta / ajustes ----------
api.get('/meta', wrap((req) => ({
  usuario: req.user,
  oppStages: OPP_STAGES, quoteStatuses: QUOTE_STATUSES, orderStatuses: ORDER_STATUSES,
  triggers: TRIGGERS, actions: ACTIONS,
  settings: {
    business_name: getSetting('business_name', 'Mi Taller'),
    deposit_pct: getSetting('deposit_pct', 0.5),
  },
  brand: getBrand(),
  procesos: PROCESOS,
  roles: ROLES,
  pricingVersion: currentPricing().id,
  integrations: { sanmar: sanmarConfigured(), ia: iaConfigurada() },
})));

api.put('/settings', wrap((req) => {
  requireRole(req, 'duena');
  for (const k of ['business_name', 'deposit_pct']) if (k in req.body) { audit(req.user, 'ajustes', k, getSetting(k), req.body[k]); setSetting(k, req.body[k]); }
  if ('brand_primary' in req.body || 'brand_sidebar' in req.body) {
    const antes = getBrand();
    setBrandColors({ primary: req.body.brand_primary, sidebar: req.body.brand_sidebar });
    audit(req.user, 'ajustes', 'colores de marca', { primary: antes.primary, sidebar: antes.sidebar }, { primary: getBrand().primary, sidebar: getBrand().sidebar });
  }
  return { ok: true, brand: getBrand() };
}));

// Logo de la empresa (solo la dueña)
api.post('/settings/logo', express.json({ limit: '5mb' }), wrap((req) => {
  requireRole(req, 'duena');
  const tipo = req.body.tipo === 'icon' ? 'icon' : 'logo';
  const url = saveLogo(req.body.file, UPLOAD_DIR, tipo);
  audit(req.user, 'ajustes', tipo === 'icon' ? 'ícono' : 'logo', null, url);
  return getBrand();
}));
api.delete('/settings/logo', wrap((req) => {
  requireRole(req, 'duena');
  const tipo = req.query.tipo === 'icon' ? 'icon' : 'logo';
  removeLogo(UPLOAD_DIR, tipo);
  audit(req.user, 'ajustes', tipo === 'icon' ? 'ícono' : 'logo', 'personalizado', 'Color Plus por defecto');
  return getBrand();
}));

// ---------- dashboard ----------
api.get('/dashboard', wrap(() => {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const pipeline = all("SELECT stage, COUNT(*) AS count, COALESCE(SUM(value),0) AS value FROM opportunities GROUP BY stage");
  const orders = all("SELECT status, COUNT(*) AS count FROM jobs WHERE kind = 'order' GROUP BY status");
  const openQuotes = get("SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS value FROM jobs WHERE kind='quote' AND status IN ('borrador','enviada')");
  const revenue = get("SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE substr(paid_at,1,7) = ?", month).v;
  const booked = get("SELECT COALESCE(SUM(total),0) AS v FROM jobs WHERE kind='order' AND substr(created_at,1,7) = ?", month).v;
  const ar = get(`SELECT COALESCE(SUM(j.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.job_id = j.id),0)),0) AS v
                  FROM jobs j WHERE j.kind = 'order'`).v;
  const overdue = all(`SELECT j.id, j.order_number, j.title, j.due_date, j.status, c.name AS contact_name FROM jobs j
                       LEFT JOIN contacts c ON c.id = j.contact_id
                       WHERE j.kind='order' AND j.status != 'entregado' AND j.due_date < ? ORDER BY j.due_date`, today);
  const dueSoon = all(`SELECT j.id, j.order_number, j.title, j.due_date, j.status, c.name AS contact_name FROM jobs j
                       LEFT JOIN contacts c ON c.id = j.contact_id
                       WHERE j.kind='order' AND j.status != 'entregado' AND j.due_date >= ? ORDER BY j.due_date LIMIT 8`, today);
  const tasks = all(`SELECT t.*, c.name AS contact_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
                     WHERE done = 0 AND (due_date IS NULL OR due_date <= ?) ORDER BY due_date LIMIT 10`, today);
  const pendingProofs = get("SELECT COUNT(*) AS c FROM proofs WHERE status = 'pendiente'").c;
  const activity = all(`SELECT a.*, c.name AS contact_name FROM activities a LEFT JOIN contacts c ON c.id = a.contact_id
                        ORDER BY a.id DESC LIMIT 12`);
  return { pipeline, orders, openQuotes, revenue, booked, ar, overdue, dueSoon, tasks, pendingProofs, activity };
}));

// ---------- contactos ----------
api.get('/contacts', wrap((req) => {
  const q = `%${req.query.q || ''}%`;
  return all(`SELECT c.*,
      (SELECT COUNT(*) FROM jobs j WHERE j.contact_id = c.id AND j.kind='order') AS orders_count,
      (SELECT COALESCE(SUM(total),0) FROM jobs j WHERE j.contact_id = c.id AND j.kind='order') AS lifetime_value
    FROM contacts c WHERE c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.tags LIKE ?
    ORDER BY c.id DESC`, q, q, q, q, q);
}));

api.get('/contacts/:id', wrap((req) => {
  const c = contactById(req.params.id);
  if (!c) throw fail(404, 'Contacto no encontrado');
  c.opportunities = all('SELECT * FROM opportunities WHERE contact_id = ? ORDER BY id DESC', c.id);
  c.jobs = all('SELECT * FROM jobs WHERE contact_id = ? ORDER BY id DESC', c.id);
  c.tasks = all('SELECT * FROM tasks WHERE contact_id = ? ORDER BY done, due_date', c.id);
  c.activities = all('SELECT * FROM activities WHERE contact_id = ? ORDER BY id DESC', c.id);
  return c;
}));

const CONTACT_FIELDS = ['name', 'company', 'email', 'phone', 'tags', 'source', 'address', 'notes', 'tax_exempt'];
api.post('/contacts', wrap((req) => {
  if (!req.body.name) throw fail(400, 'El nombre es obligatorio');
  const data = Object.fromEntries(CONTACT_FIELDS.filter((k) => k in req.body).map((k) => [k, req.body[k]]));
  const id = insert('contacts', data);
  const contact = contactById(id);
  if (req.body.opportunity) {
    insert('opportunities', { contact_id: id, title: req.body.opportunity.title || `Oportunidad ${contact.name}`, value: Number(req.body.opportunity.value) || 0 });
  }
  fire('contact.created', { contact });
  return contact;
}));

api.put('/contacts/:id', wrap((req) => { update('contacts', req.params.id, req.body, CONTACT_FIELDS); return contactById(req.params.id); }));
api.delete('/contacts/:id', wrap((req) => { run('DELETE FROM contacts WHERE id = ?', req.params.id); return { ok: true }; }));

api.post('/contacts/:id/activities', wrap((req) => {
  const c = contactById(req.params.id);
  if (!c) throw fail(404, 'Contacto no encontrado');
  const { type = 'nota', body, direction = 'interno' } = req.body;
  if (!body) throw fail(400, 'Escribe un mensaje');
  const status = (type === 'sms' || type === 'email') && direction === 'saliente' ? sendMessage(type, c, body) : null;
  const id = insert('activities', { contact_id: c.id, type, body, direction, status });
  return get('SELECT * FROM activities WHERE id = ?', id);
}));

// ---------- oportunidades (pipeline) ----------
api.get('/opportunities', wrap(() => all(`SELECT o.*, c.name AS contact_name, c.company AS contact_company
  FROM opportunities o LEFT JOIN contacts c ON c.id = o.contact_id ORDER BY o.updated_at DESC`)));

api.post('/opportunities', wrap((req) => {
  const { contact_id, title, value, stage } = req.body;
  if (!title) throw fail(400, 'Título obligatorio');
  const id = insert('opportunities', { contact_id, title, value: Number(value) || 0, stage: stage || 'nuevo' });
  return get('SELECT * FROM opportunities WHERE id = ?', id);
}));

api.put('/opportunities/:id', wrap((req) => {
  const { stage, ...rest } = req.body;
  update('opportunities', req.params.id, rest, ['title', 'value', 'contact_id']);
  if (stage) moveOpportunity(Number(req.params.id), stage);
  return get('SELECT * FROM opportunities WHERE id = ?', req.params.id);
}));
api.delete('/opportunities/:id', wrap((req) => { run('DELETE FROM opportunities WHERE id = ?', req.params.id); return { ok: true }; }));

// ---------- tareas ----------
api.get('/tasks', wrap((req) => {
  const where = req.query.all ? '' : 'WHERE t.done = 0';
  return all(`SELECT t.*, c.name AS contact_name, j.number AS job_number, j.order_number FROM tasks t
    LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN jobs j ON j.id = t.job_id ${where}
    ORDER BY t.done, t.due_date IS NULL, t.due_date`);
}));
api.post('/tasks', wrap((req) => {
  if (!req.body.title) throw fail(400, 'Título obligatorio');
  const id = insert('tasks', { title: req.body.title, due_date: req.body.due_date || null, assignee: req.body.assignee || null, contact_id: req.body.contact_id || null, job_id: req.body.job_id || null });
  return get('SELECT * FROM tasks WHERE id = ?', id);
}));
api.put('/tasks/:id', wrap((req) => {
  const data = { ...req.body };
  if ('done' in data) data.done = data.done ? 1 : 0;
  update('tasks', req.params.id, data, ['title', 'due_date', 'assignee', 'done']);
  return get('SELECT * FROM tasks WHERE id = ?', req.params.id);
}));
api.delete('/tasks/:id', wrap((req) => { run('DELETE FROM tasks WHERE id = ?', req.params.id); return { ok: true }; }));

// ---------- catálogo ----------
const PRODUCT_FIELDS = ['sku', 'name', 'brand', 'category', 'base_cost', 'colors', 'sizes', 'supplier', 'active', 'kind', 'size_costs', 'price'];
// La excepción de markup y la casilla «comisionable» son parte de la matriz: solo la dueña, con historial.
const PRODUCT_OWNER_FIELDS = ['markup_mode', 'markup_value', 'commissionable'];
function productData(req, current = {}) {
  const data = Object.fromEntries(PRODUCT_FIELDS.filter((k) => k in req.body).map((k) => [k, req.body[k]]));
  for (const k of ['base_cost', 'price']) if (k in data) data[k] = numOrNull(data[k]);
  const owner = PRODUCT_OWNER_FIELDS.filter((k) => k in req.body && String(req.body[k] ?? '') !== String(current[k] ?? ''));
  if (owner.length) {
    requireRole(req, 'duena');
    for (const k of owner) {
      data[k] = k === 'markup_value' ? numOrNull(req.body[k]) : k === 'commissionable' ? (req.body[k] ? 1 : 0) : req.body[k] || null;
      audit(req.user, 'productos', `${current.name || req.body.name}: ${k}`, current[k] ?? null, data[k], String(current.id || ''));
    }
  }
  if (data.markup_mode && !['porcentaje', 'precio_fijo'].includes(data.markup_mode)) throw fail(400, 'Excepción inválida');
  return data;
}
api.get('/products', wrap(() => all('SELECT * FROM products ORDER BY category, name')));
api.post('/products', wrap((req) => {
  if (!req.body.name) throw fail(400, 'Nombre obligatorio');
  const id = insert('products', productData(req));
  return get('SELECT * FROM products WHERE id = ?', id);
}));
api.put('/products/:id', wrap((req) => {
  const p = get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!p) throw fail(404, 'No encontrado');
  update('products', p.id, productData(req, p));
  return get('SELECT * FROM products WHERE id = ?', p.id);
}));
api.delete('/products/:id', wrap((req) => { run('DELETE FROM products WHERE id = ?', req.params.id); return { ok: true }; }));

// Procesos de decoración: solo Bordado, DTF y Heat Transfer. Sus tarifas están en Ajustes → Tarifas.
api.get('/methods', wrap(() => Object.entries(PROCESOS).map(([code, name]) => ({ code, name }))));

// ---------- cotizaciones y órdenes ----------
api.get('/jobs', wrap((req) => {
  const { kind, status } = req.query;
  const cond = [];
  const params = [];
  if (kind) { cond.push('j.kind = ?'); params.push(kind); }
  if (status) { cond.push('j.status = ?'); params.push(status); }
  return all(`SELECT j.*, c.name AS contact_name, c.company AS contact_company,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.job_id = j.id),0) AS paid,
      (SELECT SUM(qty) FROM job_items i WHERE i.job_id = j.id) AS pieces,
      (SELECT status FROM proofs pr WHERE pr.job_id = j.id ORDER BY version DESC LIMIT 1) AS proof_status
    FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id
    ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY j.id DESC`, ...params);
}));

api.get('/jobs/:id', wrap((req) => loadJob(req.params.id)));

api.post('/jobs', wrap((req) => {
  const b = req.body;
  const id = transaction(() => {
    const contact = contactById(b.contact_id);
    const id = insert('jobs', {
      kind: 'quote', number: nextNumber('COT', 'seq_quote'), status: 'borrador',
      contact_id: b.contact_id || null, opportunity_id: b.opportunity_id || null,
      title: b.title || 'Nueva cotización', due_date: b.due_date || null, notes: b.notes || '',
      discount: Number(b.discount) || 0, token: token(),
      pricing_version_id: currentPricing().id,
      tax_exempt: b.tax_exempt !== undefined ? (b.tax_exempt ? 1 : 0) : contact?.tax_exempt ? 1 : 0,
      shipping_charged: numOrNull(b.shipping_charged) || 0, shipping_cost: numOrNull(b.shipping_cost),
      extra_costs: b.extra_costs || [],
      salesperson_id: b.salesperson_id || null, commission_rule_id: b.commission_rule_id || null,
      client_status: b.client_status || computeClientStatus(b.contact_id, 0), client_status_manual: b.client_status ? 1 : 0,
    });
    saveItems(id, b.items || []);
    return id;
  });
  return loadJob(id);
}));

const JOB_FIELDS = ['contact_id', 'opportunity_id', 'title', 'due_date', 'priority', 'assignee', 'notes', 'discount',
  'shipping_charged', 'shipping_cost', 'extra_costs', 'tax_exempt', 'salesperson_id', 'commission_rule_id', 'client_status', 'client_status_manual', 'invoice_date'];
api.put('/jobs/:id', wrap((req) => {
  const id = Number(req.params.id);
  const antes = get('SELECT * FROM jobs WHERE id = ?', id);
  if (!antes) throw fail(404, 'No encontrado');
  const b = { ...req.body };
  for (const k of ['discount', 'shipping_charged']) if (k in b) b[k] = numOrNull(b[k]) || 0;
  if ('shipping_cost' in b) b.shipping_cost = numOrNull(b.shipping_cost);
  if ('tax_exempt' in b) b.tax_exempt = b.tax_exempt ? 1 : 0;
  if ('invoice_date' in b) {
    requireRole(req, 'finanzas', 'duena'); // la fecha de factura afecta comisiones
    if (b.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.invoice_date)) throw fail(400, 'Fecha de factura inválida');
    audit(req.user, 'ordenes', `fecha de factura orden ${id}`, antes.invoice_date, b.invoice_date || null, String(id));
  }
  if ('extra_costs' in b) b.extra_costs = (b.extra_costs || []).map((x) => ({ concepto: x.concepto || 'Costo directo', tipo: x.tipo === 'setup' ? 'setup' : 'otro', monto: numOrNull(x.monto) }));
  if ('client_status' in b) { b.client_status_manual = b.client_status ? 1 : 0; if (!b.client_status) b.client_status = computeClientStatus(b.contact_id ?? antes.contact_id, id); }
  else if ('contact_id' in b && b.contact_id !== antes.contact_id && !antes.client_status_manual) b.client_status = computeClientStatus(b.contact_id, id);
  transaction(() => {
    update('jobs', id, b, JOB_FIELDS);
    if (req.body.items) saveItems(id, req.body.items);
    else computeJob(id);
  });
  return loadJob(id);
}));

// Recalcula una cotización en borrador con las tarifas vigentes (por defecto conserva las de cuando se creó).
api.post('/jobs/:id/actualizar-tarifas', wrap((req) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!job || job.kind !== 'quote') throw fail(400, 'Solo cotizaciones');
  run('UPDATE jobs SET pricing_version_id = ? WHERE id = ?', currentPricing().id, job.id);
  computeJob(job.id);
  return loadJob(job.id);
}));

api.delete('/jobs/:id', wrap((req) => { run('DELETE FROM jobs WHERE id = ?', req.params.id); return { ok: true }; }));

api.post('/jobs/:id/send', wrap((req) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!job || job.kind !== 'quote') throw fail(400, 'Solo cotizaciones');
  assertMarginApproved(job.id);
  run("UPDATE jobs SET status = 'enviada', updated_at = datetime('now') WHERE id = ?", job.id);
  logSystem(job, `Cotización ${job.number} enviada al cliente`);
  const base = `${req.protocol}://${req.get('host')}`;
  fire('quote.sent', { job: { ...job, status: 'enviada', link: `${base}/portal/${job.token}` }, contact: contactById(job.contact_id) });
  return loadJob(job.id);
}));

api.post('/jobs/:id/approve', wrap((req) => { approveQuote(Number(req.params.id), req.body.approved !== false, req.body.comment); return loadJob(req.params.id); }));
api.post('/jobs/:id/convert', wrap((req) => { convertToOrder(Number(req.params.id)); return loadJob(req.params.id); }));
api.post('/jobs/:id/status', wrap((req) => { setOrderStatus(Number(req.params.id), req.body.status); return loadJob(req.params.id); }));

api.post('/jobs/:id/duplicate', wrap((req) => {
  const src = loadJob(req.params.id);
  const id = transaction(() => {
    const id = insert('jobs', {
      kind: 'quote', number: nextNumber('COT', 'seq_quote'), status: 'borrador', contact_id: src.contact_id,
      title: `${src.title} (copia)`, notes: src.notes, discount: src.discount, token: token(),
      pricing_version_id: currentPricing().id, tax_exempt: src.tax_exempt, shipping_charged: src.shipping_charged,
      shipping_cost: src.shipping_cost, extra_costs: src.extra_costs || [], salesperson_id: src.salesperson_id,
      commission_rule_id: src.commission_rule_id, client_status: computeClientStatus(src.contact_id, 0),
    });
    saveItems(id, src.items.map(({ id: _i, calc: _c, ...it }) => it));
    return id;
  });
  return loadJob(id);
}));

// Pruebas de arte (proofs)
api.post('/jobs/:id/proofs', express.json({ limit: '20mb' }), wrap((req) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!job) throw fail(404, 'No encontrado');
  const { file, filename = 'arte.png', note, design } = req.body;
  let fileUrl = req.body.url || null;
  if (file) {
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(file);
    if (!m) throw fail(400, 'Archivo inválido');
    const ext = (filename.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 5);
    const name = `${job.id}-${Date.now()}.${ext}`;
    writeFileSync(resolve(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
    fileUrl = `/uploads/${name}`;
  }
  if (!fileUrl) throw fail(400, 'Adjunta un archivo');
  const version = (get('SELECT MAX(version) AS v FROM proofs WHERE job_id = ?', job.id).v || 0) + 1;
  const pid = insert('proofs', { job_id: job.id, version, file_url: fileUrl, note: note || null, design: design ? JSON.stringify(design) : null });
  logSystem(job, `Prueba de arte v${version} subida`);
  if (job.kind === 'order' && job.status === 'arte') setOrderStatus(job.id, 'aprobacion');
  const base = `${req.protocol}://${req.get('host')}`;
  fire('proof.uploaded', { job: { ...job, link: `${base}/portal/${job.token}` }, proof: { id: pid, version }, contact: contactById(job.contact_id) });
  return loadJob(job.id);
}));

api.get('/proofs/:id/design', wrap((req) => {
  const r = get('SELECT design FROM proofs WHERE id = ?', req.params.id);
  if (!r?.design) throw fail(404, 'Esta prueba no tiene diseño editable');
  return JSON.parse(r.design);
}));

api.post('/proofs/:id/decision', wrap((req) => {
  decideProof(Number(req.params.id), req.body.status, req.body.comment);
  const p = get('SELECT job_id FROM proofs WHERE id = ?', req.params.id);
  return loadJob(p.job_id);
}));

// Pagos
api.post('/jobs/:id/payments', wrap((req) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!job) throw fail(404, 'No encontrado');
  const amount = Number(req.body.amount);
  if (!(amount > 0)) throw fail(400, 'Monto inválido');
  const pid = insert('payments', { job_id: job.id, amount, method: req.body.method || 'efectivo', reference: req.body.reference || null, paid_at: req.body.paid_at || now().slice(0, 10) });
  logSystem(job, `Pago recibido: $${amount.toFixed(2)} (${req.body.method || 'efectivo'})`);
  computeJob(job.id);
  fire('payment.received', { job, payment: { id: pid, amount }, contact: contactById(job.contact_id) });
  return loadJob(job.id);
}));
api.delete('/payments/:id', wrap((req) => {
  requireRole(req, 'finanzas', 'duena');
  const p = get('SELECT * FROM payments WHERE id = ?', req.params.id);
  if (!p) throw fail(404, 'No encontrado');
  run('DELETE FROM payments WHERE id = ?', p.id);
  audit(req.user, 'pagos', `pago eliminado orden ${p.job_id}`, p, null, String(p.id));
  computeJob(p.job_id);
  return { ok: true };
}));

// ---------- SanMar (solo lectura) ----------
// Estilo: descripción, marca, colores con fotos y tallas.
api.get('/sanmar/style/:estilo', awrap(async (req) => {
  if (req.query.refresh) clearSanmarCache(req.params.estilo);
  const d = await sanmar.buscarEstilo(req.params.estilo);
  return { ...d, areas: { flat: getStyleAreas(d.estilo, 'flat'), model: getStyleAreas(d.estilo, 'model') } };
}));
// Color: tallas con costo SanMar, precio de venta (markup de la app) e inventario.
api.get('/sanmar/style/:estilo/:color', awrap(async (req) => {
  if (req.query.refresh) clearSanmarCache(req.params.estilo);
  const d = await sanmar.obtenerDetalleColor(req.params.estilo, req.params.color);
  const cfg = currentPricing().config;
  return { ...d, modoMarkup: cfg.prendas.modo, tallas: d.tallas.map((t) => ({ ...t, precioVenta: precioPrenda(t.costo, cfg).precio })) };
}));
api.get('/sanmar/image', awrap(async (req, res) => {
  const file = await cacheImage(String(req.query.u || ''), UPLOAD_DIR);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(file);
}));
api.put('/sanmar/areas/:style/:kind', wrap((req) => {
  if (!['flat', 'model'].includes(req.params.kind)) throw fail(400, 'Tipo inválido');
  setStyleAreas(req.params.style, req.params.kind, req.body);
  return { ok: true };
}));
// Importa un estilo al catálogo local (no escribe nada en SanMar).
api.post('/sanmar/import', awrap(async (req) => {
  if (!req.body.style) throw fail(400, 'Indica el estilo (ej. PC61)');
  clearSanmarCache(req.body.style);
  const d = await sanmar.buscarEstilo(req.body.style);
  // Costo desconocido = null (nunca 0). Por talla se guarda el costo más alto entre colores, para no cotizar por debajo.
  let costo = null;
  const sizeCosts = {};
  try {
    const precios = await sanmar.obtenerPrecios(d.estilo);
    const costos = precios.map((p) => p.costo).filter((c) => c > 0);
    if (costos.length) costo = Math.min(...costos);
    for (const f of precios) if (f.talla && f.costo > 0) sizeCosts[f.talla] = Math.max(sizeCosts[f.talla] || 0, f.costo);
  } catch (e) {
    if (e.codigo === 'CREDENCIALES') throw e; // otros errores de precios no impiden importar el producto
  }
  const data = { sku: d.estilo, name: d.titulo || d.estilo, brand: d.marca, base_cost: costo, size_costs: sizeCosts, colors: d.colores.map((c) => c.nombre), sizes: d.tallas, supplier: 'SanMar' };
  const existing = get("SELECT id FROM products WHERE upper(sku) = upper(?) AND supplier = 'SanMar'", d.estilo);
  if (existing) update('products', existing.id, data);
  const id = existing ? existing.id : insert('products', { ...data, category: req.body.category || 'SanMar' });
  return get('SELECT * FROM products WHERE id = ?', id);
}));

// ---------- automatizaciones ----------
const AUTO_FIELDS = ['name', 'trigger', 'condition', 'action', 'params', 'active'];
api.get('/automations', wrap(() => all('SELECT * FROM automations ORDER BY id')));
api.post('/automations', wrap((req) => {
  const b = req.body;
  if (!TRIGGERS[b.trigger] || !ACTIONS[b.action]) throw fail(400, 'Disparador o acción inválidos');
  const id = insert('automations', { name: b.name || ACTIONS[b.action], trigger: b.trigger, condition: b.condition || {}, action: b.action, params: b.params || {}, active: b.active === false ? 0 : 1 });
  return get('SELECT * FROM automations WHERE id = ?', id);
}));
api.put('/automations/:id', wrap((req) => {
  const data = { ...req.body };
  if ('active' in data) data.active = data.active ? 1 : 0;
  update('automations', req.params.id, data, AUTO_FIELDS);
  return get('SELECT * FROM automations WHERE id = ?', req.params.id);
}));
api.delete('/automations/:id', wrap((req) => { run('DELETE FROM automations WHERE id = ?', req.params.id); return { ok: true }; }));

// ---------- portal del cliente (público, por token) ----------
function portalJob(tok) {
  const j = get('SELECT id FROM jobs WHERE token = ?', tok);
  if (!j) throw fail(404, 'Enlace inválido');
  const job = loadJob(j.id);
  const { email, phone, name, company } = job.contact || {};
  // Solo datos de venta: nunca costos, márgenes ni comisiones.
  const items = job.items.map((it) => ({
    id: it.id, description: it.description, color: it.color, sizes: it.sizes, qty: it.qty, unit_price: it.unit_price, total: it.total,
    line_discount: it.line_discount || 0,
    decorations: (it.decorations || []).map((d) => ({ location: d.location, width: d.width, height: d.height, method_name: PROCESOS[d.process] || PROCESOS[d.method] || d.process || d.method })),
  }));
  const proofs = job.proofs.map(({ id, version, file_url, note, status, customer_comment, created_at }) => ({ id, version, file_url, note, status, customer_comment, created_at }));
  const f = job.finanzas;
  return {
    id: job.id, kind: job.kind, number: job.number, order_number: job.order_number, title: job.title, status: job.status,
    due_date: job.due_date, notes: job.notes, subtotal: f.ventaProductos, discount: f.descuentoGlobal + f.creditos, shipping: f.envioCobrado,
    tax: f.impuesto, total: f.total, paid: job.paid, balance: job.balance, items, proofs,
    contact: { name, company, email, phone }, business_name: getSetting('business_name', 'Color Plus LLC'), brand: getBrand(),
    deposit_pct: getSetting('deposit_pct', 0.5),
  };
}
api.get('/portal/:token', wrap((req) => portalJob(req.params.token)));
api.post('/portal/:token/quote', wrap((req) => {
  const j = portalJob(req.params.token);
  if (j.kind !== 'quote' || !['enviada', 'borrador'].includes(j.status)) throw fail(400, 'Esta cotización ya no se puede modificar');
  approveQuote(j.id, req.body.approved !== false, req.body.comment);
  return portalJob(req.params.token);
}));
api.post('/portal/:token/proofs/:id', wrap((req) => {
  const j = portalJob(req.params.token);
  const proof = j.proofs.find((p) => p.id === Number(req.params.id));
  if (!proof || proof.status !== 'pendiente') throw fail(400, 'Esta prueba ya fue revisada');
  decideProof(proof.id, req.body.status, req.body.comment);
  return portalJob(req.params.token);
}));

export default api;
