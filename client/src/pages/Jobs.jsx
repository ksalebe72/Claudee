import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, label, today, useLoad } from '../utils.js';
import { Badge, Empty, PageHeader, useMeta } from '../components/ui.jsx';
import { Semaforo } from '../components/FinancePanels.jsx';

export default function Jobs({ kind }) {
  const meta = useMeta();
  const [status, setStatus] = useState('');
  const [list] = useLoad(() => api.get(`/jobs?kind=${kind}${status ? `&status=${status}` : ''}`), [kind, status]);
  const statuses = kind === 'quote' ? meta.quoteStatuses : meta.orderStatuses;
  const isQuote = kind === 'quote';

  return (
    <>
      <PageHeader title={isQuote ? 'Cotizaciones' : 'Órdenes de trabajo'} subtitle={isQuote ? 'Precios por talla y decoración con rentabilidad en vivo. El cliente aprueba en su enlace; el sistema no envía ni cobra.' : 'Todo lo que está en producción o entregado'}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        {isQuote && <Link className="btn primary" to="/trabajos/nuevo">+ Nueva cotización</Link>}
      </PageHeader>
      <div className="card no-pad">
        <table className="table">
          <thead>
            <tr>
              <th>#</th><th>Trabajo</th><th>Cliente</th><th className="num">Piezas</th><th className="num">Total</th>
              {!isQuote && <th className="num">Saldo</th>}
              {!isQuote && <th>Arte</th>}
              <th>{isQuote ? 'Creada' : 'Entrega'}</th><th>Contribución</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {list?.map((j) => (
              <tr key={j.id}>
                <td><Link to={`/trabajos/${j.id}`}><strong>{isQuote ? j.number : j.order_number}</strong></Link></td>
                <td><Link to={`/trabajos/${j.id}`}>{j.title}</Link></td>
                <td>{j.contact_name}<div className="muted small">{j.contact_company}</div></td>
                <td className="num">{j.pieces || 0}</td>
                <td className="num">{money(j.total)}</td>
                {!isQuote && <td className={`num ${j.total - j.paid > 0.009 ? 'danger' : 'ok'}`}>{money(j.total - j.paid)}</td>}
                {!isQuote && <td>{j.proof_status ? <Badge status={j.proof_status} /> : <span className="muted">—</span>}</td>}
                <td className={!isQuote && j.due_date && j.due_date < today() && j.status !== 'entregado' ? 'danger' : ''}>{fmtDate(isQuote ? j.created_at : j.due_date)}</td>
                <td><Semaforo fin={j.fin} small />{j.fin?.aprobacion?.requerida && !j.fin.aprobacion.ok && <div className="danger small">requiere aprobación</div>}</td>
                <td><Badge status={j.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list?.length === 0 && <Empty>{isQuote ? 'No hay cotizaciones. Crea la primera.' : 'Aún no hay órdenes. Se crean cuando el cliente aprueba una cotización.'}</Empty>}
      </div>
    </>
  );
}
