// Qué puede ver cada usuario.
// · Ventas: solo SUS clientes (contacts.salesperson_id = su vendedor) y lo que cuelga de ellos (órdenes, oportunidades, tareas, pagos, proofs).
//   Una orden también es suya si él es el vendedor de la orden.
// · Logística: órdenes y producción, sin costos ni rentabilidad; no cotiza ni cambia precios.
// · Dueño, Finanzas, Gerencia y Coordinación de ventas: todo.
// Se revisa en el servidor: lo que no le corresponde responde «no encontrado».
import { get } from './db.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });

export const soloPropios = (user) => user?.role === 'ventas';
export const esLogistica = (user) => user?.role === 'logistica';
const mio = (user) => user?.salesperson_id ?? -1;

/** Condición SQL para contactos visibles (alias de la tabla contacts). */
export function filtroContactos(user, alias = 'c') {
  if (!soloPropios(user)) return { sql: '1=1', params: [] };
  return { sql: `${alias}.salesperson_id = ?`, params: [mio(user)] };
}
/** Condición SQL para órdenes visibles (alias de jobs). */
export function filtroJobs(user, alias = 'j') {
  if (!soloPropios(user)) return { sql: '1=1', params: [] };
  return {
    sql: `(${alias}.salesperson_id = ? OR ${alias}.contact_id IN (SELECT id FROM contacts WHERE salesperson_id = ?))`,
    params: [mio(user), mio(user)],
  };
}

export function contactoPermitido(user, contactId) {
  if (!soloPropios(user) || !contactId) return true;
  return !!get('SELECT id FROM contacts WHERE id = ? AND salesperson_id = ?', contactId, mio(user));
}
export function jobPermitido(user, jobId) {
  if (!soloPropios(user)) return true;
  const f = filtroJobs(user);
  return !!get(`SELECT j.id FROM jobs j WHERE j.id = ? AND ${f.sql}`, jobId, ...f.params);
}
export function assertContacto(user, contactId) {
  if (!contactoPermitido(user, contactId)) throw fail(404, 'Contacto no encontrado');
}
export function assertJob(user, jobId) {
  if (!jobPermitido(user, jobId)) throw fail(404, 'No encontrado');
}

// Rutas con id → a qué orden o contacto pertenecen
const POR_JOB = [
  [/^\/jobs\/(\d+)/, (id) => id],
  [/^\/proofs\/(\d+)/, (id) => get('SELECT job_id FROM proofs WHERE id = ?', id)?.job_id],
  [/^\/payments\/(\d+)/, (id) => get('SELECT job_id FROM payments WHERE id = ?', id)?.job_id],
  [/^\/costos-reales\/(\d+)/, (id) => get('SELECT job_id FROM job_actual_costs WHERE id = ?', id)?.job_id],
  [/^\/creditos\/(\d+)/, (id) => get('SELECT job_id FROM job_credits WHERE id = ?', id)?.job_id],
];
const POR_CONTACTO = [
  [/^\/contacts\/(\d+)/, (id) => id],
  [/^\/opportunities\/(\d+)/, (id) => get('SELECT contact_id FROM opportunities WHERE id = ?', id)?.contact_id],
];

// Lo que Logística puede hacer (todo lo demás: 403)
const LOGISTICA = [
  ['GET', /^\/(meta|dashboard|jobs|contacts|tasks|products|methods|tarifas|vendedores|comisiones\/reglas|ia\/estado)(\/|$|\?)/],
  ['GET', /^\/proofs\/\d+\/design$/],
  ['GET', /^\/sanmar\//],
  ['POST', /^\/jobs\/\d+\/status$/],
  ['POST', /^\/tasks$/], ['PUT', /^\/tasks\/\d+$/],
  ['POST', /^\/contacts\/\d+\/activities$/],
];

/** Middleware: se monta después de requireAuth y antes de todas las rutas de datos. */
export function scopeMiddleware(req, res, next) {
  try {
    const user = req.user;
    if (esLogistica(user)) {
      if (req.path.startsWith('/jobs/') && /\/finanzas$/.test(req.path)) throw fail(403, 'Logística no ve costos ni rentabilidad.');
      if (!LOGISTICA.some(([m, re]) => m === req.method && re.test(req.path))) throw fail(403, 'Esta acción no está disponible para Logística.');
    }
    if (soloPropios(user)) {
      for (const [re, jobDe] of POR_JOB) {
        const m = re.exec(req.path);
        if (m) { const jobId = jobDe(Number(m[1])); if (!jobId || !jobPermitido(user, jobId)) throw fail(404, 'No encontrado'); }
      }
      for (const [re, contactoDe] of POR_CONTACTO) {
        const m = re.exec(req.path);
        if (m) { const cid = contactoDe(Number(m[1])); if (!cid || !contactoPermitido(user, cid)) throw fail(404, 'No encontrado'); }
      }
      if (/^\/tasks\/(\d+)/.test(req.path)) {
        const t = get('SELECT * FROM tasks WHERE id = ?', Number(/^\/tasks\/(\d+)/.exec(req.path)[1]));
        if (!t || !tareaPermitida(user, t)) throw fail(404, 'No encontrado');
      }
      // Referencias en el cuerpo (crear oportunidad, tarea u orden para un cliente ajeno)
      const b = req.body || {};
      if (req.method !== 'GET') {
        if (b.contact_id && !contactoPermitido(user, b.contact_id)) throw fail(404, 'Contacto no encontrado');
        if (b.job_id && !jobPermitido(user, b.job_id)) throw fail(404, 'No encontrado');
        if (b.jobId && !jobPermitido(user, b.jobId)) throw fail(404, 'No encontrado');
      }
    }
    next();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

export function tareaPermitida(user, t) {
  if (!soloPropios(user)) return true;
  if (t.contact_id) return contactoPermitido(user, t.contact_id);
  if (t.job_id) return jobPermitido(user, t.job_id);
  return t.assignee === user.name;
}

/** Para Logística: quita de una orden todo lo de costos, márgenes y comisiones. */
export function sinFinanzas(job) {
  if (!job) return job;
  const { finanzas: _f, fin: _fi, margin_approval: _m, commission_rule_id: _c, ...resto } = job;
  return {
    ...resto,
    items: (job.items || []).map(({ unit_cost: _u, size_costs: _s, cost_total: _ct, override: _o, calc, ...it }) => ({
      ...it,
      calc: calc && { qty: calc.qty, unitPrice: calc.unitPrice, venta: calc.venta, prenda: calc.prenda && { tallas: (calc.prenda.tallas || []).map((t) => ({ talla: t.talla, cant: t.cant, precio: t.precio })) }, decoraciones: (calc.decoraciones || []).map((d) => ({ process: d.process, location: d.location, precioPieza: d.precioPieza, detalle: d.detalle })) },
    })),
  };
}
