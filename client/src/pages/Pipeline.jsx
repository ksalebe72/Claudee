import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, label, useLoad } from '../utils.js';
import { Field, Kanban, Modal, PageHeader, useMeta } from '../components/ui.jsx';

export default function Pipeline() {
  const meta = useMeta();
  const [opps, reload, setOpps] = useLoad(() => api.get('/opportunities'));
  const [contacts] = useLoad(() => api.get('/contacts'));
  const [form, setForm] = useState(null);

  async function move(o, stage) {
    setOpps(opps.map((x) => (x.id === o.id ? { ...x, stage } : x)));
    await api.put(`/opportunities/${o.id}`, { stage });
    reload();
  }
  async function save(e) {
    e.preventDefault();
    if (form.id) await api.put(`/opportunities/${form.id}`, form);
    else await api.post('/opportunities', form);
    setForm(null);
    reload();
  }
  async function remove() {
    if (!confirm('¿Eliminar oportunidad?')) return;
    await api.del(`/opportunities/${form.id}`);
    setForm(null);
    reload();
  }

  const open = (opps || []).filter((o) => !['ganado', 'perdido'].includes(o.stage));
  return (
    <>
      <PageHeader title="Pipeline de ventas" subtitle={`${open.length} oportunidades abiertas · ${money(open.reduce((a, o) => a + o.value, 0))}`}>
        <button className="btn primary" onClick={() => setForm({ title: '', value: '', contact_id: '', stage: 'nuevo' })}>+ Oportunidad</button>
      </PageHeader>
      {opps && (
        <Kanban
          columns={meta.oppStages.map((s) => ({ id: s, title: label(s) }))}
          items={opps}
          getColumn={(o) => o.stage}
          onMove={move}
          columnFooter={(list) => money(list.reduce((a, o) => a + o.value, 0))}
          renderCard={(o) => (
            <div onClick={() => setForm(o)} className="clickable">
              <strong>{o.title}</strong>
              <div className="muted">{o.contact_name}{o.contact_company ? ` · ${o.contact_company}` : ''}</div>
              <div className="row between"><span>{money(o.value)}</span>
                {o.contact_id && <Link onClick={(e) => e.stopPropagation()} to={`/trabajos/nuevo?contact=${o.contact_id}&opp=${o.id}`}>Cotizar →</Link>}
              </div>
            </div>
          )}
        />
      )}
      {form && (
        <Modal title={form.id ? 'Editar oportunidad' : 'Nueva oportunidad'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Título *"><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
            <div className="form-grid">
              <Field label="Contacto">
                <select value={form.contact_id || ''} onChange={(e) => setForm({ ...form, contact_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Valor"><input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
              <Field label="Etapa">
                <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                  {meta.oppStages.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
            </div>
            <div className="row between">
              {form.id ? <button type="button" className="btn danger-ghost" onClick={remove}>Eliminar</button> : <span />}
              <div className="row gap"><button type="button" className="btn" onClick={() => setForm(null)}>Cancelar</button><button className="btn primary">Guardar</button></div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
