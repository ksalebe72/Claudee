import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, useLoad } from '../utils.js';
import { Badge, Empty, PageHeader } from '../components/ui.jsx';

export default function Billing() {
  const [filter, setFilter] = useState('open');
  const [orders] = useLoad(() => api.get('/jobs?kind=order'));
  if (!orders) return <div className="loading">Cargando…</div>;

  const rows = orders.map((o) => ({ ...o, balance: Math.round((o.total - o.paid) * 100) / 100 }));
  const shown = rows.filter((o) => (filter === 'open' ? o.balance > 0 : filter === 'paid' ? o.balance <= 0 : true));
  const totalAR = rows.reduce((a, o) => a + Math.max(0, o.balance), 0);
  const unpaidReady = rows.filter((o) => o.balance > 0 && ['listo', 'entregado'].includes(o.status));

  return (
    <>
      <PageHeader title="Cobranza" subtitle="Saldos por orden, anticipos y pagos">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Con saldo</option><option value="paid">Pagadas</option><option value="all">Todas</option>
        </select>
      </PageHeader>
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Total por cobrar</span><span className="kpi-value">{money(totalAR)}</span></div>
        <div className={`kpi ${unpaidReady.length ? 'warn' : ''}`}><span className="kpi-label">Listas/entregadas sin pagar</span><span className="kpi-value">{unpaidReady.length}</span><span className="kpi-sub">{money(unpaidReady.reduce((a, o) => a + o.balance, 0))}</span></div>
        <div className="kpi"><span className="kpi-label">Sin anticipo</span><span className="kpi-value">{rows.filter((o) => o.paid === 0 && o.total > 0).length}</span><span className="kpi-sub">órdenes sin ningún pago</span></div>
      </div>
      <div className="card no-pad">
        <table className="table">
          <thead><tr><th>Orden</th><th>Cliente</th><th>Estado</th><th>Entrega</th><th className="num">Total</th><th className="num">Pagado</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id}>
                <td><Link to={`/trabajos/${o.id}`}><strong>{o.order_number}</strong> {o.title}</Link></td>
                <td>{o.contact_name}</td>
                <td><Badge status={o.status} /></td>
                <td>{fmtDate(o.due_date)}</td>
                <td className="num">{money(o.total)}</td>
                <td className="num ok">{money(o.paid)}</td>
                <td className={`num ${o.balance > 0 ? 'danger' : ''}`}>{money(o.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Empty>Nada por aquí.</Empty>}
      </div>
    </>
  );
}
