import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, fmtDateTime, today, useLoad } from '../utils.js';
import { Empty, PageHeader, useMeta, useToast } from '../components/ui.jsx';

const ESTADO = {
  'sin movimientos': { tone: 'gray', label: 'Sin movimientos' },
  borrador: { tone: 'blue', label: 'Borrador · por revisar' },
  revisada: { tone: 'amber', label: 'Revisada por Finanzas · falta aprobación' },
  aprobada: { tone: 'violet', label: 'Aprobada por el dueño · por pagar' },
  pagada: { tone: 'green', label: 'Pagada' },
};
const ESTADO_FILA = { 'pendiente de cobro': 'gray', 'pendiente de costo': 'amber', lista: 'blue', aprobada: 'violet', pagada: 'green' };
const pctTxt = (t) => (t == null ? '—' : `${Math.round(t * 10000) / 100}%`);

export default function Liquidaciones() {
  const meta = useMeta();
  const rol = meta.user.role;
  const [periodo, setPeriodo] = useState(today().slice(0, 7));
  const [data, reload] = useLoad(() => api.get(`/liquidaciones?periodo=${periodo}`), [periodo]);
  const [sel, setSel] = useState(null);
  const [pago, setPago] = useState({ fecha: today(), referencia: '' });
  const [toast, notify] = useToast();
  if (!data) return <div className="loading">Cargando…</div>;
  const v = data.vendedores.find((x) => x.vendedor.id === sel) || data.vendedores[0];

  async function accion(acc, extra = {}) {
    try {
      await api.post(`/liquidaciones/${periodo}/${v.vendedor.id}/accion`, { accion: acc, ...extra });
      notify({ revisar: 'Marcada como revisada', devolver: 'Devuelta a borrador', aprobar: 'Aprobada', pagar: 'Marcada como pagada' }[acc]);
      reload();
    } catch (e) { notify(e.message, true); }
  }
  const L = v?.liquidacion;
  const st = ESTADO[L?.status] || ESTADO['sin movimientos'];

  return (
    <>
      <PageHeader title="Liquidación de comisiones" subtitle="Entran las órdenes cobradas al 100% con costos confirmados, en el mes en que se completó el cobro. El sistema no paga: una persona marca el pago.">
        <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
      </PageHeader>

      <div className="kpis">
        {data.vendedores.map((x) => {
          const s = ESTADO[x.liquidacion.status] || ESTADO['sin movimientos'];
          return (
            <button key={x.vendedor.id} className={`kpi clickable ${v?.vendedor.id === x.vendedor.id ? 'selected' : ''}`} onClick={() => setSel(x.vendedor.id)}>
              <span className="kpi-label">{x.vendedor.name}</span>
              <span className="kpi-value">{money(x.total)}</span>
              <span className={`badge tone-${s.tone}`}>{s.label}</span>
              <span className="kpi-sub">{x.entradas.length} en liquidación · {x.pendientes.length} pendientes</span>
            </button>
          );
        })}
      </div>

      {v && (
        <>
          <section className="card">
            <div className="row between wrap gap">
              <div>
                <h3>{v.vendedor.name} · {periodo}</h3>
                <div className="muted small">Pago previsto: <strong>{fmtDate(L.fechaPagoPrevista)}</strong> · <span className={`badge tone-${st.tone}`}>{st.label}</span></div>
                <div className="muted small">
                  {L.reviewed_by && <>Revisó {L.reviewed_by} ({fmtDateTime(L.reviewed_at?.replace('T', ' ').slice(0, 19))}) · </>}
                  {L.approved_by && <>Aprobó {L.approved_by} ({fmtDateTime(L.approved_at?.replace('T', ' ').slice(0, 19))}) · </>}
                  {L.paid_at && <>Pagada el {fmtDate(L.paid_at)} · ref. {L.paid_reference} · registró {L.paid_by}</>}
                </div>
              </div>
              <div className="row gap wrap">
                {L.id && <a className="btn" href={`/api/liquidaciones/${periodo}/${v.vendedor.id}/exportar.pdf`}>⬇ PDF</a>}
                {L.id && <a className="btn" href={`/api/liquidaciones/${periodo}/${v.vendedor.id}/exportar.xlsx`}>⬇ Excel</a>}
                {L.status === 'borrador' && ['finanzas', 'duena'].includes(rol) && <button className="btn primary" onClick={() => accion('revisar')}>1 · Marcar revisada (Finanzas)</button>}
                {L.status === 'revisada' && ['finanzas', 'duena'].includes(rol) && <button className="btn" onClick={() => accion('devolver')}>Devolver a borrador</button>}
                {L.status === 'revisada' && rol === 'duena' && <button className="btn primary" onClick={() => accion('aprobar')}>2 · Aprobar (dueño)</button>}
                {L.status === 'revisada' && rol !== 'duena' && <span className="muted small">Espera la aprobación del dueño</span>}
              </div>
            </div>
            {L.status === 'aprobada' && ['finanzas', 'duena'].includes(rol) && (
              <div className="approval">
                <p><strong>3 · Registrar el pago</strong> (el pago se hace fuera del sistema: cheque, transferencia o nómina).</p>
                <div className="row gap wrap">
                  <input type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} />
                  <input placeholder="Referencia (cheque, transferencia…)" value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
                  <button className="btn primary" disabled={!pago.referencia} onClick={() => accion('pagar', pago)}>Marcar como pagada</button>
                </div>
              </div>
            )}
          </section>

          <section className="card no-pad">
            <table className="table">
              <thead>
                <tr><th>Orden</th><th>Cliente</th><th>Fecha factura</th><th>Cobro completo</th><th className="num">Venta neta</th><th className="num">Costo</th><th className="num">Ganancia</th><th className="num">Base comisionable</th><th className="num">Tasa</th><th className="num">Comisión</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {v.entradas.map((e) => (
                  <tr key={e.id} className={e.tipo === 'ajuste' ? 'adjust-row' : ''}>
                    <td><Link to={`/trabajos/${e.jobId}`}>{e.orden}</Link>{e.tipo === 'ajuste' && <div className="small">Ajuste{e.nota ? `: ${e.nota}` : ''}</div>}</td>
                    <td>{e.cliente}</td>
                    <td>{fmtDate(e.fechaFactura)}</td>
                    <td>{fmtDate(e.fechaCobroCompleto)}</td>
                    <td className="num">{money(e.ventaNeta)}</td>
                    <td className="num">{money(e.costo)}</td>
                    <td className="num">{money(e.ganancia)}</td>
                    <td className="num">{money(e.base)}</td>
                    <td className="num">{pctTxt(e.tasa)}</td>
                    <td className={`num ${e.monto < 0 ? 'danger' : ''}`}><strong>{money(e.monto)}</strong></td>
                    <td><span className={`badge tone-${ESTADO_FILA[e.estado]}`}>{e.estado}</span></td>
                  </tr>
                ))}
                {v.entradas.length > 0 && <tr className="total-row"><td colSpan={9}>Total a pagar</td><td className="num"><strong>{money(v.total)}</strong></td><td /></tr>}
              </tbody>
            </table>
            {!v.entradas.length && <Empty>No hay comisiones listas para este mes.</Empty>}
          </section>

          {v.pendientes.length > 0 && (
            <section className="card no-pad">
              <h3 className="pad">Órdenes que todavía no entran</h3>
              <table className="table">
                <thead><tr><th>Orden</th><th>Cliente</th><th>Fecha factura</th><th className="num">Venta neta</th><th className="num">Comisión estimada</th><th className="num">Saldo</th><th>Estado</th><th>Qué falta</th></tr></thead>
                <tbody>
                  {v.pendientes.map((p) => (
                    <tr key={p.jobId}>
                      <td><Link to={`/trabajos/${p.jobId}`}>{p.orden}</Link></td>
                      <td>{p.cliente}</td>
                      <td>{fmtDate(p.fechaFactura)}</td>
                      <td className="num">{money(p.ventaNeta)}</td>
                      <td className="num">{p.comision == null ? <span className="warn-txt">pendiente</span> : money(p.comision)}</td>
                      <td className="num">{money(p.saldo)}</td>
                      <td><span className={`badge tone-${ESTADO_FILA[p.estado]}`}>{p.estado}</span></td>
                      <td className="small">{p.estado === 'pendiente de cobro' ? 'Cobro al 100%' : [...(p.faltantes || []), p.motivoComision].filter(Boolean).join('; ') || 'Confirmar costos'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      {toast}
    </>
  );
}
