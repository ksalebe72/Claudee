import { useCallback, useEffect, useState } from 'react';

export const money = (n) =>
  (Number(n) || 0).toLocaleString('es-US', { style: 'currency', currency: 'USD' });

export const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d.length <= 10 ? d + 'T12:00:00' : d.replace(' ', 'T') + 'Z');
  return dt.toLocaleDateString('es', { day: 'numeric', month: 'short', year: dt.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
};
/** Fecha estilo americano (MM/DD/AAAA), para los documentos que salen de Color Plus hacia talleres. */
export const fmtDateUS = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[2]}/${m[3]}/${m[1]}` : '—'; };
export const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d.replace(' ', 'T') + 'Z');
  return dt.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
