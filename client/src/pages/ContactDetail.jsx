import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, fmtDateTime, today, useLoad } from '../utils.js';
import { Badge, Empty, PageHeader, useToast } from '../components/ui.jsx';
import { ContactForm } from './Contacts.jsx';

const CHANNELS = [
  { id: 'nota', label: 'Nota interna' },
  { id: 'sms', label: 'SMS' },
  { id: 'email', label: 'Email' },
  { id: 'llamada', label: 'Llamada' },
];

export default function ContactDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, reload] = useLoad(() => api.get(`/contacts/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [channel, setChannel] = useState('nota');
  const [msg, setMsg] = useState('');
  const [task, setTask] = useState({ title: '', due_date: today() });
  const [toast, notify] = useToast();

  if (!c) return <div className="loading">Cargando…</div>;

  async function send(e) {
    e.preventDefault();
    if (!msg.trim()) return;
    const direction = channel === 'sms' || channel === 'email' ? 'saliente' : 'interno';
    await api.post(`/contacts/${id}/activities`, { type: channel, body: msg, direction });
    setMsg('');
    notify(direction === 'saliente' ? 'Mensaje registrado' : 'Guardado');
    reload();
  }
  async function addTask(e) {
    e.preventDefault();
    if (!task.title) return;
    await api.post('/tasks', { ...task, contact_id: c.id });
    setTask({ title: '', due_date: today() });
    reload();
  }
  async function toggleTask(t) { await api.put(`/tasks/${t.id}`, { done: !t.done }); reload(); }
  async function remove() {
    if (!confirm(`¿Eliminar a ${c.name} y su historial?`)) return;
    await api.del(`/contacts/${c.id}`);
    nav('/contactos');
  }

  return (
    <>
      <PageHeader title={c.name} subtitle={[c.company, c.source && `Origen: ${c.source}`].filter(Boolean).join(' · ')}>
        <button className="btn" onClick={() => setEdit(true)}>Editar</button>
        <button className="btn danger-ghost" onClick={remove}>Eliminar</button>
        <Link className="btn primary" to={`/trabajos/nuevo?contact=${c.id}`}>+ Cotización</Link>
      </PageHeader>

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <h3>Datos</h3>
            <dl className="dl">
              <dt>Teléfono</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : '—'}</dd>
              <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
              <dt>Dirección</dt><dd>{c.address || '—'}</dd>
              <dt>Etiquetas</dt><dd>{(c.tags || []).map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}</dd>
              <dt>Cliente desde</dt><dd>{fmtDate(c.created_at)}</dd>
            </dl>
            {c.notes && <p className="note">{c.notes}</p>}
          </section>

          <section className="card">
            <div className="card-head"><h3>Oportunidades</h3><Link to="/pipeline">Pipeline →</Link></div>
            {c.opportunities.length === 0 && <Empty>Sin oportunidades</Empty>}
            <ul className="list">{c.opportunities.map((o) => <li key={o.id}><span>{o.title}</span><span>{money(o.value)}</span><Badge status={o.stage} /></li>)}</ul>
          </section>

          <section className="card">
            <h3>Cotizaciones y órdenes</h3>
            {c.jobs.length === 0 && <Empty>Sin trabajos todavía</Empty>}
            <ul className="list">
              {c.jobs.map((j) => (
                <li key={j.id}>
                  <Link to={`/trabajos/${j.id}`}><strong>{j.order_number || j.number}</strong> {j.title}</Link>
                  <span>{money(j.total)}</span>
                  <Badge status={j.status} />
                </li>
              ))}
            </ul>
          </section>

          {c.historial?.length > 0 && <HistorialDeco historial={c.historial} />}
          <section className="card">
            <h3>Tareas</h3>
            <form className="row gap" onSubmit={addTask}>
              <input placeholder="Nueva tarea…" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
              <input type="date" value={task.due_date} onChange={(e) => setTask({ ...task, due_date: e.target.value })} />
              <button className="btn">Agregar</button>
            </form>
            <ul className="checklist">
              {c.tasks.map((t) => (
                <li key={t.id} className={t.done ? 'done' : ''}>
                  <label><input type="checkbox" checked={!!t.done} onChange={() => toggleTask(t)} /> {t.title}</label>
                  <span className="muted">{fmtDate(t.due_date)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card conversation">
          <h3>Conversación</h3>
          <form onSubmit={send} className="composer">
            <div className="tabs">
              {CHANNELS.map((ch) => (
                <button type="button" key={ch.id} className={channel === ch.id ? 'active' : ''} onClick={() => setChannel(ch.id)}>{ch.label}</button>
              ))}
            </div>
            <textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)}
              placeholder={channel === 'sms' ? `SMS a ${c.phone || '(sin teléfono)'}` : channel === 'email' ? `Email a ${c.email || '(sin email)'}` : channel === 'llamada' ? 'Resumen de la llamada…' : 'Nota interna (el cliente no la ve)…'} />
            <div className="row end"><button className="btn primary">{channel === 'sms' || channel === 'email' ? 'Enviar' : 'Guardar'}</button></div>
          </form>
          <ul className="timeline">
            {c.activities.map((a) => (
              <li key={a.id} className={`dir-${a.direction}`}>
                <span className={`dot type-${a.type}`} />
                <div className="bubble">
                  <div className="bubble-meta">
                    <strong>{a.type}</strong>{a.direction !== 'interno' && ` · ${a.direction}`}{a.status && ` · ${a.status}`} · {fmtDateTime(a.created_at)}
                  </div>
                  <div className="pre">{a.body}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {edit && <ContactForm contact={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {toast}
    </>
  );
}

/** Compras anteriores traídas de DecoNetwork (tal como vinieron; sin costos). */
function HistorialDeco({ historial }) {
  const [abierta, setAbierta] = useState(null);
  const conMontos = historial.some((o) => o.total != null);
  const total = historial.reduce((a, o) => a + (o.ventas || 0), 0);
  const ultima = historial[0]?.fecha;
  return (
    <section className="card">
      <div className="card-head"><h3>Compras anteriores · DecoNetwork</h3><span className="badge tone-violet">{historial.length} orden(es)</span></div>
      <p className="muted small">Última compra: {fmtDate(ultima)}{conMontos ? <> · Vendido sin impuesto: <strong>{money(total)}</strong></> : null}</p>
      <table className="table mini-table">
        <thead><tr><th>Orden Deco</th><th>Fecha</th><th>Trabajo</th><th className="num">Piezas</th>{conMontos && <th className="num">Total</th>}</tr></thead>
        <tbody>
          {historial.slice(0, 50).map((o) => (
            <React.Fragment key={o.id}>
              <tr className="clic" onClick={() => setAbierta(abierta === o.id ? null : o.id)}>
                <td>#{o.numero}{o.tienda && o.tienda !== 'Color Plus' ? <span className="muted small"> · {o.tienda}</span> : null}</td>
                <td>{fmtDate(o.fecha)}</td><td className="small">{o.trabajo || '—'}</td><td className="num">{o.unidades}</td>
                {conMontos && <td className="num">{money(o.total)}</td>}
              </tr>
              {abierta === o.id && (
                <tr><td colSpan={conMontos ? 5 : 4}>
                  <ul className="lista-hist">{o.lineas.map((l, i) => (
                    <li key={i}><strong>{l.cantidad} × {l.producto}</strong>{l.color ? ` · ${l.color}` : ''}
                      {l.tallas && Object.keys(l.tallas).length ? <span className="muted small"> · {Object.entries(l.tallas).map(([t, n]) => `${t}:${n}`).join(' ')}</span> : null}
                      {l.decoracion ? <div className="muted small">{l.decoracion}</div> : null}
                      {conMontos && l.total != null ? <span className="num"> {money(l.total)}</span> : null}</li>
                  ))}</ul>
                </td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {historial.length > 50 && <p className="muted small">Mostrando las 50 más recientes de {historial.length}.</p>}
    </section>
  );
}
