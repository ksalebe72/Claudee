// Tablero de operación: ventas, rentabilidad, lo que requiere atención y producción.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, fmtDateTime, label, useLoad } from '../utils.js';
import { Empty, useMeta } from '../components/ui.jsx';
import { BarrasMensuales, TablaMensual, DonaContribucion } from '../components/Graficas.jsx';
import DonPixel, { saludoDonPixel, useNombreAsistente } from '../components/DonPixel.jsx';

const PERIODOS = { 1: 'Este mes', 3: 'Últimos 3 meses', 6: 'Últimos 6 meses', 12: 'Últimos 12 meses' };
const GESTION = ['duena', 'finanzas', 'gerencia', 'coordinacion'];

const I = {
  dolar: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5M12 6.5v11" /></svg>,
  caja: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></svg>,
  tendencia: <svg viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>,
  meta: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>,
  paquete: <svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>,
  doc: <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>,
  lista: <svg viewBox="0 0 24 24"><path d="m3 6 2 2 3-3M3 13l2 2 3-3M11 7h10M11 14h10M11 20h10" /></svg>,
  reloj: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  arte: <svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" /></svg>,
  chispa: <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>,
  robot: <svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" /></svg>,
  enviar: <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></svg>,
};
const ICONO_AVISO = { margenes: I.doc, atrasadas: I.reloj, seguimientos: I.lista, pruebas: I.arte, cambios: I.arte, cobros: I.caja, costos: I.doc, liquidaciones: I.meta, pagar: I.dolar };

export default function Dashboard() {
  const meta = useMeta();
  const user = meta.user;
  const asistente = useNombreAsistente();
  const [meses, setMeses] = useState(() => { try { return Number(localStorage.getItem('tablero-meses')) || 6; } catch { return 6; } });
  const [vista, setVista] = useState('ordenes');
  const [tabla, setTabla] = useState(false);
  const [t] = useLoad(() => api.get(`/tablero?meses=${meses}`), [meses]);
  const [d] = useLoad(() => api.get('/dashboard'));
  if (!t || !d) return <div className="loading">Cargando…</div>;

  const k = t.kpis;
  const nombre = String(user.name || '').split(' ')[0];
  const cambiarPeriodo = (v) => { setMeses(v); try { localStorage.setItem('tablero-meses', String(v)); } catch { /* sin almacenamiento */ } };
  const ordersBy = Object.fromEntries(d.orders.map((o) => [o.status, o.count]));
  const maxOrders = Math.max(1, ...meta.orderStatuses.map((s) => ordersBy[s] || 0));
  const avisosActivos = t.avisos.reduce((a, x) => a + x.n, 0);
  const serie = t.serie?.[vista] || [];
  const conUtilidad = serie.some((s) => s.utilidad != null);

  return (
    <div className="tablero">
      <div className="tablero-head">
        <div>
          <div className="ceja">ColorPlus OS · Tablero de operación</div>
          <h1 className="titulo-grande">Bienvenido, {nombre}</h1>
          <p className="muted">Operaciones, ventas y rentabilidad en un solo lugar.</p>
        </div>
        <div className="row gap">
          <select className="selector-periodo" value={meses} onChange={(e) => cambiarPeriodo(Number(e.target.value))} aria-label="Periodo">
            {Object.entries(PERIODOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {user.role !== 'logistica' && <Link className="btn btn-azul" to="/trabajos/nuevo">+ Nueva cotización</Link>}
        </div>
      </div>

      {k && (
        <div className="aviso-base">
          <strong>Base:</strong> órdenes creadas en el periodo · importes sin impuesto
          {k.incompletas > 0 && <> · Las órdenes con costos incompletos se excluyen de márgenes: <strong>{k.incompletas} omitida(s)</strong>.</>}
          {user.role === 'ventas' && <> · Solo tus clientes.</>}
        </div>
      )}

      {k && (
        <div className="kpis-color">
          <Kpi tono="azul" icono={I.dolar} titulo="Ventas (sin impuesto)" valor={money(k.ventas)} sub={`${k.ordenes} orden(es) · ${k.cotizacionesAbiertas} cotización(es) abiertas`} to="/ordenes" />
          <Kpi tono="verde" icono={I.caja} titulo="Cobros" valor={money(k.cobros)} sub="Pagos recibidos en el periodo" to="/cobranza" />
          {k.utilidad != null && <Kpi tono="celeste" icono={I.tendencia} titulo="Utilidad bruta" valor={money(k.utilidad)} sub="Solo órdenes con costos completos" to="/reportes" />}
          {k.contribucion != null && <Kpi tono="lila" icono={I.meta} titulo="Contribución" valor={money(k.contribucion)} sub={k.contribucionPct == null ? 'Sin datos completos' : `${k.contribucionPct}% de los ingresos`} to="/reportes" />}
          {k.comisiones != null && <Kpi tono="durazno" icono={I.paquete} titulo={user.role === 'ventas' ? 'Mi comisión' : 'Comisiones'} valor={money(k.comisiones)} sub="Calculadas, aún no son saldos por pagar" to={GESTION.includes(user.role) ? '/liquidaciones' : '/ordenes'} />}
        </div>
      )}

      <div className={`tablero-grid ${t.serie ? '' : 'sin-grafica'}`}>
        {t.serie && (
          <section className="card tarjeta-graf">
            <div className="card-head">
              <div>
                <h3 className="titulo-seccion">Ventas{conUtilidad ? ' y rentabilidad' : ''} <span className="muted">(por mes)</span></h3>
                <p className="muted small">{conUtilidad ? 'La utilidad y el margen usan solo trabajos con costos completos.' : 'Importes sin impuesto.'}</p>
              </div>
              <div className="seg small">
                <button className={vista === 'cotizaciones' ? 'on' : ''} onClick={() => setVista('cotizaciones')}>Cotizaciones</button>
                <button className={vista === 'ordenes' ? 'on' : ''} onClick={() => setVista('ordenes')}>Órdenes</button>
              </div>
            </div>
            <div className="graf-cuerpo">
              <div className="graf-barras">
                {tabla ? <TablaMensual datos={serie} conUtilidad={conUtilidad} /> : <BarrasMensuales datos={serie} conUtilidad={conUtilidad} />}
                <button className="link-btn small" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfica' : 'Ver como tabla'}</button>
              </div>
              {k?.contribucion != null && (
                <div className="graf-dona">
                  <div className="dona-titulo">Contribución<br /><span className="muted">sobre ventas</span></div>
                  <DonaContribucion pct={k.contribucionPct} margen={t.margen} />
                </div>
              )}
            </div>
          </section>
        )}

        <section className="card tarjeta-atencion">
          <div className="card-head">
            <div><h3 className="titulo-seccion">Requieren atención</h3><p className="muted small">Lo que hay que mover hoy</p></div>
            {avisosActivos > 0 && <span className="contador grande">{avisosActivos}</span>}
          </div>
          <ul className="atencion">
            {t.avisos.filter((a) => a.n > 0).map((a) => (
              <li key={a.clave}>
                <Link to={a.to} className="fila-atencion">
                  <span className="atencion-icono activo">{ICONO_AVISO[a.clave] || I.doc}</span>
                  <span className="grow"><strong>{a.titulo}</strong><small className="muted">{a.detalle}</small></span>
                  <span className="atencion-n">{a.n} ›</span>
                </Link>
              </li>
            ))}
          </ul>
          {t.avisos.some((a) => !a.n) && (
            <div className="al-dia-resumen"><span className="check">✓</span><span><strong>Al día:</strong> {t.avisos.filter((a) => !a.n).map((a) => a.titulo.toLowerCase()).join(' · ')}</span></div>
          )}
        </section>

        <div className="stack">
          {(
            <section className="card tarjeta-asistente">
              <div className="row gap"><span className="asistente-avatar"><DonPixel size={44} /></span><div><h3 className="titulo-seccion">{asistente}</h3><p className="muted small">El mejor del oficio · barranquillero</p></div></div>
              <div className="asistente-burbuja">{saludoDonPixel(nombre)} Pregúntame por tus órdenes y clientes, o lo que quieras del oficio: DTF, bordado, serigrafía, telas, archivos… También te ayudo con los emails y te tiro ideas de venta, pa' que veas.</div>
              <Link className="btn btn-morado" to="/asistente"><span className="btn-ico">{I.enviar}</span> Échale, habla con {asistente}</Link>
            </section>
          )}
          <section className="card">
            <div className="card-head"><h3 className="titulo-seccion">Entregas próximas</h3><Link to="/produccion">Producción →</Link></div>
            {d.overdue.length === 0 && d.dueSoon.length === 0 && <Empty>No hay órdenes con fecha de entrega.</Empty>}
            <ul className="list compacta">
              {[...d.overdue.map((o) => ({ ...o, late: true })), ...d.dueSoon].slice(0, 6).map((o) => (
                <li key={o.id}>
                  <Link to={`/trabajos/${o.id}`}><strong>{o.order_number}</strong> {o.title}</Link>
                  <span className={o.late ? 'danger small' : 'muted small'}>{o.late ? 'Atrasada · ' : ''}{fmtDate(o.due_date)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h3 className="titulo-seccion">Producción por etapa</h3><Link to="/produccion">Ver tablero →</Link></div>
          <div className="bars">
            {meta.orderStatuses.map((s) => (
              <div key={s} className="bar-row">
                <span className="bar-label">{label(s)}</span>
                <div className="bar-track"><div className="bar-fill azul" style={{ width: `${((ordersBy[s] || 0) / maxOrders) * 100}%` }} /></div>
                <span className="bar-val">{ordersBy[s] || 0}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h3 className="titulo-seccion">Actividad reciente</h3></div>
          {d.activity.length === 0 && <Empty>Sin actividad todavía.</Empty>}
          <ul className="timeline compact">
            {d.activity.slice(0, 8).map((a) => (
              <li key={a.id}>
                <span className={`dot type-${a.type}`} />
                <div>
                  <div>{a.body}</div>
                  <small className="muted">{a.contact_name && <Link to={`/contactos/${a.contact_id}`}>{a.contact_name}</Link>} · {a.type} · {fmtDateTime(a.created_at)}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {d.tasks.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h3 className="titulo-seccion">Tareas para hoy</h3><Link to="/tareas">Todas →</Link></div>
          <ul className="list compacta">{d.tasks.map((x) => <li key={x.id}><span>{x.title}</span><span className="muted small">{x.contact_name}</span><span className="small">{fmtDate(x.due_date)}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Kpi({ tono, icono, titulo, valor, sub, to }) {
  return (
    <Link to={to} className={`kpi-color tono-${tono}`}>
      <span className="kpi-top"><span className="kpi-titulo">{titulo}</span><span className="kpi-icono">{icono}</span></span>
      <span className="kpi-num">{valor}</span>
      <span className="kpi-pie">{sub}</span>
    </Link>
  );
}
