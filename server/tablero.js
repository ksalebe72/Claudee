// Datos del tablero de operación: indicadores del periodo, serie mensual, lo que requiere atención y búsqueda global.
// Todo respeta los permisos de cada rol (scope.js): un vendedor solo cuenta lo suyo y Logística no ve montos.
import express from 'express';
import { all, get } from './db.js';
import { currentPricing } from './config.js';
import { filtroJobs, filtroContactos, soloPropios, esLogistica, tareaPermitida } from './scope.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const wrap = (fn) => (req, res) => { try { res.json(fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const VEN_FINANZAS = ['duena', 'finanzas', 'gerencia'];

/** Fecha local de Maryland (YYYY-MM-DD). */
const hoyMD = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Lista de meses YYYY-MM, del más viejo al actual. */
export function mesesHacia(n, hoy = hoyMD()) {
  const [y, m] = hoy.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Lo que requiere atención, según el rol. Cada aviso: { clave, titulo, detalle, n, to }. */
export function avisos(user) {
  const fj = filtroJobs(user, 'j');
  const hoy = hoyMD();
  const rol = user.role;
  const lista = [];
  const add = (clave, titulo, detalle, n, to) => lista.push({ clave, titulo, detalle, n, to });

  const trabajos = all(`SELECT j.id, j.kind, j.status, j.due_date, j.fin, j.total, j.costs_confirmed_at,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.job_id = j.id),0) AS pagado
    FROM jobs j WHERE ${fj.sql}`, ...fj.params);

  if (['duena', 'gerencia'].includes(rol)) {
    const n = trabajos.filter((j) => j.fin?.aprobacion?.requerida && !j.fin.aprobacion.ok && !['rechazada', 'entregado'].includes(j.status)).length;
    add('margenes', 'Márgenes por aprobar', 'Bajo el 30% o con contribución negativa', n, '/cotizaciones');
  }
  const atrasadas = trabajos.filter((j) => j.kind === 'order' && j.status !== 'entregado' && j.due_date && j.due_date < hoy).length;
  add('atrasadas', 'Órdenes atrasadas', 'Pasó la fecha de entrega', atrasadas, '/produccion');

  const tareas = all('SELECT * FROM tasks WHERE done = 0 AND due_date IS NOT NULL AND due_date < ?', hoy).filter((t) => tareaPermitida(user, t));
  add('seguimientos', 'Seguimientos vencidos', 'Tareas con fecha pasada', tareas.length, '/tareas');

  if (!esLogistica(user)) {
    const pruebas = all(`SELECT pr.status FROM proofs pr JOIN jobs j ON j.id = pr.job_id
      WHERE pr.version = (SELECT MAX(version) FROM proofs x WHERE x.job_id = pr.job_id) AND ${fj.sql}`, ...fj.params);
    add('pruebas', 'Pruebas de arte sin respuesta', 'El cliente aún no aprueba', pruebas.filter((p) => p.status === 'pendiente').length, '/ordenes');
    add('cambios', 'Pruebas con cambios pedidos', 'El cliente pidió ajustes', pruebas.filter((p) => p.status === 'rechazada').length, '/ordenes');

    const porCobrar = trabajos.filter((j) => j.kind === 'order' && j.status === 'entregado' && r2(j.total - j.pagado) > 0).length;
    add('cobros', 'Entregadas con saldo', 'Órdenes entregadas sin cobrar completas', porCobrar, '/cobranza');
  }
  if (['duena', 'finanzas'].includes(rol)) {
    const sinConfirmar = trabajos.filter((j) => j.kind === 'order' && j.status === 'entregado' && !j.costs_confirmed_at).length;
    add('costos', 'Costos por confirmar', 'Entregadas sin costos reales confirmados', sinConfirmar, '/ordenes');
  }
  if (rol === 'duena') {
    const n = get("SELECT COUNT(*) AS c FROM liquidations WHERE status = 'revisada'")?.c || 0;
    add('liquidaciones', 'Liquidaciones por aprobar', 'Revisadas por Finanzas', n, '/liquidaciones');
  }
  if (rol === 'finanzas') {
    const n = get("SELECT COUNT(*) AS c FROM liquidations WHERE status = 'aprobada'")?.c || 0;
    add('pagar', 'Comisiones por pagar', 'Aprobadas por el dueño', n, '/liquidaciones');
  }
  return lista;
}

/** Indicadores y serie mensual del periodo. */
export function tablero(user, meses = 6) {
  const n = [1, 3, 6, 12].includes(Number(meses)) ? Number(meses) : 6;
  const lista = mesesHacia(n);
  const desde = `${lista[0]}-01`;
  const fj = filtroJobs(user, 'j');
  const sinMontos = esLogistica(user);
  const verFinanzas = VEN_FINANZAS.includes(user.role);

  const filas = all(`SELECT j.id, j.kind, j.status, substr(j.created_at,1,7) AS mes, j.fin FROM jobs j
    WHERE substr(j.created_at,1,10) >= ? AND ${fj.sql}`, desde, ...fj.params);
  const valida = (j) => j.kind === 'order' || !['rechazada'].includes(j.status);
  const completa = (j) => j.fin && j.fin.contribucion != null && j.fin.semaforo !== 'incompleta';

  function serie(kind) {
    return lista.map((mes) => {
      const js = filas.filter((j) => j.kind === kind && j.mes === mes && valida(j));
      const comp = js.filter(completa);
      const ventas = r2(js.reduce((a, j) => a + (j.fin?.ingresoSinImpuesto || 0), 0));
      const ventasComp = comp.reduce((a, j) => a + (j.fin.ingresoSinImpuesto || 0), 0);
      const utilidad = r2(comp.reduce((a, j) => a + (j.fin.gananciaBruta || 0), 0));
      return { mes, n: js.length, ventas, utilidad: verFinanzas ? utilidad : null, margenPct: verFinanzas && ventasComp ? r2((utilidad / ventasComp) * 100) : null, incompletas: js.length - comp.length };
    });
  }

  const ordenes = filas.filter((j) => j.kind === 'order');
  const comp = ordenes.filter(completa);
  const ingresosComp = comp.reduce((a, j) => a + (j.fin.ingresoSinImpuesto || 0), 0);
  const contribucion = r2(comp.reduce((a, j) => a + (j.fin.contribucion || 0), 0));
  const cobros = get(`SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p JOIN jobs j ON j.id = p.job_id
    WHERE substr(p.paid_at,1,10) >= ? AND ${fj.sql}`, desde, ...fj.params).v;

  const kpis = sinMontos ? null : {
    ventas: r2(ordenes.reduce((a, j) => a + (j.fin?.ingresoSinImpuesto || 0), 0)),
    ordenes: ordenes.length,
    cotizacionesAbiertas: filas.filter((j) => j.kind === 'quote' && ['borrador', 'enviada'].includes(j.status)).length,
    cobros: r2(cobros),
    utilidad: verFinanzas ? r2(comp.reduce((a, j) => a + (j.fin.gananciaBruta || 0), 0)) : null,
    contribucion: verFinanzas ? contribucion : null,
    contribucionPct: verFinanzas && ingresosComp ? r2((contribucion / ingresosComp) * 100) : null,
    // El vendedor ve su propia comisión; el dueño, Finanzas y Gerencia ven el total
    comisiones: verFinanzas || soloPropios(user) ? r2(comp.reduce((a, j) => a + (j.fin.comision?.monto || 0), 0)) : null,
    incompletas: ordenes.length - comp.length,
  };
  return {
    meses: n, desde, kpis, margen: currentPricing().config.margen,
    serie: sinMontos ? null : { ordenes: serie('order'), cotizaciones: serie('quote') },
    avisos: avisos(user),
  };
}

/** Búsqueda global: clientes, cotizaciones y órdenes visibles para el usuario. */
export function buscar(user, q) {
  const t = String(q || '').trim();
  if (t.length < 2) return { contactos: [], trabajos: [] };
  const like = `%${t}%`;
  const fc = filtroContactos(user, 'c');
  const fj = filtroJobs(user, 'j');
  const contactos = all(`SELECT c.id, c.name, c.company, c.email FROM contacts c
    WHERE (c.name LIKE ? OR c.company LIKE ? OR c.email LIKE ? OR c.phone LIKE ?) AND ${fc.sql} ORDER BY c.name LIMIT 6`, like, like, like, like, ...fc.params);
  const trabajos = all(`SELECT j.id, j.kind, j.number, j.order_number, j.title, j.status, c.name AS contact_name FROM jobs j
    LEFT JOIN contacts c ON c.id = j.contact_id
    WHERE (j.number LIKE ? OR j.order_number LIKE ? OR j.title LIKE ? OR c.name LIKE ? OR c.company LIKE ?) AND ${fj.sql}
    ORDER BY j.id DESC LIMIT 8`, like, like, like, like, like, ...fj.params);
  return { contactos: esLogistica(user) ? contactos.map(({ email: _e, ...c }) => c) : contactos, trabajos };
}

export const tableroApi = express.Router();
tableroApi.get('/tablero', wrap((req) => tablero(req.user, req.query.meses)));
tableroApi.get('/avisos', wrap((req) => avisos(req.user)));
tableroApi.get('/buscar', wrap((req) => {
  if (String(req.query.q || '').length > 100) throw fail(400, 'Búsqueda demasiado larga');
  return buscar(req.user, req.query.q);
}));
