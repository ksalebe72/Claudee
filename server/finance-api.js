// Rutas de costos, rentabilidad, comisiones, liquidaciones, tarifas, historial y reportes.
import express from 'express';
import { all, get, run, insert, update, getSetting } from './db.js';
import { requireRole } from './auth.js';
import { currentPricing, pricingVersion, savePricing, audit, listRules } from './config.js';
import {
  computeJob, approveMargin, confirmCosts, liquidationView, changeLiquidationStatus, syncLiquidation,
  profitabilityReport, commissionReport, today,
} from './finance.js';
import { liquidationPdf, liquidationXlsx } from './exports.js';
import { logoFilePath } from './brand.js';
import { UPLOAD_DIR } from './api.js';
import { CATEGORIAS_COSTO } from '../shared/pricing.js';

const r = express.Router();
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const wrap = (fn) => async (req, res) => {
  try { const out = await fn(req, res); if (out !== undefined) res.json(out); } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const FINANZAS = ['finanzas', 'duena'];
const GESTION = ['finanzas', 'duena', 'gerencia', 'coordinacion']; // ven liquidaciones y reportes

// ---------- tarifas (matriz) ----------
r.get('/tarifas', wrap(() => {
  const actual = currentPricing();
  return { ...actual, versiones: all('SELECT id, note, created_by, created_at FROM pricing_versions ORDER BY id DESC LIMIT 50') };
}));
r.get('/tarifas/:id', wrap((req) => pricingVersion(Number(req.params.id))));
r.put('/tarifas', wrap((req) => {
  requireRole(req, 'duena');
  return savePricing(req.body.config, req.user, req.body.nota);
}));

// ---------- historial de cambios ----------
r.get('/auditoria', wrap((req) => {
  requireRole(req, 'duena');
  const area = req.query.area;
  return all(`SELECT * FROM audit_log ${area ? 'WHERE area = ?' : ''} ORDER BY id DESC LIMIT 500`, ...(area ? [area] : []));
}));

// ---------- vendedores y reglas ----------
r.get('/vendedores', wrap(() => all('SELECT * FROM salespeople ORDER BY active DESC, name')));
r.post('/vendedores', wrap((req) => {
  requireRole(req, 'duena');
  if (!req.body.name) throw fail(400, 'Nombre obligatorio');
  const id = insert('salespeople', { name: req.body.name });
  audit(req.user, 'comisiones', `vendedor ${req.body.name}`, null, 'creado', String(id));
  return get('SELECT * FROM salespeople WHERE id = ?', id);
}));
r.put('/vendedores/:id', wrap((req) => {
  requireRole(req, 'duena');
  const s = get('SELECT * FROM salespeople WHERE id = ?', req.params.id);
  if (!s) throw fail(404, 'No encontrado');
  const datos = { name: req.body.name ?? s.name, active: req.body.active === undefined ? s.active : req.body.active ? 1 : 0, default_rule_id: s.default_rule_id ?? null };
  if ('default_rule_id' in req.body) {
    const rid = req.body.default_rule_id ? Number(req.body.default_rule_id) : null;
    const regla = rid && get('SELECT * FROM commission_rules WHERE id = ?', rid);
    if (rid && (!regla || (regla.salesperson_id && regla.salesperson_id !== s.id))) throw fail(400, 'Esa regla no es de este vendedor');
    datos.default_rule_id = rid;
  }
  update('salespeople', s.id, datos);
  audit(req.user, 'comisiones', `vendedor ${s.name}`, { name: s.name, active: s.active, regla_automatica: s.default_rule_id ?? null }, { name: datos.name, active: datos.active, regla_automatica: datos.default_rule_id }, String(s.id));
  return get('SELECT * FROM salespeople WHERE id = ?', s.id);
}));

const BASES = ['venta_neta', 'ganancia_producto', 'ganancia_total'];
r.get('/comisiones/reglas', wrap(() => listRules()));
r.post('/comisiones/reglas', wrap((req) => {
  requireRole(req, 'duena');
  const b = req.body;
  if (!b.name || !BASES.includes(b.base)) throw fail(400, 'Nombre y base (venta neta o ganancia) obligatorios');
  const rate = num(b.rate);
  if (rate == null || rate < 0 || rate > 1) throw fail(400, 'Tasa entre 0 y 100%');
  const id = insert('commission_rules', { salesperson_id: b.salesperson_id || null, name: b.name, base: b.base, client_type: b.client_type || null });
  insert('commission_rates', { rule_id: id, rate, effective_from: isDate(b.effective_from) ? b.effective_from : today(), created_by: req.user.name });
  audit(req.user, 'comisiones', `regla ${b.name}`, null, { base: b.base, tasa: rate, client_type: b.client_type || null }, String(id));
  return listRules().find((x) => x.id === id);
}));
r.put('/comisiones/reglas/:id', wrap((req) => {
  requireRole(req, 'duena');
  const rule = get('SELECT * FROM commission_rules WHERE id = ?', req.params.id);
  if (!rule) throw fail(404, 'No encontrada');
  const b = req.body;
  if (b.base && !BASES.includes(b.base)) throw fail(400, 'Base inválida');
  const datos = {
    name: b.name ?? rule.name, base: b.base ?? rule.base, client_type: b.client_type === undefined ? rule.client_type : b.client_type || null,
    salesperson_id: b.salesperson_id === undefined ? rule.salesperson_id : b.salesperson_id || null,
    active: b.active === undefined ? rule.active : b.active ? 1 : 0,
  };
  update('commission_rules', rule.id, datos);
  audit(req.user, 'comisiones', `regla ${rule.name}`, { name: rule.name, base: rule.base, client_type: rule.client_type, active: rule.active }, datos, String(rule.id));
  return listRules().find((x) => x.id === rule.id);
}));
r.post('/comisiones/reglas/:id/tasas', wrap((req) => {
  requireRole(req, 'duena');
  const rule = get('SELECT * FROM commission_rules WHERE id = ?', req.params.id);
  if (!rule) throw fail(404, 'No encontrada');
  const rate = num(req.body.rate);
  if (rate == null || rate < 0 || rate > 1) throw fail(400, 'Tasa entre 0 y 100%');
  if (!isDate(req.body.effective_from)) throw fail(400, 'Fecha de vigencia inválida');
  const anterior = get('SELECT rate FROM commission_rates WHERE rule_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1', rule.id, req.body.effective_from);
  insert('commission_rates', { rule_id: rule.id, rate, effective_from: req.body.effective_from, created_by: req.user.name });
  audit(req.user, 'comisiones', `tasa ${rule.name} desde ${req.body.effective_from}`, anterior?.rate ?? null, rate, String(rule.id));
  return listRules().find((x) => x.id === rule.id);
}));

// ---------- finanzas de una orden ----------
const jobOr404 = (id) => { const j = get('SELECT * FROM jobs WHERE id = ?', id); if (!j) throw fail(404, 'Orden no encontrada'); return j; };

r.get('/jobs/:id/finanzas', wrap((req) => {
  jobOr404(req.params.id);
  return {
    ...computeJob(Number(req.params.id)).fin,
    costosReales: all('SELECT * FROM job_actual_costs WHERE job_id = ? ORDER BY id', req.params.id),
    creditos: all('SELECT * FROM job_credits WHERE job_id = ? ORDER BY id', req.params.id),
  };
}));

r.post('/jobs/:id/costos-reales', wrap((req) => {
  requireRole(req, ...FINANZAS);
  jobOr404(req.params.id);
  const { category, supplier, invoice_ref, cost_date, note } = req.body;
  const amount = num(req.body.amount);
  if (!CATEGORIAS_COSTO[category]) throw fail(400, 'Categoría de costo inválida');
  if (amount == null || amount < 0) throw fail(400, 'Monto inválido');
  const id = insert('job_actual_costs', { job_id: Number(req.params.id), category, supplier: supplier || null, invoice_ref: invoice_ref || null, amount, cost_date: isDate(cost_date) ? cost_date : today(), note: note || null, created_by: req.user.name });
  audit(req.user, 'costos', `costo real orden ${req.params.id}`, null, { category, supplier, invoice_ref, amount }, String(id));
  return computeJob(Number(req.params.id)).fin;
}));
r.delete('/costos-reales/:id', wrap((req) => {
  requireRole(req, ...FINANZAS);
  const c = get('SELECT * FROM job_actual_costs WHERE id = ?', req.params.id);
  if (!c) throw fail(404, 'No encontrado');
  run('DELETE FROM job_actual_costs WHERE id = ?', c.id);
  audit(req.user, 'costos', `costo real orden ${c.job_id}`, c, null, String(c.id));
  return computeJob(c.job_id).fin;
}));

const TIPOS_CREDITO = { descuento: 'Descuento posterior', credito: 'Crédito', devolucion: 'Devolución' };
r.post('/jobs/:id/creditos', wrap((req) => {
  requireRole(req, ...FINANZAS);
  jobOr404(req.params.id);
  const amount = num(req.body.amount);
  if (!TIPOS_CREDITO[req.body.type]) throw fail(400, 'Tipo inválido (descuento, crédito o devolución)');
  if (!(amount > 0)) throw fail(400, 'Monto inválido');
  const id = insert('job_credits', { job_id: Number(req.params.id), type: req.body.type, amount, credit_date: isDate(req.body.credit_date) ? req.body.credit_date : today(), note: req.body.note || null, created_by: req.user.name });
  audit(req.user, 'creditos', `orden ${req.params.id}`, null, { type: req.body.type, amount }, String(id));
  return computeJob(Number(req.params.id)).fin;
}));
r.delete('/creditos/:id', wrap((req) => {
  requireRole(req, ...FINANZAS);
  const c = get('SELECT * FROM job_credits WHERE id = ?', req.params.id);
  if (!c) throw fail(404, 'No encontrado');
  run('DELETE FROM job_credits WHERE id = ?', c.id);
  audit(req.user, 'creditos', `orden ${c.job_id}`, c, null, String(c.id));
  return computeJob(c.job_id).fin;
}));

r.post('/jobs/:id/confirmar-costos', wrap((req) => {
  requireRole(req, ...FINANZAS);
  jobOr404(req.params.id);
  return confirmCosts(Number(req.params.id), req.user, req.body.confirmar !== false).fin;
}));
r.post('/jobs/:id/aprobar-margen', wrap((req) => {
  jobOr404(req.params.id);
  return approveMargin(Number(req.params.id), req.user, req.body.nota).fin;
}));

// ---------- liquidaciones ----------
const PERIODO = /^\d{4}-\d{2}$/;
r.get('/liquidaciones', wrap((req) => {
  requireRole(req, ...GESTION);
  const periodo = PERIODO.test(req.query.periodo || '') ? req.query.periodo : today().slice(0, 7);
  return { periodo, vendedores: all('SELECT * FROM salespeople WHERE active = 1 ORDER BY name').map((s) => liquidationView(periodo, s.id)) };
}));
r.get('/liquidaciones/historial', wrap((req) => {
  requireRole(req, ...GESTION);
  return all('SELECT l.*, s.name AS vendedor FROM liquidations l JOIN salespeople s ON s.id = l.salesperson_id ORDER BY l.period DESC, s.name LIMIT 200');
}));
r.get('/liquidaciones/:periodo/:vendedor', wrap((req) => {
  requireRole(req, ...GESTION);
  if (!PERIODO.test(req.params.periodo)) throw fail(400, 'Mes inválido (AAAA-MM)');
  return liquidationView(req.params.periodo, Number(req.params.vendedor));
}));
r.post('/liquidaciones/:periodo/:vendedor/accion', wrap((req) => {
  if (!PERIODO.test(req.params.periodo)) throw fail(400, 'Mes inválido (AAAA-MM)');
  const sp = Number(req.params.vendedor);
  const liq = syncLiquidation(req.params.periodo, sp) || get('SELECT * FROM liquidations WHERE period = ? AND salesperson_id = ?', req.params.periodo, sp);
  if (!liq) throw fail(400, 'No hay comisiones en esta liquidación.');
  changeLiquidationStatus(liq.id, req.body.accion, req.user, req.body);
  return liquidationView(req.params.periodo, sp);
}));
r.get('/liquidaciones/:periodo/:vendedor/exportar.:formato', wrap(async (req, res) => {
  requireRole(req, ...GESTION);
  if (!PERIODO.test(req.params.periodo)) throw fail(400, 'Mes inválido');
  const v = liquidationView(req.params.periodo, Number(req.params.vendedor));
  const business = getSetting('business_name', 'Color Plus LLC');
  const nombre = `liquidacion-${req.params.periodo}-${(v.vendedor?.name || 'vendedor').toLowerCase().replace(/\W+/g, '-')}`;
  if (req.params.formato === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
    liquidationPdf(v, business, res, logoFilePath(UPLOAD_DIR));
    return undefined;
  }
  if (req.params.formato === 'xlsx') {
    const buf = await liquidationXlsx(v, business);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    res.send(Buffer.from(buf));
    return undefined;
  }
  throw fail(400, 'Formato: pdf o xlsx');
}));

// ---------- reportes ----------
r.get('/reportes/rentabilidad', wrap((req) => {
  requireRole(req, ...GESTION);
  const agrupar = ['orden', 'cliente', 'proceso', 'vendedor'].includes(req.query.agrupar) ? req.query.agrupar : 'orden';
  return { agrupar, filas: profitabilityReport({ desde: req.query.desde, hasta: req.query.hasta, agrupar }) };
}));
r.get('/reportes/bajo-margen', wrap((req) => {
  requireRole(req, ...GESTION);
  const minimo = currentPricing().config.margen.minimo * 100;
  return { minimo, filas: profitabilityReport({ desde: req.query.desde, hasta: req.query.hasta, agrupar: 'orden' }).filter((f) => !f.incompleta && f.contribucionPct != null && f.contribucionPct < minimo) };
}));
r.get('/reportes/comisiones', wrap((req) => {
  requireRole(req, ...GESTION);
  return commissionReport({ desde: req.query.desde, hasta: req.query.hasta });
}));

export default r;
