import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, label, today, useLoad } from '../utils.js';
import { Badge, Kanban, PageHeader, useMeta } from '../components/ui.jsx';

export default function Production() {
  const meta = useMeta();
  const [showDelivered, setShowDelivered] = useState(false);
  const [jobs, reload, setJobs] = useLoad(() => api.get('/jobs?kind=order'));
  const cols = meta.orderStatuses.filter((s) => showDelivered || s !== 'entregado');

  async function move(j, status) {
    setJobs(jobs.map((x) => (x.id === j.id ? { ...x, status } : x)));
    await api.post(`/jobs/${j.id}/status`, { status });
    reload();
  }

  return (
    <>
      <PageHeader title="Producción" subtitle="Arrastra las órdenes entre etapas. Cada cambio puede disparar avisos al cliente.">
        <label className="inline"><input type="checkbox" checked={showDelivered} onChange={(e) => setShowDelivered(e.target.checked)} /> Mostrar entregadas</label>
      </PageHeader>
      {jobs && (
        <Kanban
          columns={cols.map((s) => ({ id: s, title: label(s) }))}
          items={jobs}
          getColumn={(j) => j.status}
          onMove={move}
          columnFooter={(list) => `${list.reduce((a, j) => a + (j.pieces || 0), 0)} piezas`}
          renderCard={(j) => {
            const late = j.due_date && j.due_date < today();
            return (
              <Link to={`/trabajos/${j.id}`} className="job-card">
                <div className="row between">
                  <strong>{j.order_number}</strong>
                  {['alta', 'urgente'].includes(j.priority) && <Badge tone={j.priority === 'urgente' ? 'red' : 'amber'}>{j.priority}</Badge>}
                </div>
                <div>{j.title}</div>
                <div className="muted small">{j.contact_name} · {j.pieces || 0} pzs</div>
                <div className="row between small">
                  <span className={late ? 'danger' : ''}>📅 {fmtDate(j.due_date)}</span>
                  {j.proof_status && <Badge status={j.proof_status}>arte: {label(j.proof_status)}</Badge>}
                </div>
                {j.po_status && <div className="small"><span className={`badge po-${j.po_status}`}>PO {label(j.po_status)}</span> {j.po_taller}</div>}
                {j.total - j.paid > 0.009 && <div className="small danger">Saldo {money(j.total - j.paid)}</div>}
              </Link>
            );
          }}
        />
      )}
    </>
  );
}
