import { useCallback, useEffect, useState } from 'react';

export const money = (n) =>
  (Number(n) || 0).toLocaleString('es-US', { style: 'currency', currency: 'USD' });

/** Fechas estilo americano en toda la app: MM/DD/AAAA. */
export const fmtDate = (d) => {
  if (!d) return '—';
  const s = String(d);
  // Fecha sola (AAAA-MM-DD): se muestra tal cual, sin pasar por zonas horarias
  if (s.length <= 10) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[2]}/${m[3]}/${m[1]}` : s; }
  // Fecha con hora (la base la guarda en UTC): día local
  return new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
};
export const fmtDateUS = fmtDate;
/** Mes estilo americano: 2026-11 → 11/2026 */
export const fmtMes = (m) => { const x = /^(\d{4})-(\d{2})$/.exec(String(m || '')); return x ? `${x[2]}/${x[1]}` : m || '—'; };
export const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T') + 'Z');
  return dt.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const today = () => new Date().toISOString().slice(0, 10);

export const LABELS = {
  // oportunidades
  nuevo: 'Nuevo lead', contactado: 'Contactado', cotizado: 'Cotizado', negociacion: 'Negociación', ganado: 'Ganado', perdido: 'Perdido',
  // cotizaciones
  borrador: 'Borrador', enviada: 'Enviada', aprobada: 'Aprobada', rechazada: 'Rechazada',
  // órdenes
  arte: 'Arte', aprobacion: 'Esperando aprobación', compras: 'Pedido de blanks', produccion: 'En producción', calidad: 'Control de calidad', listo: 'Listo para entrega', entregado: 'Entregado',
  // pruebas
  pendiente: 'Pendiente',
};
export const label = (s) => LABELS[s] || s;

export const STATUS_TONE = {
  nuevo: 'blue', contactado: 'indigo', cotizado: 'violet', negociacion: 'amber', ganado: 'green', perdido: 'gray',
  borrador: 'gray', enviada: 'blue', aprobada: 'green', rechazada: 'red', pendiente: 'amber',
  arte: 'violet', aprobacion: 'amber', compras: 'blue', produccion: 'indigo', calidad: 'teal', listo: 'green', entregado: 'gray',
};

/** Carga datos y expone reload. */
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    return fn().then((d) => { setData(d); setError(null); return d; }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, setData, error];
}
