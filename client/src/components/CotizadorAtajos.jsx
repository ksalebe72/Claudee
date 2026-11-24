// Atajos del cotizador: buscador de cliente con «cliente nuevo» ahí mismo, productos pedidos antes y lista de pendientes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtDate, useLoad } from '../utils.js';
import { Modal } from './ui.jsx';
import { PROCESOS } from '../../../shared/pricing.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const etiqueta = (c) => (c ? `${c.name}${c.company ? ` (${c.company})` : ''}` : '');

/**
 * Un solo campo para el cliente: escribes y filtra por nombre, empresa, teléfono o email.
 * Si no existe, se crea ahí mismo con lo mínimo (nombre y teléfono o email) sin salir de la cotización.
 */
export function ClienteBuscador({ contacts, value, disabled, onPick, onCreated, notify }) {
  const actual = contacts?.find((c) => c.id === Number(value));
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState(null);
  const [busy, setBusy] = useState(false);
  const caja = useRef(null);

  useEffect(() => { setTexto(etiqueta(actual)); }, [actual?.id, actual?.name, actual?.company]);
  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) { setAbierto(false); setNuevo(null); setTexto(etiqueta(actual)); } };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [actual?.id]);

  const filtrados = useMemo(() => {
    const q = norm(texto === etiqueta(actual) ? '' : texto);
    const lista = (contacts || []).filter((c) => !q || [c.name, c.company, c.phone, c.email].some((v) => norm(v).includes(q)));
    return lista.slice(0, 8);
  }, [contacts, texto, actual?.id]);

  const elegir = (c) => { onPick(c); setAbierto(false); setNuevo(null); };
  async function crear(e) {
    e.preventDefault();
    if (!nuevo.name.trim()) return;
    setBusy(true);
    try {
      const c = await api.post('/contacts', { name: nuevo.name.trim(), company: nuevo.company.trim(), phone: nuevo.phone.trim(), email: nuevo.email.trim(), tags: [], source: 'Cotización' });
      onCreated(c); elegir(c); notify?.(`Cliente «${c.name}» creado`);
    } catch (err) { notify?.(err.message, true); }
    setBusy(false);
  }

  return (
    <div className="cliente-buscador" ref={caja}>
      <input value={texto} disabled={disabled} placeholder="Escribe el nombre, empresa o teléfono…" autoComplete="off"
        onFocus={(e) => { setAbierto(true); e.target.select(); }}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setNuevo(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (filtrados.length === 1) elegir(filtrados[0]); } if (e.key === 'Escape') { setAbierto(false); setTexto(etiqueta(actual)); } }} />
      {abierto && !disabled && (
        <div className="cliente-lista">
          {!nuevo && (
            <>
              <button type="button" className="cliente-nuevo-btn" onClick={() => setNuevo({ name: texto === etiqueta(actual) ? '' : texto, company: '', phone: '', email: '' })}>+ Cliente nuevo{texto && texto !== etiqueta(actual) ? ` «${texto}»` : ''}</button>
              {filtrados.length === 0 ? <div className="muted small cliente-vacio">Ningún cliente coincide.</div> : (
                <div className="tabla-desliza">
                  <table className="table mini-table cliente-tabla">
                    <thead><tr><th>Nombre</th><th>Empresa</th><th>Teléfono</th><th>Email</th></tr></thead>
                    <tbody>{filtrados.map((c) => (
                      <tr key={c.id} className={c.id === actual?.id ? 'activo' : ''} onMouseDown={(e) => { e.preventDefault(); elegir(c); }}>
                        <td><strong>{c.name}</strong></td><td>{c.company}</td><td>{c.phone}</td><td className="muted">{c.email}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {nuevo && (
            <form className="cliente-nuevo" onSubmit={crear}>
              <strong>Cliente nuevo</strong>
              <input autoFocus required placeholder="Nombre *" value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} />
              <input placeholder="Empresa" value={nuevo.company} onChange={(e) => setNuevo({ ...nuevo, company: e.target.value })} />
              <input placeholder="Teléfono" value={nuevo.phone} onChange={(e) => setNuevo({ ...nuevo, phone: e.target.value })} />
              <input type="email" placeholder="Email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
              <div className="row gap">
                <button className="btn primary" disabled={busy || !nuevo.name.trim()}>{busy ? 'Creando…' : 'Crear y usar'}</button>
                <button type="button" className="btn" onClick={() => setNuevo(null)}>Volver</button>
              </div>
              <small className="muted">Lo demás (dirección, idioma, etiquetas) lo completas después en su ficha.</small>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** Lo que el cliente ya pidió (app + DecoNetwork): un toque lo agrega con su color, tallas y decoración. */
export function PedidoAntesModal({ contactId, jobId, onAdd, onClose }) {
  const [lista, , , error] = useLoad(() => api.get(`/contacts/${contactId}/productos-previos?excluir=${jobId || 0}`), [contactId]);
  const [agregando, setAgregando] = useState(null);
  const [hechos, setHechos] = useState([]);
  const tallas = (t) => Object.entries(t || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k} ${n}`).join(' · ');
  async function agregar(p, i) {
    setAgregando(i);
    try { await onAdd(p); setHechos((h) => [...h, i]); } finally { setAgregando(null); }
  }
  return (
    <Modal title="Productos que este cliente ya pidió" onClose={onClose} wide>
      {error ? <p className="warn-txt">{error}</p> : !lista ? <div className="loading">Cargando…</div> : !lista.length ? <p className="muted">Este cliente todavía no tiene compras ni cotizaciones anteriores.</p> : (
        <>
          <p className="muted small">Se agregan con el color, las tallas y la decoración de la última vez, y se cotizan con las tarifas de hoy. Ajusta las cantidades después.</p>
          <div className="tabla-desliza">
            <table className="table mini-table">
              <thead><tr><th>Prenda</th><th>Color</th><th>Tallas la última vez</th><th>Decoración</th><th>Última vez</th><th /></tr></thead>
              <tbody>{lista.map((p, i) => (
                <tr key={i}>
                  <td className="wrap"><strong>{p.codigo ? `${p.codigo} · ` : ''}</strong>{p.descripcion}</td>
                  <td>{p.color || '—'}</td>
                  <td className="small">{tallas(p.tallas) || (p.cantidad ? `${p.cantidad} pzs` : '—')}</td>
                  <td className="small">{p.decoraciones.map((d) => `${PROCESOS[d.process] || d.process} ${d.location || ''}`).join(' + ') || '—'}{p.revisarDecoracion && <span className="warn-txt"> · revisa ubicación y tamaño</span>}</td>
                  <td className="small">{fmtDate(p.fecha)}<div className="muted">{p.de}</div></td>
                  <td><button className="btn" disabled={agregando != null} onClick={() => agregar(p, i)}>{agregando === i ? 'Agregando…' : hechos.includes(i) ? '✓ Agregar otra vez' : '+ Agregar'}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      <div className="row gap" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn primary" onClick={onClose}>Listo</button></div>
    </Modal>
  );
}

/** Lista corta de lo que falta para poder enviar la cotización (como «Incomplete items» de Deco). */
export function FaltaPorCompletar({ pendientes }) {
  if (!pendientes.length) return null;
  return (
    <section className="card falta-completar">
      <h3>Falta por completar</h3>
      <ul>{pendientes.map((p, i) => <li key={i}>{p}</li>)}</ul>
    </section>
  );
}
