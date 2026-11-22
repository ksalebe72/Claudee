import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fmtDate, today, useLoad } from '../utils.js';
import { Empty, PageHeader } from '../components/ui.jsx';

export default function Tasks() {
  const [showAll, setShowAll] = useState(false);
  const [tasks, reload] = useLoad(() => api.get(`/tasks${showAll ? '?all=1' : ''}`), [showAll]);
  const [contacts] = useLoad(() => api.get('/contacts'));
  const [f, setF] = useState({ title: '', due_date: today(), assignee: '', contact_id: '' });

  async function add(e) {
    e.preventDefault();
    if (!f.title) return;
    await api.post('/tasks', { ...f, contact_id: f.contact_id || null });
    setF({ ...f, title: '' });
    reload();
  }
  const toggle = async (t) => { await api.put(`/tasks/${t.id}`, { done: !t.done }); reload(); };
  const remove = async (t) => { await api.del(`/tasks/${t.id}`); reload(); };

  const groups = { Atrasadas: [], Hoy: [], Próximas: [], 'Sin fecha': [], Hechas: [] };
  for (const t of tasks || []) {
    if (t.done) groups.Hechas.push(t);
    else if (!t.due_date) groups['Sin fecha'].push(t);
    else if (t.due_date < today()) groups.Atrasadas.push(t);
    else if (t.due_date === today()) groups.Hoy.push(t);
    else groups.Próximas.push(t);
  }

  return (
    <>
      <PageHeader title="Tareas" subtitle="Seguimientos, llamadas y pendientes del equipo">
        <label className="inline"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Mostrar hechas</label>
      </PageHeader>
      <form className="card row gap wrap" onSubmit={add}>
        <input className="grow" placeholder="Nueva tarea…" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        <input placeholder="Responsable" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} />
        <select value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}>
          <option value="">Sin contacto</option>
          {contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn primary">Agregar</button>
      </form>
      {tasks?.length === 0 && <Empty>No hay tareas pendientes.</Empty>}
      {Object.entries(groups).filter(([, l]) => l.length).map(([g, list]) => (
        <section key={g} className="card">
          <h3 className={g === 'Atrasadas' ? 'danger' : ''}>{g} <span className="muted">({list.length})</span></h3>
          <ul className="checklist">
            {list.map((t) => (
              <li key={t.id} className={t.done ? 'done' : ''}>
                <label><input type="checkbox" checked={!!t.done} onChange={() => toggle(t)} /> {t.title}</label>
                <span className="muted small">
                  {t.contact_name && <Link to={`/contactos/${t.contact_id}`}>{t.contact_name}</Link>}
                  {t.job_id && <> · <Link to={`/trabajos/${t.job_id}`}>{t.order_number || t.job_number}</Link></>}
                  {t.assignee && ` · ${t.assignee}`} · {fmtDate(t.due_date)}
                </span>
                <button className="icon-btn" onClick={() => remove(t)}>×</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
