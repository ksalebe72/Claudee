// Página pública del taller externo: su orden de compra (PO) con instrucciones, cantidades, artes aprobados y lo que se le paga.
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, useLoad } from '../utils.js';
import { applyBrand } from '../brand.jsx';

export default function TallerPO() {
  const { token } = useParams();
  const [p, , setP, error] = useLoad(() => api.get(`/portal/taller/${token}`), [token]);
  const [nota, setNota] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  if (error) return <div className="portal"><div className="portal-card"><h2>Enlace no válido</h2><p>Pide a Color Plus un enlace nuevo de la orden de compra.</p></div></div>;
  if (!p) return <div className="loading">Cargando…</div>;
  applyBrand(p.brand);
  const marcar = async (estado) => { setBusy(true); try { setP(await api.post(`/portal/taller/${token}/estado`, { estado, nota })); setNota(''); setErr(null); } catch (e) { setErr(e.message); } setBusy(false); };
  const esImagen = (u) => /\.(png|jpe?g|webp|gif|svg)$/i.test(u || '');

  return (
    <div className="portal">
      <div className="portal-card">
        <div className="portal-herramientas no-imprimir">
          <a className="btn" href={`/api/portal/taller/${token}/pdf`} target="_blank" rel="noreferrer">⬇ PDF</a>
          <button className="btn" onClick={() => window.print()}>🖨 Imprimir</button>
        </div>
        <header className="portal-head">
          <div>
            {p.brand?.logo ? <img src={p.brand.logo} alt={p.business_name} className="portal-logo" /> : null}
            <h1>Orden de compra {p.numero}</h1>
            <p className="muted">{p.business_name} · Orden interna {p.orden} · {p.trabajo}</p>
          </div>
          <div className="right">
            <span className={`badge po-${p.status}`}>{p.estado}</span>
            <p><strong>Para:</strong> {p.taller?.name}</p>
            <p><strong>Entregar el:</strong> {p.fecha_entrega ? fmtDate(p.fecha_entrega) : 'por confirmar'}</p>
          </div>
        </header>

        {p.status === 'cancelado' && <div className="notice"><strong>Este PO fue cancelado.</strong> {p.cancel_reason}</div>}

        {p.instrucciones && <section><h3>Instrucciones</h3><p style={{ whiteSpace: 'pre-wrap' }}>{p.instrucciones}</p></section>}

        <section>
          <h3>Trabajo</h3>
          <p className="muted small">Las prendas las envía SanMar directo a tu taller. Verifica cantidades y tallas al recibirlas.</p>
          {p.lineas.map((l, i) => (
            <div key={i} className="po-linea">
              {l.tipo === 'prenda' ? (
                <>
                  <div><strong>{i + 1}. {l.codigo ? `${l.codigo} · ` : ''}{l.descripcion}</strong>{l.color ? ` · ${l.color}` : ''}</div>
                  <div className="po-tallas">{Object.entries(l.tallas).map(([t, n]) => <span key={t}><small>{t}</small><strong>{n}</strong></span>)}<span className="total"><small>Total</small><strong>{l.cantidad}</strong></span></div>
                  {l.decoraciones.map((d, k) => (
                    <div key={k} className="po-deco">
                      <span className="grow"><strong>{d.nombre}</strong> · {d.ubicacion}{d.ancho && d.alto ? ` · ${d.ancho}" × ${d.alto}"` : ''}{d.puntadas ? ` · ${d.puntadas} puntadas` : ''}{d.colores ? ` · colores: ${d.colores}` : ''}</span>
                      <span>{money(d.costoUnitario)}/pz × {l.cantidad} = <strong>{money(d.total)}</strong></span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="po-deco"><span className="grow"><strong>{i + 1}. {l.descripcion}</strong> × {l.cantidad}</span><strong>{money(l.total)}</strong></div>
              )}
            </div>
          ))}
          <div className="portal-totals"><div className="row between total"><span>Total a pagar</span><span>{money(p.total)}</span></div></div>
        </section>

        <section>
          <h3>Arte aprobado por el cliente</h3>
          {p.pruebas.map((x) => (
            <div key={x.version} className="portal-proof">
              {esImagen(x.file_url) ? <img src={x.file_url} alt={`Prueba v${x.version}`} /> : null}
              <a className="btn no-imprimir" href={x.file_url} target="_blank" rel="noreferrer" download>⬇ Descargar prueba v{x.version}</a>
            </div>
          ))}
        </section>

        {['enviado', 'recibido'].includes(p.status) && (
          <section className="portal-actions no-imprimir">
            <h3>Avísanos cómo va</h3>
            <textarea rows={2} placeholder="Nota para Color Plus (opcional): faltó una talla, cuándo está listo…" value={nota} onChange={(e) => setNota(e.target.value)} />
            {err && <p className="danger">{err}</p>}
            <div className="row gap wrap">
              {p.status === 'enviado' && <button className="btn" disabled={busy} onClick={() => marcar('recibido')}>✓ Recibí la orden y las prendas</button>}
              <button className="btn primary" disabled={busy} onClick={() => confirm('¿Confirmas que el trabajo está terminado y listo para recoger?') && marcar('terminado')}>✓ Trabajo terminado</button>
            </div>
          </section>
        )}
        {p.status === 'terminado' && <div className="notice">✓ Marcaste este trabajo como terminado el {fmtDate(p.done_at)}. ¡Gracias!</div>}
      </div>
    </div>
  );
}
