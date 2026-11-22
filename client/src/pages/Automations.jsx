import React, { useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, label, useLoad } from '../utils.js';
import { Field, Modal, PageHeader, useMeta } from '../components/ui.jsx';

const VARS = ['{{contact.name}}', '{{contact.company}}', '{{job.number}}', '{{job.order_number}}', '{{job.title}}', '{{job.total}}', '{{job.link}}', '{{proof.customer_comment}}', '{{business.name}}'];

export default function Automations() {
  const meta = useMeta();
  const [list, reload] = useLoad(() => api.get('/automations'));
  const [edit, setEdit] = useState(null);

  async function toggle(a) { await api.put(`/automations/${a.id}`, { active: !a.active }); reload(); }
  async function save(e) {
    e.preventDefault();
    const body = { ...edit, condition: edit.condTo ? { to: edit.condTo } : {} };
    delete body.condTo;
    if (edit.id) await api.put(`/automations/${edit.id}`, body); else await api.post('/automations', body);
    setEdit(null); reload();
  }
  async function remove() { if (confirm('¿Eliminar automatización?')) { await api.del(`/automations/${edit.id}`); setEdit(null); reload(); } }
  const setP = (k, v) => setEdit({ ...edit, params: { ...edit.params, [k]: v } });

  const byTrigger = {};
  for (const a of list || []) (byTrigger[a.trigger] ||= []).push(a);

  return (
    <>
      <PageHeader title="Automatizaciones" subtitle="Cuando pasa algo → la app hace algo. Igual que los workflows de un CRM, pero conectado con tu producción.">
        <button className="btn primary" onClick={() => setEdit({ name: '', trigger: 'contact.created', action: 'create_task', params: {}, condTo: '', active: 1 })}>+ Automatización</button>
      </PageHeader>
      {Object.entries(meta.triggers).filter(([t]) => byTrigger[t]).map(([t, tl]) => (
        <section key={t} className="card">
          <h3>⚡ {tl}</h3>
          <ul className="auto-list">
            {byTrigger[t].map((a) => (
              <li key={a.id} className={a.active ? '' : 'off'}>
                <label className="switch"><input type="checkbox" checked={!!a.active} onChange={() => toggle(a)} /><span /></label>
                <div className="grow clickable" onClick={() => setEdit({ ...a, condTo: a.condition?.to || '' })}>
                  <strong>{a.name}</strong>
                  <div className="muted small">
                    {a.condition?.to && <>si pasa a «{label(a.condition.to)}» → </>}
                    {meta.actions[a.action]}
                    {a.params?.message && <>: “{a.params.message}”</>}
                    {a.params?.title && <>: “{a.params.title}”</>}
                    {a.params?.status && <>: {label(a.params.status)}</>}
                    {a.params?.stage && <>: {label(a.params.stage)}</>}
                    {a.params?.tag && <>: {a.params.tag}</>}
                  </div>
                </div>
                <span className="muted small">{a.runs} ejecuciones{a.last_run ? ` · última ${fmtDateTime(a.last_run)}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {edit && (
        <Modal title={edit.id ? 'Editar automatización' : 'Nueva automatización'} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Nombre"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Describe qué hace" /></Field>
            <div className="form-grid">
              <Field label="Cuando… (disparador)">
                <select value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value })}>
                  {Object.entries(meta.triggers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              {['order.status_changed', 'opportunity.stage_changed'].includes(edit.trigger) && (
                <Field label="…y el nuevo estado es">
                  <select value={edit.condTo} onChange={(e) => setEdit({ ...edit, condTo: e.target.value })}>
                    <option value="">Cualquiera</option>
                    {(edit.trigger === 'order.status_changed' ? meta.orderStatuses : meta.oppStages).map((s) => <option key={s} value={s}>{label(s)}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Entonces… (acción)">
                <select value={edit.action} onChange={(e) => setEdit({ ...edit, action: e.target.value, params: {} })}>
                  {Object.entries(meta.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
            </div>

            {edit.action === 'create_task' && (
              <div className="form-grid">
                <Field label="Título de la tarea"><input value={edit.params.title || ''} onChange={(e) => setP('title', e.target.value)} /></Field>
                <Field label="Vence en (días)"><input type="number" value={edit.params.due_in_days ?? 1} onChange={(e) => setP('due_in_days', Number(e.target.value))} /></Field>
                <Field label="Responsable"><input value={edit.params.assignee || ''} onChange={(e) => setP('assignee', e.target.value)} /></Field>
              </div>
            )}
            {(edit.action === 'send_sms' || edit.action === 'send_email') && (
              <>
                {edit.action === 'send_email' && <Field label="Asunto"><input value={edit.params.subject || ''} onChange={(e) => setP('subject', e.target.value)} /></Field>}
                <Field label="Mensaje" hint={`Variables: ${VARS.join(' ')}`}><textarea rows={3} value={edit.params.message || ''} onChange={(e) => setP('message', e.target.value)} /></Field>
              </>
            )}
            {edit.action === 'set_order_status' && (
              <Field label="Nuevo estado"><select value={edit.params.status || ''} onChange={(e) => setP('status', e.target.value)}>
                <option value="">—</option>{meta.orderStatuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
            )}
            {edit.action === 'move_opportunity' && (
              <Field label="Etapa"><select value={edit.params.stage || ''} onChange={(e) => setP('stage', e.target.value)}>
                <option value="">—</option>{meta.oppStages.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
            )}
            {edit.action === 'add_tag' && <Field label="Etiqueta"><input value={edit.params.tag || ''} onChange={(e) => setP('tag', e.target.value)} /></Field>}

            <div className="row between">
              {edit.id ? <button type="button" className="btn danger-ghost" onClick={remove}>Eliminar</button> : <span />}
              <button className="btn primary">Guardar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
