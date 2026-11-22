import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, label, useLoad } from '../utils.js';
import { applyBrand } from '../brand.jsx';

export default function Portal() {
  const { token } = useParams();
  const [j, , setJ, error] = useLoad(() => api.get(`/portal/${token}`), [token]);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(null);

  if (error) return <div className="portal"><div className="portal-card"><h2>Enlace no válido</h2><p>Pide a tu proveedor un enlace nuevo.</p></div></div>;
  if (!j) return <div className="loading">Cargando…</div>;
  applyBrand(j.brand);

  const post = async (url, body) => {
    try { setJ(await api.post(`/portal/${token}${url}`, body)); setComment(''); setErr(null); } catch (e) { setErr(e.message); }
  };
  const isQuote = j.kind === 'quote';
  const canDecideQuote = isQuote && ['borrador', 'enviada'].includes(j.status);
  const pendingProof = j.proofs.find((p) => p.status === 'pendiente');

  return (
    <div className="portal">
      <div className="portal-card">
        <header className="portal-head">
          <div>
            {j.brand?.logo ? <img src={j.brand.logo} alt={j.business_name} className="portal-logo" /> : null}
            <div className="muted">{j.business_name}</div>
            <h1>{isQuote ? `Cotización ${j.number}` : `Orden ${j.order_number}`}</h1>
            <div>{j.title}</div>
          </div>
          <div className="right">
            <div className="muted">Para</div>
            <strong>{j.contact.name}</strong>
            <div className="muted">{j.contact.company}</div>
            <span className="badge tone-blue">{label(j.status)}</span>
          </div>
        </header>

        {pendingProof && (
          <section className="portal-proof">
            <h2>Revisa tu prueba de arte (v{pendingProof.version})</h2>
            {/\.pdf$/i.test(pendingProof.file_url)
              ? <a className="btn" href={pendingProof.file_url} target="_blank" rel="noreferrer">Abrir PDF</a>
              : <img src={pendingProof.file_url} alt="Prueba de arte" />}
            {pendingProof.note && <p>{pendingProof.note}</p>}
            <textarea rows={2} placeholder="Comentarios o cambios (obligatorio si pides cambios)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="row gap">
              <button className="btn primary" onClick={() => post(`/proofs/${pendingProof.id}`, { status: 'aprobada', comment })}>✓ Aprobar arte</button>
              <button className="btn" disabled={!comment.trim()} onClick={() => post(`/proofs/${pendingProof.id}`, { status: 'rechazada', comment })}>Pedir cambios</button>
            </div>
            <p className="muted small">Al aprobar confirmas ortografía, colores, tamaños y ubicación. La producción inicia con esta versión.</p>
          </section>
        )}

        <table className="table">
          <thead><tr><th>Producto</th><th>Tallas</th><th className="num">Cant.</th><th className="num">Precio/pz</th><th className="num">Total</th></tr></thead>
          <tbody>
            {j.items.map((it) => (
              <tr key={it.id}>
                <td>
                  <strong>{it.description}</strong>{it.color && ` · ${it.color}`}
                  <div className="muted small">{it.decorations.map((d) => `${d.location} (${d.method_name}${d.width && d.height ? ` ${d.width}×${d.height}"` : ''})`).join(' · ')}</div>
                </td>
                <td className="small">{Object.entries(it.sizes || {}).map(([s, n]) => `${s}:${n}`).join(' ')}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{money(it.unit_price)}</td>
                <td className="num">{money(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="portal-totals">
          <div className="row between"><span>Subtotal</span><span>{money(j.subtotal)}</span></div>
          {j.discount > 0 && <div className="row between"><span>Descuento</span><span>-{money(j.discount)}</span></div>}
          {j.shipping > 0 && <div className="row between"><span>Envío</span><span>{money(j.shipping)}</span></div>}
          <div className="row between"><span>Impuesto</span><span>{money(j.tax)}</span></div>
          <div className="row between total"><span>Total</span><span>{money(j.total)}</span></div>
          {!isQuote && <div className="row between"><span>Pagado</span><span>{money(j.paid)}</span></div>}
          {!isQuote && <div className="row between total"><span>Saldo</span><span>{money(j.balance)}</span></div>}
        </div>

        {j.notes && <p className="note">{j.notes}</p>}
        {j.due_date && <p>Fecha de entrega estimada: <strong>{fmtDate(j.due_date)}</strong></p>}

        {canDecideQuote && (
          <section className="portal-actions">
            <p>Anticipo requerido para iniciar: <strong>{money(j.total * j.deposit_pct)}</strong> ({Math.round(j.deposit_pct * 100)}%)</p>
            <textarea rows={2} placeholder="Comentarios (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="row gap">
              <button className="btn primary big" onClick={() => post('/quote', { approved: true, comment })}>✓ Aprobar cotización</button>
              <button className="btn" onClick={() => post('/quote', { approved: false, comment })}>Rechazar</button>
            </div>
          </section>
        )}
        {isQuote && j.status === 'aprobada' && <p className="ok big">¡Gracias! Tu cotización fue aprobada. Te contactaremos para el arte y el anticipo.</p>}
        {!isQuote && <p className="muted">Estado de tu orden: <strong>{label(j.status)}</strong></p>}
        {err && <p className="danger">{err}</p>}
      </div>
    </div>
  );
}
