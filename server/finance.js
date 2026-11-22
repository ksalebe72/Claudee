// Rentabilidad por orden, cobro, aprobaciones de margen y liquidación de comisiones.
// Nada de este módulo cobra, paga ni envía mensajes: solo calcula y registra.
import { all, get, run, insert, update } from './db.js';
import { calcularLinea, calcularRentabilidad, round2 } from '../shared/pricing.js';
import { pricingVersion, ruleAt, audit } from './config.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });
export const today = () => new Date().toISOString().slice(0, 10);
export const periodOf = (date) => String(date).slice(0, 7);
export function addMonths(period, n) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- líneas ----------
export function lineInput(row) {
  return {
    line_type: row.line_type || 'prenda', description: row.description, color: row.color,
    sizes: row.sizes || {}, qty: row.qty, unit_cost: row.unit_cost, size_costs: row.size_costs || {},
    price_mode: row.price_mode || 'auto', manual_price: row.manual_price, override: row.override || null,
    unit_price: row.unit_price, decorations: row.decorations || [], line_discount: row.line_discount || 0,
    ajuste_pct: row.ajuste_pct || 0,
    commissionable: row.commissionable !== 0 && row.commissionable !== false,
  };
}

/** Datos del producto que se congelan en la línea al agregarla (costo, tallas, excepción de markup). */
export function productSnapshot(product) {
  if (!product) return {};
  const override = product.markup_mode === 'porcentaje' || product.markup_mode === 'precio_fijo'
    ? { tipo: product.markup_mode, valor: product.markup_value } : null;
  return {
    line_type: product.kind === 'servicio' ? 'servicio' : 'prenda',
    unit_cost: product.base_cost ?? null,
    size_costs: product.size_costs || {},
    override,
    commissionable: product.commissionable === 0 ? 0 : 1,
    ...(product.kind === 'servicio' ? { unit_price: product.price ?? null } : {}),
  };
}

// ---------- cobro ----------
export function paymentStatus(job, total) {
  const pagos = all('SELECT * FROM payments WHERE job_id = ? ORDER BY paid_at, id', job.id);
  let acumulado = 0;
  let fechaCompleto = null;
  for (const p of pagos) {
    acumulado = round2(acumulado + p.amount);
    if (fechaCompleto == null && total > 0 && acumulado >= total - 0.005) fechaCompleto = p.paid_at;
    if (fechaCompleto && acumulado < total - 0.005) fechaCompleto = null; // un reembolso posterior lo deshace
  }
  const pagado = round2(acumulado);
  const completo = total > 0 && pagado >= total - 0.005;
  return { pagado, saldo: round2(total - pagado), completo, fechaCobroCompleto: completo ? fechaCompleto : null, primerAbono: pagos[0]?.paid_at ?? null };
}

/** Cliente nuevo o existente: existente si tiene otra orden cobrada al 100% antes. */
export function computeClientStatus(contactId, excludeJobId) {
  if (!contactId) return 'nuevo';
  const otras = all("SELECT * FROM jobs WHERE contact_id = ? AND kind = 'order' AND id != ?", contactId, excludeJobId || 0);
  return otras.some((j) => paymentStatus(j, j.total).completo) ? 'existente' : 'nuevo';
}

/** Ajusta la regla de comisión al tipo de cliente (p. ej. Isabel nuevo/existente). */
export function resolveRule(job) {
  if (!job.commission_rule_id) return null;
  const r = get('SELECT * FROM commission_rules WHERE id = ?', job.commission_rule_id);
  if (!r?.client_type || !job.client_status || r.client_type === job.client_status) return r?.id ?? null;
  const alt = get('SELECT id FROM commission_rules WHERE salesperson_id IS ? AND client_type = ? AND active = 1', r.salesperson_id, job.client_status);
  return alt?.id ?? r.id;
}

// ---------- rentabilidad ----------
/** Calcula todo lo financiero de una orden/cotización y guarda el resumen en jobs.fin. */
export function computeJob(jobOrId, { persist = true } = {}) {
  const job = typeof jobOrId === 'object' ? jobOrId : get('SELECT * FROM jobs WHERE id = ?', jobOrId);
  if (!job) throw fail(404, 'Orden no encontrada');
  const version = pricingVersion(job.pricing_version_id);
  const cfg = version.config;
  const filas = all('SELECT * FROM job_items WHERE job_id = ? ORDER BY position, id', job.id);
  const lineas = filas.map((f) => ({ id: f.id, ...calcularLinea(lineInput(f), cfg) }));

  const reales = {};
  for (const c of all('SELECT category, SUM(amount) AS total FROM job_actual_costs WHERE job_id = ? GROUP BY category', job.id)) reales[c.category] = round2(c.total);
  const creditos = round2(get('SELECT COALESCE(SUM(amount),0) AS t FROM job_credits WHERE job_id = ?', job.id).t);

  const fechaRegla = job.invoice_date || today();
  const ruleId = resolveRule(job);
  const regla = ruleAt(ruleId, fechaRegla);

  const fin = calcularRentabilidad({
    lineas, descuentoGlobal: job.discount, creditos, envioCobrado: job.shipping_charged,
    costoEnvio: job.shipping_cost, costosExtra: job.extra_costs || [], tasaImpuesto: cfg.impuesto.tasa,
    exento: !!job.tax_exempt, reales, regla, margen: cfg.margen,
  });
  const cobro = paymentStatus(job, fin.total);
  const aprob = job.margin_approval || null;
  const nivel = { gerencia: 1, duena: 2 };
  const aprobacion = {
    requerida: fin.aprobacionRequerida,
    otorgada: aprob,
    ok: !fin.aprobacionRequerida || (aprob && nivel[aprob.nivel] >= nivel[fin.aprobacionRequerida]),
  };
  const resumen = {
    ...fin, cobro, aprobacion, pricingVersion: version.id,
    costosConfirmados: !!job.costs_confirmed_at, costosConfirmadosPor: job.costs_confirmed_by, costosConfirmadosEn: job.costs_confirmed_at,
    regla: regla ? { id: regla.id, nombre: regla.nombre, base: regla.base, tasa: regla.tasa, salesperson_id: regla.salesperson_id } : null,
    calculado: new Date().toISOString(),
  };
  if (persist) {
    run('UPDATE jobs SET subtotal = ?, tax = ?, total = ?, tax_rate = ?, fin = ? WHERE id = ?',
      fin.ventaProductos, fin.impuesto, fin.total, fin.tasaImpuesto, JSON.stringify(resumen), job.id);
    for (const l of lineas) {
      run('UPDATE job_items SET qty = ?, unit_price = ?, total = ?, cost_total = ?, calc = ? WHERE id = ?',
        l.qty, l.unitPrice, l.venta, l.costo, JSON.stringify(l), l.id);
    }
  }
  return { job, lineas, fin: resumen };
}

/** Bloquea enviar/convertir si el margen requiere una aprobación que no se ha dado. */
export function assertMarginApproved(jobId) {
  const { fin } = computeJob(jobId);
  if (fin.aprobacion.ok) return;
  const quien = fin.aprobacion.requerida === 'duena' ? 'una excepción de la dueña (contribución negativa)' : 'aprobación de gerencia (contribución menor al mínimo)';
  throw fail(409, `Esta cotización necesita ${quien} antes de continuar.`);
}

export function approveMargin(jobId, user, nota) {
  const { fin } = computeJob(jobId);
  const req = fin.aprobacion.requerida;
  if (!req) throw fail(400, 'Esta orden no necesita aprobación de margen.');
  if (req === 'duena' && user.role !== 'duena') throw fail(403, 'La contribución es negativa: solo la dueña puede autorizar una excepción.');
  if (req === 'gerencia' && !['gerencia', 'duena'].includes(user.role)) throw fail(403, 'Solo gerencia o la dueña pueden aprobar márgenes bajos.');
  if (req === 'duena' && !nota) throw fail(400, 'Escribe el motivo de la excepción.');
  const aprob = { nivel: user.role === 'duena' ? 'duena' : 'gerencia', por: user.name, rol: user.role, fecha: new Date().toISOString(), nota: nota || null, contribucionPct: fin.contribucionPct, contribucion: fin.contribucion };
  run('UPDATE jobs SET margin_approval = ? WHERE id = ?', JSON.stringify(aprob), jobId);
  audit(user, 'aprobacion_margen', `orden ${jobId}`, null, aprob, String(jobId));
  return computeJob(jobId);
}

export function confirmCosts(jobId, user, confirmar = true) {
  const { fin } = computeJob(jobId);
  if (confirmar && fin.faltantes.length) throw fail(400, `No se pueden confirmar los costos: falta ${fin.faltantes.join('; ')}.`);
  if (confirmar) run("UPDATE jobs SET costs_confirmed_at = datetime('now'), costs_confirmed_by = ? WHERE id = ?", user.name, jobId);
  else run('UPDATE jobs SET costs_confirmed_at = NULL, costs_confirmed_by = NULL WHERE id = ?', jobId);
  audit(user, 'costos', `orden ${jobId}`, null, confirmar ? 'confirmados' : 'sin confirmar', String(jobId));
  return computeJob(jobId);
}

// ---------- liquidación de comisiones ----------
const FROZEN = ['revisada', 'aprobada', 'pagada'];
const liqOf = (period, sp) => get('SELECT * FROM liquidations WHERE period = ? AND salesperson_id = ?', period, sp);
const isFrozen = (period, sp) => FROZEN.includes(liqOf(period, sp)?.status);
function firstOpenPeriod(from, sp) {
  let p = from;
  for (let i = 0; i < 36 && isFrozen(p, sp); i++) p = addMonths(p, 1);
  return p;
}

export function fechaPagoPrevista(period) {
  const dia = pricingVersion(null).config.liquidacion.diaPago;
  return `${addMonths(period, 1)}-${String(dia).padStart(2, '0')}`;
}

/** Órdenes de un vendedor (la regla resuelta pertenece al vendedor). */
function ordersOf(spId) {
  return all("SELECT * FROM jobs WHERE kind = 'order' AND salesperson_id = ? ORDER BY id", spId);
}

function entrySnapshot(job, fin, tipo, monto, nota) {
  const contact = job.contact_id ? get('SELECT name, company FROM contacts WHERE id = ?', job.contact_id) : null;
  return {
    tipo, orden: job.order_number || job.number, ordenId: job.id, cliente: contact ? (contact.company || contact.name) : '—',
    fechaFactura: job.invoice_date, fechaCobroCompleto: fin.cobro.fechaCobroCompleto,
    ventaNeta: fin.ventaProductos, costo: fin.costoProducto, ganancia: fin.gananciaProducto,
    base: fin.comision.base, baseTipo: fin.comision.baseTipo, tasa: fin.comision.tasa, regla: fin.comision.regla,
    comision: monto, nota: nota || null,
  };
}

/**
 * Reconstruye la liquidación (borrador) de un vendedor para un mes.
 * - Entra una orden cuando está cobrada al 100% y sus costos están confirmados; su mes es el del cobro completo.
 * - Si su mes ya está cerrado (revisado/aprobado/pagado), entra en el siguiente mes abierto.
 * - Si una orden ya liquidada cambia (devolución, crédito, costo tardío), se crea un ajuste en el siguiente mes abierto.
 * Una liquidación revisada, aprobada o pagada nunca se modifica.
 */
export function syncLiquidation(period, spId) {
  if (isFrozen(period, spId)) return liqOf(period, spId);
  const nuevas = [];
  for (const job of ordersOf(spId)) {
    const { fin } = computeJob(job);
    const previas = all(`SELECT e.*, l.status AS liq_status, l.period AS liq_period FROM commission_entries e JOIN liquidations l ON l.id = e.liquidation_id
                         WHERE e.job_id = ? AND l.salesperson_id = ?`, job.id, spId);
    const cerradas = previas.filter((e) => FROZEN.includes(e.liq_status));
    const lista = fin.cobro.completo && fin.costosConfirmados && fin.comision.estado === 'calculada';
    if (!cerradas.length) {
      if (!lista) continue;
      const destino = firstOpenPeriod(periodOf(fin.cobro.fechaCobroCompleto), spId);
      if (destino === period) nuevas.push({ job, tipo: 'orden', monto: fin.comision.monto, snapshot: entrySnapshot(job, fin, 'orden', fin.comision.monto) });
    } else {
      if (fin.comision.estado !== 'calculada') continue; // si un costo quedó pendiente, se ajusta cuando se resuelva
      const ultimo = cerradas.map((e) => e.liq_period).sort().pop();
      const destino = firstOpenPeriod(addMonths(ultimo, 1), spId);
      if (destino !== period) continue;
      const yaLiquidado = round2(cerradas.reduce((a, e) => a + e.amount, 0));
      const delta = round2(fin.comision.monto - yaLiquidado);
      if (Math.abs(delta) >= 0.01) {
        nuevas.push({ job, tipo: 'ajuste', monto: delta, snapshot: entrySnapshot(job, fin, 'ajuste', delta, `Ajuste: comisión actual ${fin.comision.monto.toFixed(2)} − ya liquidado ${yaLiquidado.toFixed(2)}`) });
      }
    }
  }
  let liq = liqOf(period, spId);
  if (!liq && !nuevas.length) return null;
  if (!liq) liq = get('SELECT * FROM liquidations WHERE id = ?', insert('liquidations', { period, salesperson_id: spId, status: 'borrador' }));
  run('DELETE FROM commission_entries WHERE liquidation_id = ?', liq.id);
  for (const n of nuevas) insert('commission_entries', { liquidation_id: liq.id, job_id: n.job.id, salesperson_id: spId, period, type: n.tipo, amount: n.monto, snapshot: n.snapshot });
  const total = round2(nuevas.reduce((a, n) => a + n.monto, 0));
  run('UPDATE liquidations SET total = ? WHERE id = ?', total, liq.id);
  return liqOf(period, spId);
}

const ESTADO_ENTRADA = { borrador: 'lista', revisada: 'lista', aprobada: 'aprobada', pagada: 'pagada' };

/** Vista completa de la liquidación de un mes y vendedor, con las órdenes que aún no entran. */
export function liquidationView(period, spId) {
  const liq = syncLiquidation(period, spId) || liqOf(period, spId);
  const sp = get('SELECT * FROM salespeople WHERE id = ?', spId);
  const entradas = liq ? all('SELECT * FROM commission_entries WHERE liquidation_id = ? ORDER BY type DESC, id', liq.id).map((e) => ({
    id: e.id, jobId: e.job_id, tipo: e.type, monto: e.amount, estado: ESTADO_ENTRADA[liq.status], ...e.snapshot,
  })) : [];
  // Órdenes del vendedor que todavía no entran a ninguna liquidación
  const liquidadas = new Set(all('SELECT DISTINCT job_id FROM commission_entries WHERE salesperson_id = ?', spId).map((r) => r.job_id));
  const pendientes = [];
  for (const job of ordersOf(spId)) {
    if (liquidadas.has(job.id)) continue;
    const { fin } = computeJob(job);
    let estado = null;
    if (!fin.cobro.completo) estado = 'pendiente de cobro';
    else if (!fin.costosConfirmados || fin.comision.estado !== 'calculada') estado = 'pendiente de costo';
    else continue; // lista para un mes distinto a este
    pendientes.push({ ...entrySnapshot(job, fin, 'orden', fin.comision.monto), jobId: job.id, estado, saldo: fin.cobro.saldo, faltantes: fin.faltantes, motivoComision: fin.comision.motivo });
  }
  return {
    periodo: period, vendedor: sp ? { id: sp.id, name: sp.name } : null,
    liquidacion: liq ? { ...liq, fechaPagoPrevista: fechaPagoPrevista(period) } : { id: null, period, status: 'sin movimientos', total: 0, fechaPagoPrevista: fechaPagoPrevista(period) },
    entradas, pendientes,
    total: liq ? liq.total : 0,
  };
}

export function changeLiquidationStatus(id, accion, user, datos = {}) {
  const liq = get('SELECT * FROM liquidations WHERE id = ?', id);
  if (!liq) throw fail(404, 'Liquidación no encontrada');
  const rol = user.role;
  const paso = {
    revisar: { de: 'borrador', a: 'revisada', roles: ['finanzas', 'duena'] },
    devolver: { de: 'revisada', a: 'borrador', roles: ['finanzas', 'duena'] },
    aprobar: { de: 'revisada', a: 'aprobada', roles: ['duena'] },
    pagar: { de: 'aprobada', a: 'pagada', roles: ['finanzas', 'duena'] },
  }[accion];
  if (!paso) throw fail(400, 'Acción inválida');
  if (!paso.roles.includes(rol)) throw fail(403, `Solo ${paso.roles.map((r) => (r === 'duena' ? 'la dueña' : r)).join(' o ')} puede ${accion} una liquidación.`);
  if (liq.status !== paso.de) throw fail(409, `La liquidación está «${liq.status}»; para ${accion} debe estar «${paso.de}».`);
  if (accion === 'revisar') syncLiquidation(liq.period, liq.salesperson_id); // revisa con datos al día
  const cambios = { status: paso.a };
  if (accion === 'revisar') Object.assign(cambios, { reviewed_by: user.name, reviewed_at: new Date().toISOString() });
  if (accion === 'devolver') Object.assign(cambios, { reviewed_by: null, reviewed_at: null });
  if (accion === 'aprobar') Object.assign(cambios, { approved_by: user.name, approved_at: new Date().toISOString() });
  if (accion === 'pagar') {
    if (!datos.fecha || !datos.referencia) throw fail(400, 'Indica la fecha y la referencia del pago (cheque, transferencia, etc.).');
    Object.assign(cambios, { paid_at: datos.fecha, paid_reference: datos.referencia, paid_by: user.name });
  }
  update('liquidations', id, cambios);
  audit(user, 'liquidacion', `${liq.period} vendedor ${liq.salesperson_id}`, liq.status, paso.a, String(id));
  return get('SELECT * FROM liquidations WHERE id = ?', id);
}

// ---------- reportes ----------
function ordersInRange(desde, hasta) {
  return all("SELECT j.*, c.name AS contact_name, c.company AS contact_company FROM jobs j LEFT JOIN contacts c ON c.id = j.contact_id WHERE j.kind = 'order' AND COALESCE(j.invoice_date, substr(j.created_at,1,10)) BETWEEN ? AND ? ORDER BY j.id",
    desde || '0000-01-01', hasta || '9999-12-31');
}

function acumular(grupo, fin) {
  grupo.ordenes++;
  grupo.ingreso = round2(grupo.ingreso + fin.ingresoSinImpuesto);
  if (fin.incompleta) { grupo.incompletas++; return; }
  grupo.ingresoCompleto = round2(grupo.ingresoCompleto + fin.ingresoSinImpuesto);
  grupo.costo = round2(grupo.costo + fin.costoProducto + (fin.costos.efectivo.envio || 0));
  grupo.gananciaBruta = round2(grupo.gananciaBruta + fin.gananciaBruta);
  grupo.comision = round2(grupo.comision + (fin.comision.monto || 0));
  grupo.contribucion = round2(grupo.contribucion + fin.contribucion);
}
const nuevoGrupo = (clave, nombre) => ({ clave, nombre, ordenes: 0, incompletas: 0, ingreso: 0, ingresoCompleto: 0, costo: 0, gananciaBruta: 0, comision: 0, contribucion: 0 });
const pct = (g) => ({ ...g, contribucionPct: g.ingresoCompleto ? round2((g.contribucion / g.ingresoCompleto) * 100) : null });

export function profitabilityReport({ desde, hasta, agrupar = 'orden' }) {
  const vendedores = Object.fromEntries(all('SELECT * FROM salespeople').map((s) => [s.id, s.name]));
  const grupos = new Map();
  const filas = [];
  for (const job of ordersInRange(desde, hasta)) {
    const { fin } = computeJob(job);
    if (agrupar === 'orden') {
      filas.push({
        id: job.id, orden: job.order_number, cliente: job.contact_company || job.contact_name, fecha: job.invoice_date,
        vendedor: vendedores[job.salesperson_id] || '—', ingreso: fin.ingresoSinImpuesto, costo: fin.costoProducto,
        gananciaBruta: fin.gananciaBruta, comision: fin.comision.monto, contribucion: fin.contribucion, contribucionPct: fin.contribucionPct,
        semaforo: fin.semaforo, incompleta: fin.incompleta, faltantes: fin.faltantes,
      });
      continue;
    }
    if (agrupar === 'proceso') {
      for (const [p, v] of Object.entries(fin.porProceso)) {
        const g = grupos.get(p) || nuevoGrupo(p, p);
        g.ordenes++;
        g.ingreso = round2(g.ingreso + (v.venta || 0));
        if (v.costo == null || v.venta == null) g.incompletas++;
        else { g.ingresoCompleto = round2(g.ingresoCompleto + v.venta); g.costo = round2(g.costo + v.costo); g.gananciaBruta = round2(g.gananciaBruta + v.ganancia); g.contribucion = g.gananciaBruta; }
        grupos.set(p, g);
      }
      continue;
    }
    const clave = agrupar === 'cliente' ? job.contact_id || 0 : job.salesperson_id || 0;
    const nombre = agrupar === 'cliente' ? job.contact_company || job.contact_name || 'Sin cliente' : vendedores[job.salesperson_id] || 'Sin vendedor';
    const g = grupos.get(clave) || nuevoGrupo(clave, nombre);
    acumular(g, fin);
    grupos.set(clave, g);
  }
  return agrupar === 'orden' ? filas : [...grupos.values()].map(pct);
}

export function commissionReport({ desde, hasta }) {
  const out = [];
  for (const sp of all('SELECT * FROM salespeople ORDER BY name')) {
    const r = { vendedor: sp.name, id: sp.id, pendienteCobro: 0, pendienteCosto: 0, listas: 0, aprobadas: 0, pagadas: 0, ajustes: 0 };
    const enRango = (p) => (!desde || p >= periodOf(desde)) && (!hasta || p <= periodOf(hasta));
    for (const e of all('SELECT e.*, l.status FROM commission_entries e JOIN liquidations l ON l.id = e.liquidation_id WHERE e.salesperson_id = ?', sp.id)) {
      if (!enRango(e.period)) continue;
      if (e.type === 'ajuste') r.ajustes = round2(r.ajustes + e.amount);
      const k = e.status === 'pagada' ? 'pagadas' : e.status === 'aprobada' ? 'aprobadas' : 'listas';
      r[k] = round2(r[k] + e.amount);
    }
    const liquidadas = new Set(all('SELECT DISTINCT job_id FROM commission_entries WHERE salesperson_id = ?', sp.id).map((x) => x.job_id));
    for (const job of ordersOf(sp.id)) {
      if (liquidadas.has(job.id)) continue;
      const { fin } = computeJob(job);
      if (!fin.cobro.completo) r.pendienteCobro = round2(r.pendienteCobro + (fin.comision.monto || 0));
      else if (!fin.costosConfirmados || fin.comision.estado !== 'calculada') r.pendienteCosto = round2(r.pendienteCosto + (fin.comision.monto || 0));
    }
    out.push(r);
  }
  return out;
}
