import express from 'express';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, insert, update, getSetting, setSetting, methodsMap, transaction } from './db.js';
import { fire, registerHandler, TRIGGERS, ACTIONS } from './automations.js';
import { priceItem, jobTotals } from '../shared/pricing.js';
import { sendMessage } from './messaging.js';
import { sanmar, sanmarConfigured, cacheImage, getStyleAreas, setStyleAreas, getSanmarMarkup, precioVenta, clearSanmarCache } from './sanmar.js';

export const UPLOAD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'uploads');

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
  return job;
}

function saveItems(jobId, items, discount, taxRate) {
  const methods = methodsMap();
  const markup = getSetting('markup', 0.6);
  run('DELETE FROM job_items WHERE job_id = ?', jobId);
  const priced = items.map((it, idx) => {
    const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', it.product_id) : null;
    const p = priceItem(it, product, methods, markup);
    insert('job_items', {
      job_id: jobId, product_id: it.product_id || null, description: it.description || product?.name || '',
      color: it.color || '', sizes: it.sizes || {}, decorations: it.decorations || [],
      custom_price: it.custom_price === '' || it.custom_price == null ? null : Number(it.custom_price),
      qty: p.qty, unit_price: p.unit_price, setup: p.setup, total: p.total, position: idx,
    });
    return p;
  });
  const t = jobTotals(priced, discount, taxRate);
  run("UPDATE jobs SET subtotal = ?, tax = ?, total = ?, updated_at = datetime('now') WHERE id = ?", t.subtotal, t.tax, t.total, jobId);
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
  const orderNumber = nextNumber('OT', 'seq_order');
  run(
    "UPDATE jobs SET kind = 'order', status = 'arte', order_number = ?, updated_at = datetime('now') WHERE id = ?",
    orderNumber, id
  );
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
api.get('/meta', wrap(() => ({
  oppStages: OPP_STAGES, quoteStatuses: QUOTE_STATUSES, orderStatuses: ORDER_STATUSES,
  triggers: TRIGGERS, actions: ACTIONS,
  settings: {
    business_name: getSetting('business_name', 'Mi Taller'),
    markup: getSetting('markup', 0.6),
    tax_rate: getSetting('tax_rate', 0),
    deposit_pct: getSetting('deposit_pct', 0.5),
    sanmar_markup: getSanmarMarkup(),
  },
  integrations: { sanmar: sanmarConfigured() },
})));

api.put('/settings', wrap((req) => {
  for (const k of ['business_name', 'markup', 'tax_rate', 'deposit_pct', 'sanmar_markup']) if (k in req.body) setSetting(k, req.body[k]);
  return { ok: true };
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

const CONTACT_FIELDS = ['name', 'company', 'email', 'phone', 'tags', 'source', 'address', 'notes'];
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
const PRODUCT_FIELDS = ['sku', 'name', 'brand', 'category', 'base_cost', 'colors', 'sizes', 'supplier', 'active'];
api.get('/products', wrap(() => all('SELECT * FROM products ORDER BY category, name')));
api.post('/products', wrap((req) => {
  if (!req.body.name) throw fail(400, 'Nombre obligatorio');
  const id = insert('products', Object.fromEntries(PRODUCT_FIELDS.filter((k) => k in req.body).map((k) => [k, req.body[k]])));
  return get('SELECT * FROM products WHERE id = ?', id);
}));
api.put('/products/:id', wrap((req) => { update('products', req.params.id, req.body, PRODUCT_FIELDS); return get('SELECT * FROM products WHERE id = ?', req.params.id); }));
api.delete('/products/:id', wrap((req) => { run('DELETE FROM products WHERE id = ?', req.params.id); return { ok: true }; }));

const METHOD_FIELDS = ['code', 'name', 'setup_fee', 'setup_per_color', 'color_price', 'tiers'];
api.get('/methods', wrap(() => all('SELECT * FROM decoration_methods ORDER BY name')));
api.post('/methods', wrap((req) => {
  if (!req.body.code || !req.body.name) throw fail(400, 'Código y nombre obligatorios');
  const id = insert('decoration_methods', Object.fromEntries(METHOD_FIELDS.filter((k) => k in req.body).map((k) => [k, req.body[k]])));
  return get('SELECT * FROM decoration_methods WHERE id = ?', id);
}));
api.put('/methods/:id', wrap((req) => { update('decoration_methods', req.params.id, req.body, METHOD_FIELDS); return get('SELECT * FROM decoration_methods WHERE id = ?', req.params.id); }));
api.delete('/methods/:id', wrap((req) => { run('DELETE FROM decoration_methods WHERE id = ?', req.params.id); return { ok: true }; }));

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
    const id = insert('jobs', {
      kind: 'quote', number: nextNumber('COT', 'seq_quote'), status: 'borrador',
      contact_id: b.contact_id || null, opportunity_id: b.opportunity_id || null,
      title: b.title || 'Nueva cotización', due_date: b.due_date || null, notes: b.notes || '',
      tax_rate: b.tax_rate ?? getSetting('tax_rate', 0), discount: Number(b.discount) || 0, token: token(),
    });
    saveItems(id, b.items || [], b.discount, b.tax_rate ?? getSetting('tax_rate', 0));
    return id;
  });
  return loadJob(id);
}));

const JOB_FIELDS = ['contact_id', 'opportunity_id', 'title', 'due_date', 'priority', 'assignee', 'notes', 'discount', 'tax_rate'];
api.put('/jobs/:id', wrap((req) => {
  const id = Number(req.params.id);
  transaction(() => {
    update('jobs', id, req.body, JOB_FIELDS);
    const job = get('SELECT * FROM jobs WHERE id = ?', id);
    if (req.body.items) saveItems(id, req.body.items, job.discount, job.tax_rate);
    else saveItems(id, all('SELECT * FROM job_items WHERE job_id = ?', id), job.discount, job.tax_rate);
  });
  return loadJob(id);
}));

api.delete('/jobs/:id', wrap((req) => { run('DELETE FROM jobs WHERE id = ?', req.params.id); return { ok: true }; }));

api.post('/jobs/:id/send', wrap((req) => {
  const job = get('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!job || job.kind !== 'quote') throw fail(400, 'Solo cotizaciones');
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
      title: `${src.title} (copia)`, notes: src.notes, discount: src.discount, tax_rate: src.tax_rate, token: token(),
    });
    saveItems(id, src.items, src.discount, src.tax_rate);
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
  fire('payment.received', { job, payment: { id: pid, amount }, contact: contactById(job.contact_id) });
  return loadJob(job.id);
}));
api.delete('/payments/:id', wrap((req) => { run('DELETE FROM payments WHERE id = ?', req.params.id); return { ok: true }; }));

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
  const markup = getSanmarMarkup();
  return { ...d, markup, tallas: d.tallas.map((t) => ({ ...t, precioVenta: precioVenta(t.costo, markup) })) };
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
  let costo = null;
  try {
    const precios = await sanmar.obtenerPrecios(d.estilo);
    const costos = precios.map((p) => p.costo).filter((c) => c > 0);
    if (costos.length) costo = Math.min(...costos);
  } catch (e) {
    if (e.codigo === 'CREDENCIALES') throw e; // otros errores de precios no impiden importar el producto
  }
  const data = { sku: d.estilo, name: d.titulo || d.estilo, brand: d.marca, base_cost: costo ?? 0, colors: d.colores.map((c) => c.nombre), sizes: d.tallas, supplier: 'SanMar' };
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
  const methods = methodsMap();
  for (const it of job.items) it.decorations = (it.decorations || []).map((d) => ({ ...d, method_name: methods[d.method]?.name || d.method }));
  return {
    id: job.id, kind: job.kind, number: job.number, order_number: job.order_number, title: job.title, status: job.status,
    due_date: job.due_date, notes: job.notes, subtotal: job.subtotal, discount: job.discount, tax: job.tax, total: job.total,
    paid: job.paid, balance: job.balance, items: job.items, proofs: job.proofs,
    contact: { name, company, email, phone }, business_name: getSetting('business_name', 'Mi Taller'),
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
