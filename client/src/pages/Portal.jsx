// Portal del cliente: cotización o factura en su idioma (español o inglés), con proofs para aprobar.
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { money, useLoad } from '../utils.js';
import { applyBrand } from '../brand.jsx';
import { textos, estadoCliente, procesoCliente, ubicacionCliente, fechaCliente } from '../../../shared/idiomas.js';

export default function Portal() {
  const { token } = useParams();
  const [j, , setJ, error] = useLoad(() => api.get(`/portal/${token}`), [token]);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(null);

  if (error) return <div className="portal"><div className="portal-card"><h2>Enlace no válido · Invalid link</h2><p>Pide a tu proveedor un enlace nuevo. · Please ask your provider for a new link.</p></div></div>;
  if (!j) return <div className="loading">Cargando… / Loading…</div>;
  applyBrand(j.brand);
  const idioma = j.idioma || 'es';
  const t = textos(idioma);
  if (typeof document !== 'undefined') document.documentElement.lang = idioma;

  const post = async (url, body) => {
    try { setJ(await api.post(`/portal/${token}${url}`, body)); setComment(''); setErr(null); } catch (e) { setErr(e.message); }
  };
  const isQuote = j.kind === 'quote';
  const canDecideQuote = isQuote && ['borrador', 'enviada'].includes(j.status);
  const pendingProof = j.proofs.find((p) => p.status === 'pendiente');
  // Una orden se presenta al cliente como factura
  const titulo = isQuote ? `${t.cotizacion} ${j.number}` : `${t.factura} ${j.order_number}`;
  const fecha = isQuote ? j.created_at : j.invoice_date || j.created_at;

  return (
    <div className="portal" lang={idioma}>
      <div className="portal-card">
        <div className="portal-herramientas no-imprimir">
          <button className="btn" onClick={() => window.print()}>🖨 {t.imprimir}</button>
        </div>
        <header className="portal-head">
          <div>
            {j.brand?.logo ? <img src={j.brand.logo} alt={j.business_name} className="portal-logo" /> : null}
            <div className="muted">{j.business_name}</div>
            <h1>{titulo}</h1>
            <div>{j.title}</div>
            {fecha && <div className="muted small">{isQuote ? t.fecha : t.fechaFactura}: {fechaCliente(fecha, idioma)}</div>}
          </div>
          <div className="right">
            <div className="muted">{t.para}</div>
            <strong>{j.contact.name}</strong>
            <div className="muted">{j.contact.company}</div>
            {j.contact.address && <div className="muted small">{j.contact.address}</div>}
            <span className="badge tone-blue">{estadoCliente(j.status, idioma)}</span>
          </div>
        </header>

        {pendingProof && (
          <section className="portal-proof no-imprimir">
            <h2>{t.revisaPrueba} (v{pendingProof.version})</h2>
            {/\.pdf$/i.test(pendingProof.file_url)
              ? <a className="btn" href={pendingProof.file_url} target="_blank" rel="noreferrer">{t.abrirPdf}</a>
              : <img src={pendingProof.file_url} alt={t.pruebaAlt} />}
            {pendingProof.note && <p>{pendingProof.note}</p>}
            <textarea rows={2} placeholder={t.comentariosCambios} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="row gap">
              <button className="btn primary" onClick={() => post(`/proofs/${pendingProof.id}`, { status: 'aprobada', comment })}>{t.aprobarArte}</button>
              <button className="btn" disabled={!comment.trim()} onClick={() => post(`/proofs/${pendingProof.id}`, { status: 'rechazada', comment })}>{t.pedirCambios}</button>
            </div>
            <p className="muted small">{t.avisoAprobarArte}</p>
          </section>
        )}

        <table className="table">
          <thead><tr><th>{t.producto}</th><th>{t.tallas}</th><th className="num">{t.cant}</th><th className="num">{t.precioPz}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>
            {j.items.map((it) => (
              <tr key={it.id}>
                <td>
                  <strong>{it.description}</strong>{it.color && ` · ${it.color}`}
                  <div className="muted small">{it.decorations.map((d) => `${ubicacionCliente(d.location, idioma)} (${procesoCliente(d.process || d.method_name, idioma)}${d.width && d.height ? ` ${d.width}×${d.height}"` : ''})`).join(' · ')}</div>
                </td>
                <td className="small">{Object.entries(it.sizes || {}).filter(([, n]) => Number(n) > 0).map(([s, n]) => `${s}:${n}`).join(' ')}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{money(it.unit_price)}</td>
                <td className="num">{money(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="portal-totals">
          <div className="row between"><span>{t.subtotal}</span><span>{money(j.subtotal)}</span></div>
          {j.discount > 0 && <div className="row between"><span>{t.descuento}</span><span>-{money(j.discount)}</span></div>}
          {j.shipping > 0 && <div className="row between"><span>{t.envio}</span><span>{money(j.shipping)}</span></div>}
          <div className="row between"><span>{t.impuesto}</span><span>{money(j.tax)}</span></div>
          <div className="row between total"><span>{t.total}</span><span>{money(j.total)}</span></div>
          {!isQuote && <div className="row between"><span>{t.pagado}</span><span>{money(j.paid)}</span></div>}
          {!isQuote && <div className="row between total"><span>{t.saldo}</span><span>{money(j.balance)}</span></div>}
        </div>

        {j.notes && <p className="note">{j.notes}</p>}
        {j.due_date && <p>{t.entregaEstimada}: <strong>{fechaCliente(j.due_date, idioma)}</strong></p>}

        {canDecideQuote && (
          <section className="portal-actions no-imprimir">
            <p>{t.anticipo}: <strong>{money(j.total * j.deposit_pct)}</strong> ({Math.round(j.deposit_pct * 100)}%)</p>
            <textarea rows={2} placeholder={t.comentariosOpc} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="row gap">
              <button className="btn primary big" onClick={() => post('/quote', { approved: true, comment })}>{t.aprobarCotizacion}</button>
              <button className="btn" onClick={() => post('/quote', { approved: false, comment })}>{t.rechazar}</button>
            </div>
          </section>
        )}
        {isQuote && j.status === 'aprobada' && <p className="ok big no-imprimir">{t.graciasAprobada}</p>}
        {!isQuote && <p className="muted">{t.estadoOrden}: <strong>{estadoCliente(j.status, idioma)}</strong></p>}
        {err && <p className="danger">{err}</p>}
      </div>
    </div>
  );
}
