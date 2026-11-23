// Última compra de cada cliente (órdenes de la app + historial de DecoNetwork) y cuántos días lleva sin comprar.
// Una sola fuente para el tablero (alerta «Clientes sin comprar») y para el asistente.
import { all, getSetting } from './db.js';
import { filtroContactos, esLogistica } from './scope.js';

/** Fecha de hoy en Maryland (YYYY-MM-DD). */
export const hoyNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

/** Días sin comprar para considerar a un cliente inactivo (Ajustes → General). */
export const DIAS_INACTIVO = { porDefecto: 90, min: 15, max: 730 };
export function validarDiasInactivo(v) {
  const n = Math.round(Number(v));
  if (v === '' || v == null || !Number.isFinite(n) || n < DIAS_INACTIVO.min || n > DIAS_INACTIVO.max) {
    throw Object.assign(new Error(`Los días sin comprar deben estar entre ${DIAS_INACTIVO.min} y ${DIAS_INACTIVO.max}.`), { status: 400 });
  }
  return n;
}
export function diasInactivo() {
  try { return validarDiasInactivo(getSetting('dias_cliente_inactivo', DIAS_INACTIVO.porDefecto)); } catch { return DIAS_INACTIVO.porDefecto; }
}

/**
 * Todos los clientes visibles para el usuario con su última compra. Logística no recibe montos.
 * Fila: { id, cliente, contacto, telefono, vendedor, ultimaCompra, dias, compras, ventas, cotizacionesAbiertas }
 */
export function recenciaClientes(user, hoy = hoyNY()) {
  const fc = filtroContactos(user, 'c');
  const filas = all(`SELECT c.id, c.name, c.company, c.phone, s.name AS vendedor,
      d.ult AS ult_deco, COALESCE(d.n,0) AS n_deco, COALESCE(d.v,0) AS v_deco,
      a.ult AS ult_app, COALESCE(a.n,0) AS n_app, COALESCE(a.v,0) AS v_app, COALESCE(q.n,0) AS cotizaciones
    FROM contacts c
    LEFT JOIN salespeople s ON s.id = c.salesperson_id
    LEFT JOIN (SELECT contact_id, MAX(substr(fecha,1,10)) AS ult, COUNT(*) AS n, SUM(ventas) AS v FROM historial_ordenes GROUP BY contact_id) d ON d.contact_id = c.id
    LEFT JOIN (SELECT contact_id, MAX(COALESCE(invoice_date, substr(created_at,1,10))) AS ult, COUNT(*) AS n, SUM(subtotal) AS v FROM jobs WHERE kind = 'order' GROUP BY contact_id) a ON a.contact_id = c.id
    LEFT JOIN (SELECT contact_id, COUNT(*) AS n FROM jobs WHERE kind = 'quote' AND status IN ('borrador','enviada') GROUP BY contact_id) q ON q.contact_id = c.id
    WHERE ${fc.sql}`, ...fc.params);
  const sinMontos = esLogistica(user);
  return filas.map((c) => {
    const ultimaCompra = [c.ult_deco, c.ult_app].filter(Boolean).sort().pop() || null;
    const fila = {
      id: c.id, cliente: c.company || c.name, contacto: c.company ? c.name : null, telefono: c.phone || null, vendedor: c.vendedor || null,
      ultimaCompra, dias: ultimaCompra ? diasEntre(ultimaCompra, hoy) : null, compras: c.n_deco + c.n_app,
      ventas: Math.round((c.v_deco + c.v_app) * 100) / 100, cotizacionesAbiertas: c.cotizaciones,
    };
    if (sinMontos) delete fila.ventas;
    return fila;
  });
}

/** Clientes que ya compraron y llevan más de N días sin comprar; primero los que más compraban. */
export function clientesInactivos(user, dias = diasInactivo()) {
  return recenciaClientes(user)
    .filter((c) => c.ultimaCompra && c.dias > dias)
    .sort((a, b) => (b.ventas ?? 0) - (a.ventas ?? 0) || b.dias - a.dias);
}
