// Producción externa: tarjeta de la orden para preparar y mandar el PO al taller, y la lista de talleres.
import React, { useState } from 'react';
import { api } from '../api.js';
import { money, fmtDate, useLoad } from '../utils.js';

const vacio = { name: '', contacto: '', phone: '', email: '', address: '', notas: '' };
const tallas = (t) => Object.entries(t || {}).map(([k, n]) => `${k} ${n}`).join(' · ');
const enlaceTaller = (po) => `${location.origin}/portal/taller/${po.token}`;

/** Formulario corto de taller (alta o edición). */
function TallerForm({ inicial = vacio, onSaved, onCancel, notify }) {
  const [f, setF] = useState({ ...vacio, ...inicial });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function guardar(e) {
    e.preventDefault();
    setBusy(true);
    try { onSaved(inicial.id ? await api.put(`/talleres/${inicial.id}`, f) : await api.post('/talleres', f)); } catch (err) { notify(err.message, true); }
    setBusy(false);
  }
  return (
    <form className="taller-form" onSubmit={guardar}>
      <input required placeholder="Nombre del taller *" value={f.name} onChange={set('name')} />
      <input placeholder="Contacto" value={f.contacto || ''} onChange={set('contacto')} />
      <input placeholder="Teléfono" value={f.phone || ''} onChange={set('phone')} />
      <input type="email" placeholder="Email" value={f.email || ''} onChange={set('email')} />
      <input className="ancho" placeholder="Dirección (ahí manda SanMar las prendas)" value={f.address || ''} onChange={set('address')} />
      <input className="ancho" placeholder="Notas (procesos que hace, tiempos…)" value={f.notas || ''} onChange={set('notas')} />
      <div className="row gap ancho">
        <button className="btn primary" disabled={busy || !f.name.trim()}>{inicial.id ? 'Guardar' : 'Crear taller'}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

/** Ajustes → Talleres: los talleres externos a los que se les manda la producción. */
export function Talleres({ notify }) {
  const [lista, recargar] = useLoad(() => api.get('/talleres'));
  const [editando, setEditando] = useState(null);
  return (
    <div className="settings-grid">
      <section className="card wide">
        <h3>Talleres externos</h3>
        <p className="muted small">La producción se manda a estos talleres con un PO. La dirección es a donde SanMar envía las prendas.</p>
        {lista?.length > 0 && (
          <div className="tabla-desliza">
            <table className="table">
              <thead><tr><th>Taller</th><th>Contacto</th><th>Teléfono</th><th>Dirección</th><th>Notas</th><th /></tr></thead>
              <tbody>{lista.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'muted'}>
                  <td><strong>{t.name}</strong>{!t.active && ' (inactivo)'}</td><td>{t.contacto}</td><td>{t.phone}</td><td className="wrap">{t.address}</td><td className="wrap small">{t.notas}</td>
                  <td>
                    <button className="link-btn" onClick={() => setEditando(t)}>Editar</button>{' '}
                    <button className="link-btn" onClick={async () => { try { await api.put(`/talleres/${t.id}`, { active: !t.active }); recargar(); } catch (e) { notify(e.message, true); } }}>{t.active ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <h4>{editando ? `Editar ${editando.name}` : 'Taller nuevo'}</h4>
        <TallerForm key={editando?.id || 'nuevo'} inicial={editando || vacio} notify={notify} onCancel={editando ? () => setEditando(null) : null}
          onSaved={() => { setEditando(null); recargar(); notify('Taller guardado'); }} />
      </section>
    </div>
  );
}

/** Tarjeta de la orden: requisitos, PO para el taller (borrador → enviado → recibido → terminado) y lista de compra de SanMar. */
export function ProduccionExternaCard({ job, notify, onUpdated }) {
  const [d, recargar, setD] = useLoad(() => api.get(`/jobs/${job.id}/po`), [job.id, job.status, job.proofs?.[0]?.status]);
  const [talleres, recargarTalleres] = useLoad(() => api.get('/talleres').catch(() => []), []);
  const [f, setF] = useState({ taller_id: '', instrucciones: '', fecha_entrega: '' });
  const [nuevoTaller, setNuevoTaller] = useState(false);
  const [edit, setEdit] = useState(null); // líneas del borrador en edición
  const [busy, setBusy] = useState(false);
  const [verCompra, setVerCompra] = useState(false);
  if (!d) return null;
  const { requisitos, po, previa, puedeMandar } = d;
  const activos = (talleres || []).filter((t) => t.active);

  const paso = async (fn, msg) => { setBusy(true); try { await fn(); if (msg) notify(msg); } catch (e) { notify(e.message, true); } setBusy(false); };
  const refrescar = async (nuevoPo) => { if (nuevoPo) setD({ ...d, po: nuevoPo }); else await recargar(); setEdit(null); onUpdated?.(); };
  const copiar = (texto, msg) => { navigator.clipboard?.writeText(texto); notify(msg); };

  const lineas = edit || po?.lineas || [];
  const setCosto = (i, k, patch) => setEdit(lineas.map((l, a) => (a !== i ? l : k == null ? { ...l, ...patch } : { ...l, decoraciones: l.decoraciones.map((x, b) => (b === k ? { ...x, ...patch } : x)) })));
  const listaCompra = po?.listaCompra || [];
  const textoCompra = () => [`Pedido SanMar · ${job.order_number} · enviar directo a: ${po.taller?.name}${po.taller?.address ? `, ${po.taller.address}` : ''}`, ...listaCompra.map((x) => `${x.codigo || x.descripcion} · ${x.color} · ${x.talla} · ${x.cantidad}`)].join('\n');

  return (
    <section className="card produccion-externa">
      <h3>Producción externa {po && <span className={`badge po-${po.status}`}>{po.estado}</span>}</h3>

      {!po && (
        <>
          <ul className="requisitos">{requisitos.lista.map((r) => <li key={r.clave} className={r.ok ? 'ok' : 'falta'}>{r.ok ? '✓' : '○'} {r.texto}</li>)}</ul>
          {!requisitos.ok ? <p className="muted small">La orden se manda a producción solo cuando el cliente aprobó.</p>
            : !puedeMandar ? <p className="muted small">Lista para producción. La manda Coordinación de ventas, Gerencia o el dueño.</p> : (
              <>
                <label className="field"><span>Taller</span>
                  <select value={f.taller_id} onChange={(e) => (e.target.value === 'nuevo' ? setNuevoTaller(true) : setF({ ...f, taller_id: e.target.value }))}>
                    <option value="">— Escoger taller —</option>
                    {activos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="nuevo">+ Taller nuevo…</option>
                  </select>
                </label>
                {nuevoTaller && <TallerForm notify={notify} onCancel={() => setNuevoTaller(false)} onSaved={async (t) => { await recargarTalleres(); setF({ ...f, taller_id: String(t.id) }); setNuevoTaller(false); notify('Taller creado'); }} />}
                <label className="field"><span>Instrucciones para el taller</span>
                  <textarea rows={3} value={f.instrucciones} onChange={(e) => setF({ ...f, instrucciones: e.target.value })} placeholder="Colores de hilo, empaque, entrega…" />
                </label>
                <label className="field"><span>Fecha en que lo necesitas del taller</span><input type="date" value={f.fecha_entrega || job.due_date || ''} onChange={(e) => setF({ ...f, fecha_entrega: e.target.value })} /></label>
                {previa && <p className="small muted">Costo de la matriz: <strong>{previa.total == null ? 'falta un costo' : money(previa.total)}</strong>. Lo puedes corregir en el PO antes de mandarlo.</p>}
                <button className="btn primary" disabled={busy || !f.taller_id} onClick={() => paso(async () => refrescar(await api.post(`/jobs/${job.id}/po`, { ...f, fecha_entrega: f.fecha_entrega || job.due_date || '' })), 'PO creado en borrador: revisa los costos y mándalo')}>Crear PO para el taller</button>
              </>
            )}
        </>
      )}

      {po && (
        <>
          <div className="row between"><strong>{po.numero}</strong><span>{po.taller?.name}</span></div>
          <div className="muted small">Entrega del taller: {po.fecha_entrega ? fmtDate(po.fecha_entrega) : 'por confirmar'}{po.sent_at ? ` · enviado ${fmtDate(po.sent_at)}` : ''}{po.received_at ? ` · recibido ${fmtDate(po.received_at)}` : ''}{po.done_at ? ` · terminado ${fmtDate(po.done_at)}` : ''}</div>
          {po.nota_taller && <div className="notice small">Nota del taller: {po.nota_taller}</div>}

          <div className="po-lineas">
            {lineas.map((l, i) => (
              <div key={i} className="po-linea">
                {l.tipo === 'prenda' ? (
                  <>
                    <div><strong>{l.codigo ? `${l.codigo} · ` : ''}{l.descripcion}</strong>{l.color ? ` · ${l.color}` : ''}</div>
                    <div className="muted small">{tallas(l.tallas)} · {l.cantidad} pzs</div>
                    {l.decoraciones.map((x, k) => (
                      <div key={k} className="po-deco">
                        <span className="grow">{x.nombre} · {x.ubicacion}{x.ancho && x.alto ? ` · ${x.ancho}" × ${x.alto}"` : ''}</span>
                        {'costoUnitario' in x && (po.status === 'borrador' && puedeMandar
                          ? <label className="inline small">$<input type="number" step="0.01" min="0" className="mini" value={x.costoUnitario ?? ''} placeholder="?" onChange={(e) => setCosto(i, k, { costoUnitario: e.target.value })} />/pz</label>
                          : <span className="small">{x.costoUnitario == null ? <span className="warn-txt">por definir</span> : `${money(x.costoUnitario)}/pz = ${money(x.total)}`}</span>)}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="po-deco">
                    <span className="grow"><strong>{l.descripcion}</strong> × {l.cantidad}</span>
                    {'costoUnitario' in l && (po.status === 'borrador' && puedeMandar
                      ? <><label className="inline small">$<input type="number" step="0.01" min="0" className="mini" value={l.costoUnitario ?? ''} placeholder="?" onChange={(e) => setCosto(i, null, { costoUnitario: e.target.value })} /></label><button className="icon-btn" title="Quitar del PO (no es del taller)" onClick={() => setCosto(i, null, { quitar: !l.quitar })}>{l.quitar ? '↩' : '×'}</button></>
                      : <span className="small">{l.costoUnitario == null ? <span className="warn-txt">por definir</span> : money(l.total)}</span>)}
                  </div>
                )}
                {l.quitar && <div className="warn-txt small">Se quitará del PO al guardar.</div>}
              </div>
            ))}
          </div>
          {po.total !== undefined && <div className="row between total"><span>Total a pagar al taller</span><span>{po.total == null ? <span className="warn-txt">falta un costo</span> : money(po.total)}</span></div>}
          {po.instrucciones && po.status !== 'borrador' && <div className="small"><strong>Instrucciones:</strong> {po.instrucciones}</div>}

          {po.status === 'borrador' && puedeMandar && (
            <>
              <label className="field"><span>Instrucciones para el taller</span>
                <textarea rows={3} defaultValue={po.instrucciones || ''} onBlur={(e) => e.target.value !== (po.instrucciones || '') && paso(async () => refrescar(await api.put(`/po/${po.id}`, { instrucciones: e.target.value })))} />
              </label>
              {edit && <button className="btn" disabled={busy} onClick={() => paso(async () => refrescar(await api.put(`/po/${po.id}`, { lineas: edit })), 'Costos guardados')}>Guardar costos</button>}
              {po.faltanCostos?.length > 0 && !edit && <p className="warn-txt small">Falta el costo de: {po.faltanCostos.join('; ')}.</p>}
              <div className="row gap wrap">
                <button className="btn primary" disabled={busy || !!edit || po.faltanCostos?.length > 0} title={edit ? 'Guarda primero los costos' : ''} onClick={() => paso(async () => refrescar(await api.post(`/po/${po.id}/enviar`)), 'PO listo: copia el enlace o el PDF y mándaselo al taller. La orden pasó a Producción.')}>✓ Mandar a producción</button>
                <button className="btn danger-ghost" disabled={busy} onClick={() => confirm('¿Descartar este borrador de PO?') && paso(async () => { await api.post(`/po/${po.id}/cancelar`, {}); await refrescar(); }, 'Borrador descartado')}>Descartar</button>
              </div>
              <p className="muted small">Al mandar a producción se genera el enlace y el PDF para el taller. Tú se lo envías; la app no manda correos.</p>
            </>
          )}

          {po.status !== 'borrador' && (
            <div className="row gap wrap">
              <button className="btn primary" onClick={() => copiar(enlaceTaller(po), 'Enlace del taller copiado: pégalo en WhatsApp o en un correo')}>Copiar enlace del taller</button>
              {po.total !== undefined && <a className="btn" href={`/api/po/${po.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>}
              <a className="btn ghost" href={enlaceTaller(po)} target="_blank" rel="noreferrer">Ver como el taller ↗</a>
            </div>
          )}
          {puedeMandar && ['enviado', 'recibido'].includes(po.status) && (
            <div className="row gap wrap small">
              <span className="muted">Si el taller no usa el enlace:</span>
              {po.status === 'enviado' && <button className="link-btn" disabled={busy} onClick={() => paso(async () => refrescar(await api.post(`/po/${po.id}/estado`, { estado: 'recibido' })), 'Marcado como recibido')}>Marcar recibido</button>}
              <button className="link-btn" disabled={busy} onClick={() => paso(async () => refrescar(await api.post(`/po/${po.id}/estado`, { estado: 'terminado' })), 'Terminado: la orden pasó a Calidad')}>Marcar terminado</button>
              <button className="link-btn danger" disabled={busy} onClick={() => { const motivo = prompt('¿Por qué se cancela este PO? (el taller ya lo tiene)'); if (motivo) paso(async () => { await api.post(`/po/${po.id}/cancelar`, { motivo }); await refrescar(); }, 'PO cancelado'); }}>Cancelar PO</button>
            </div>
          )}

          {listaCompra.length > 0 && (
            <div className="po-compra">
              <button className="link-btn" onClick={() => setVerCompra(!verCompra)}>{verCompra ? '▾' : '▸'} Prendas a pedir en SanMar ({listaCompra.reduce((a, x) => a + x.cantidad, 0)} pzs, envío directo al taller)</button>
              {verCompra && (
                <>
                  <div className="small">Enviar a: <strong>{po.taller?.name}</strong>{po.taller?.address ? ` · ${po.taller.address}` : <span className="warn-txt"> · falta la dirección del taller</span>}</div>
                  <table className="table mini-table"><thead><tr><th>Estilo</th><th>Color</th><th>Talla</th><th className="num">Cant.</th></tr></thead>
                    <tbody>{listaCompra.map((x, i) => <tr key={i}><td>{x.codigo || x.descripcion}</td><td>{x.color}</td><td>{x.talla}</td><td className="num">{x.cantidad}</td></tr>)}</tbody></table>
                  <button className="btn" onClick={() => copiar(textoCompra(), 'Lista copiada')}>Copiar lista</button>
                  <p className="muted small">La app no hace el pedido en SanMar: es la lista para quien compra.</p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
