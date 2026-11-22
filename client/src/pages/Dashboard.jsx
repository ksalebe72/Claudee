import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, fmtDateTime, label, useLoad } from '../utils.js';
import { Badge, PageHeader, Empty, useMeta } from '../components/ui.jsx';

export default function Dashboard() {
  const meta = useMeta();
  const [d] = useLoad(() => api.get('/dashboard'));
  if (!d) return <div className="loading">Cargando…</div>;

  const openPipeline = d.pipeline.filter((p) => !['ganado', 'perdido'].includes(p.stage));
  const pipeValue = openPipeline.reduce((a, p) => a + p.value, 0);
  const ordersBy = Object.fromEntries(d.orders.map((o) => [o.status, o.count]));
  const activeOrders = d.orders.filter((o) => o.status !== 'entregado').reduce((a, o) => a + o.count, 0);
  const maxOrders = Math.max(1, ...meta.orderStatuses.map((s) => ordersBy[s] || 0));

  return (
    <>
      <PageHeader title="Tablero" subtitle="Resumen de ventas, producción y cobranza">
        <Link className="btn" to="/contactos?nuevo=1">+ Contacto</Link>
        <Link className="btn primary" to="/trabajos/nuevo">+ Cotización</Link>
      </PageHeader>

      <div className="kpis">
        {/* Logística no ve montos: el servidor no los envía */}
        {d.openQuotes && <Kpi label="Pipeline abierto" value={money(pipeValue)} sub={`${openPipeline.reduce((a, p) => a + p.count, 0)} oportunidades`} to="/pipeline" />}
        {d.openQuotes && <Kpi label="Cotizaciones abiertas" value={money(d.openQuotes.value)} sub={`${d.openQuotes.count} sin cerrar`} to="/cotizaciones" />}
        <Kpi label="Órdenes activas" value={activeOrders} sub={`${d.overdue.length} atrasadas · ${d.pendingProofs} pruebas pendientes`} to="/produccion" warn={d.overdue.length > 0} />
        {d.revenue != null && <Kpi label="Cobrado este mes" value={money(d.revenue)} sub={`Vendido: ${money(d.booked)}`} to="/cobranza" />}
        {d.ar != null && <Kpi label="Por cobrar" value={money(d.ar)} sub="Saldo de órdenes" to="/cobranza" />}
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h3>Producción por etapa</h3><Link to="/produccion">Ver tablero →</Link></div>
          <div className="bars">
            {meta.orderStatuses.map((s) => (
              <div key={s} className="bar-row">
                <span className="bar-label">{label(s)}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${((ordersBy[s] || 0) / maxOrders) * 100}%` }} /></div>
                <span className="bar-val">{ordersBy[s] || 0}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h3>Entregas próximas</h3></div>
          {d.overdue.length === 0 && d.dueSoon.length === 0 && <Empty>No hay órdenes con fecha de entrega.</Empty>}
          <ul className="list">
            {[...d.overdue.map((o) => ({ ...o, late: true })), ...d.dueSoon].map((o) => (
              <li key={o.id}>
                <Link to={`/trabajos/${o.id}`}><strong>{o.order_number}</strong> {o.title}</Link>
                <span className="muted">{o.contact_name}</span>
                <span className={o.late ? 'danger' : ''}>{o.late ? 'Atrasada · ' : ''}{fmtDate(o.due_date)}</span>
                <Badge status={o.status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head"><h3>Tareas para hoy</h3><Link to="/tareas">Todas →</Link></div>
          {d.tasks.length === 0 && <Empty>Todo al día 🎉</Empty>}
          <ul className="list">
            {d.tasks.map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
                <span className="muted">{t.contact_name}</span>
                <span>{fmtDate(t.due_date)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head"><h3>Actividad reciente</h3></div>
          <ul className="timeline compact">
            {d.activity.map((a) => (
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
    </>
  );
}

function Kpi({ label: l, value, sub, to, warn }) {
  return (
    <Link to={to} className={`kpi ${warn ? 'warn' : ''}`}>
      <span className="kpi-label">{l}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
    </Link>
  );
}
