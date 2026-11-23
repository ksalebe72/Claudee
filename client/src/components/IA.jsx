import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Modal } from './ui.jsx';

const PROCESOS = { bordado: 'Bordado', dtf: 'DTF', heat_transfer: 'Heat Transfer', sin_definir: 'Sin definir' };

// ---------- Markdown mínimo y seguro (sin HTML) ----------
function inline(text, key) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>
    : p.startsWith('`') && p.endsWith('`') ? <code key={`${key}-${i}`}>{p.slice(1, -1)}</code> : p));
}
export function Markdown({ text }) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;
      const cells = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      out.push(<table key={i} className="table md-table"><thead><tr>{cells[0].map((c, j) => <th key={j}>{inline(c, `h${j}`)}</th>)}</tr></thead>
        <tbody>{cells.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, `c${k}${j}`)}</td>)}</tr>)}</tbody></table>);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items = [];
      const ordered = /^\s*\d+\./.test(l);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      i--;
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={i}>{items.map((it, k) => <li key={k}>{inline(it, `l${k}`)}</li>)}</L>);
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(<h4 key={i}>{inline(l.replace(/^#+\s/, ''), `t${i}`)}</h4>);
    } else if (l.trim()) {
      out.push(<p key={i}>{inline(l, `p${i}`)}</p>);
    }
  }
  return <div className="markdown">{out}</div>;
}

export const IABadge = () => <span className="ia-badge">✨ IA</span>;

// ---------- Cotizar desde un mensaje ----------
export function CotizarIAModal({ onClose, notify }) {
  const nav = useNavigate();
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [b, setB] = useState(null);
  const [products, setProducts] = useState([]);
  const [usarExistente, setUsarExistente] = useState(true);
  useEffect(() => { api.get('/products').then(setProducts).catch(() => {}); }, []);

  async function analizar() {
    setBusy(true);
    try { const r = await api.post('/ia/cotizar', { texto }); setB(r); setUsarExistente(!!r.clienteExistente); } catch (e) { notify(e.message, true); }
    setBusy(false);
  }
  const setLinea = (i, patch) => setB({ ...b, lineas: b.lineas.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  async function crear() {
    setBusy(true);
    try {
      let contactId = usarExistente ? b.clienteExistente?.id : null;
      if (!contactId && (b.cliente.nombre || b.cliente.empresa)) {
        const c = await api.post('/contacts', { name: b.cliente.nombre || b.cliente.empresa, company: b.cliente.empresa || '', email: b.cliente.email || '', phone: b.cliente.telefono || '', source: 'Cotización con IA' });
        contactId = c.id;
      }
      const sinDefinir = [];
      const items = b.lineas.map((l) => {
        const p = products.find((x) => x.id === l.productoId);
        const sizes = Object.fromEntries(l.tallas.map((t) => [t.talla, t.cantidad]));
        const decorations = l.decoraciones.filter((d) => {
          if (d.proceso === 'sin_definir') { sinDefinir.push(`${l.descripcion}: ${d.ubicacion}`); return false; }
          return true;
        }).map((d) => ({ process: d.proceso, location: d.ubicacion, ...(d.proceso === 'dtf' ? { width: d.ancho ?? '', height: d.alto ?? '' } : {}), ...(d.proceso === 'heat_transfer' ? { sheets: 1 } : {}) }));
        return {
          product_id: p?.id || null, description: p ? p.name : l.descripcion, color: l.color || p?.colors?.[0] || '',
          sizes, qty: Object.keys(sizes).length ? 0 : l.cantidadSinTalla || 0, decorations,
          ...(p ? {} : { unit_cost: '' }),
        };
      });
      const notas = [
        b.notas,
        sinDefinir.length ? `Decoración por definir: ${sinDefinir.join('; ')}` : null,
        b.dudas.length ? `Preguntar al cliente:\n- ${b.dudas.join('\n- ')}` : null,
        'Borrador creado con IA desde el mensaje del cliente; revisa antes de enviar.',
      ].filter(Boolean).join('\n\n');
      const q = await api.post('/jobs', { contact_id: contactId, title: b.titulo, due_date: b.fechaEntrega, notes: notas, items });
      notify('Borrador de cotización creado. Revisa precios y datos antes de enviar.');
      nav(`/trabajos/${q.id}`);
      onClose();
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  }

  return (
    <Modal title="✨ Cotizar desde un mensaje" onClose={onClose} wide>
      {!b ? (
        <div className="stack-sm">
          <p className="muted small">Pega el email, SMS o WhatsApp del cliente. La IA arma un borrador con prendas, tallas, decoraciones y fecha; los precios los calcula la matriz de Color Plus. Nada se guarda hasta que pulses «Crear borrador».</p>
          <textarea rows={10} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: Hola, necesito 40 polos navy con el logo bordado en el pecho izquierdo: 10 M, 20 L, 10 XL. ¿Los pueden tener para el 15 de diciembre?" />
          <div className="row between"><span className="muted small">El texto se envía a la IA de Anthropic para procesarlo.</span><button className="btn primary" disabled={busy || texto.trim().length < 10} onClick={analizar}>{busy ? 'Analizando…' : 'Analizar mensaje'}</button></div>
        </div>
      ) : (
        <div className="stack-sm">
          <section className="ia-review">
            <h4>Cliente</h4>
            {b.clienteExistente ? (
              <div className="stack-sm">
                <label className="inline"><input type="radio" checked={usarExistente} onChange={() => setUsarExistente(true)} /> Usar el contacto existente: <strong>{b.clienteExistente.name}</strong> {b.clienteExistente.company && `(${b.clienteExistente.company})`}</label>
                <label className="inline"><input type="radio" checked={!usarExistente} onChange={() => setUsarExistente(false)} /> Crear un contacto nuevo</label>
              </div>
            ) : <p className="muted small">No coincide con ningún contacto; se creará uno nuevo.</p>}
            {(!b.clienteExistente || !usarExistente) && (
              <div className="form-grid">
                {['nombre', 'empresa', 'email', 'telefono'].map((k) => (
                  <label key={k} className="field"><span>{k[0].toUpperCase() + k.slice(1)}</span><input value={b.cliente[k] || ''} onChange={(e) => setB({ ...b, cliente: { ...b.cliente, [k]: e.target.value } })} /></label>
                ))}
              </div>
            )}
          </section>
          <section className="ia-review">
            <div className="form-grid">
              <label className="field"><span>Título</span><input value={b.titulo} onChange={(e) => setB({ ...b, titulo: e.target.value })} /></label>
              <label className="field"><span>Fecha de entrega</span><input type="date" value={b.fechaEntrega || ''} onChange={(e) => setB({ ...b, fechaEntrega: e.target.value || null })} /></label>
            </div>
          </section>
          <section className="ia-review">
            <h4>Prendas</h4>
            {b.lineas.map((l, i) => (
              <div key={i} className="ia-line">
                <div className="row gap wrap">
                  <select value={l.productoId || ''} onChange={(e) => setLinea(i, { productoId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— Sin producto del catálogo ({l.descripcion}) —</option>
                    {products.filter((p) => p.kind !== 'servicio').map((p) => <option key={p.id} value={p.id}>{p.brand} {p.sku} · {p.name}</option>)}
                  </select>
                  <span>{l.color || ''}</span>
                  <button className="icon-btn" onClick={() => setB({ ...b, lineas: b.lineas.filter((_, j) => j !== i) })} title="Quitar">×</button>
                </div>
                <div className="small">
                  <strong>Tallas:</strong> {l.tallas.length ? l.tallas.map((t) => `${t.talla}: ${t.cantidad}`).join(' · ') : l.cantidadSinTalla ? `${l.cantidadSinTalla} piezas (sin distribución por talla)` : <span className="warn-txt">sin cantidades</span>}
                  {l.tallasNoReconocidas?.length > 0 && <span className="warn-txt"> · no reconocidas: {l.tallasNoReconocidas.join(', ')}</span>}
                </div>
                <div className="small"><strong>Decoración:</strong> {l.decoraciones.length ? l.decoraciones.map((d) => `${PROCESOS[d.proceso]} ${d.ubicacion}${d.ancho && d.alto ? ` ${d.ancho}×${d.alto}"` : ''}`).join(' · ') : '—'}</div>
                {!l.productoId && <div className="small warn-txt">Sin producto: el costo quedará desconocido hasta que elijas la prenda.</div>}
              </div>
            ))}
          </section>
          {(b.dudas.length > 0 || b.notas) && (
            <section className="ia-review">
              {b.dudas.length > 0 && <><h4>Falta preguntar al cliente</h4><ul>{b.dudas.map((d) => <li key={d}>{d}</li>)}</ul></>}
              {b.notas && <p className="small"><strong>Notas:</strong> {b.notas}</p>}
            </section>
          )}
          <div className="row between">
            <button className="btn" onClick={() => setB(null)}>← Volver al mensaje</button>
            <button className="btn primary" disabled={busy || !b.lineas.length} onClick={crear}>{busy ? 'Creando…' : 'Crear borrador de cotización'}</button>
          </div>
          <p className="muted small">Los precios los calcula la matriz al crear el borrador. La IA puede equivocarse: revisa tallas, ubicaciones y producto.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------- Redactar un mensaje ----------
export function RedactarIAModal({ job, onClose, notify, onSaved }) {
  const [tipos, setTipos] = useState(null);
  const [f, setF] = useState({ tipo: job.kind === 'order' ? (job.status === 'aprobacion' ? 'aprobar_arte' : job.status === 'listo' ? 'orden_lista' : 'libre') : job.status === 'enviada' ? 'seguimiento_cotizacion' : 'enviar_cotizacion', idioma: job.idioma || job.contact?.idioma || 'es', instrucciones: '' });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/ia/estado').then((e) => setTipos(e.tiposMensaje)).catch(() => {}); }, []);
  async function generar() {
    setBusy(true);
    try { setRes(await api.post('/ia/redactar', { jobId: job.id, ...f })); } catch (e) { notify(e.message, true); }
    setBusy(false);
  }
  async function guardar() {
    try { await api.post('/ia/guardar-nota', { jobId: job.id, asunto: res.asunto, mensaje: res.mensaje }); notify('Guardado como nota en la conversación del cliente'); onSaved?.(); } catch (e) { notify(e.message, true); }
  }
  const copiar = () => { navigator.clipboard?.writeText(res.canalSugerido === 'email' ? `${res.asunto}\n\n${res.mensaje}` : res.mensaje); notify('Copiado'); };
  return (
    <Modal title="✨ Redactar mensaje al cliente" onClose={onClose}>
      <div className="stack-sm">
        <div className="form-grid">
          <label className="field"><span>Tipo de mensaje</span>
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{tipos && Object.entries(tipos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field"><span>Idioma</span>
            <select value={f.idioma} onChange={(e) => setF({ ...f, idioma: e.target.value })}><option value="es">Español</option><option value="en">Inglés</option></select>
          </label>
        </div>
        <label className="field"><span>Instrucciones (opcional)</span><input value={f.instrucciones} onChange={(e) => setF({ ...f, instrucciones: e.target.value })} placeholder="Ej.: recuérdale que el anticipo es del 50%" /></label>
        <div className="row end"><button className="btn primary" disabled={busy} onClick={generar}>{busy ? 'Redactando…' : res ? 'Volver a generar' : 'Generar borrador'}</button></div>
        {res && (
          <div className="stack-sm">
            {res.canalSugerido === 'email' && <label className="field"><span>Asunto</span><input value={res.asunto} onChange={(e) => setRes({ ...res, asunto: e.target.value })} /></label>}
            <label className="field"><span>Mensaje · sugerido para {res.canalSugerido === 'email' ? 'email' : res.canalSugerido === 'sms' ? 'SMS' : 'WhatsApp'}</span>
              <textarea rows={9} value={res.mensaje} onChange={(e) => setRes({ ...res, mensaje: e.target.value })} />
            </label>
            <div className="row gap end">
              <button className="btn" onClick={guardar}>Guardar como nota</button>
              <button className="btn primary" onClick={copiar}>Copiar</button>
            </div>
            <p className="muted small">Es un borrador: el sistema no lo envía. Revísalo, cópialo y envíalo desde tu correo o teléfono. La IA no recibe costos ni márgenes.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
