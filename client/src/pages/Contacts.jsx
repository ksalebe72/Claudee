import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { money, useLoad } from '../utils.js';
import { Badge, Empty, Field, Modal, PageHeader } from '../components/ui.jsx';

export default function Contacts() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [list, reload] = useLoad(() => api.get(`/contacts?q=${encodeURIComponent(q)}`), [q]);
  const showNew = params.get('nuevo') === '1';

  return (
    <>
      <PageHeader title="Contactos" subtitle="Clientes, prospectos y empresas">
        <input className="search" placeholder="Buscar nombre, empresa, email, etiqueta…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" onClick={() => setParams({ nuevo: '1' })}>+ Nuevo contacto</button>
      </PageHeader>
      <div className="card no-pad">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Empresa</th><th>Teléfono</th><th>Email</th><th>Etiquetas</th><th>Origen</th><th className="num">Órdenes</th><th className="num">Valor</th></tr></thead>
          <tbody>
            {list?.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/contactos/${c.id}`}><strong>{c.name}</strong></Link></td>
                <td>{c.company}</td>
                <td>{c.phone}</td>
                <td>{c.email}</td>
                <td>{(c.tags || []).map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}</td>
                <td className="muted">{c.source}</td>
                <td className="num">{c.orders_count}</td>
                <td className="num">{money(c.lifetime_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list?.length === 0 && <Empty>No hay contactos.</Empty>}
      </div>
      {showNew && <ContactForm onClose={() => setParams({})} onSaved={() => { setParams({}); reload(); }} />}
    </>
  );
}

export function ContactForm({ contact, onClose, onSaved }) {
  const nav = useNavigate();
  const [f, setF] = useState(contact ? { ...contact, tags: (contact.tags || []).join(', ') } : { name: '', company: '', email: '', phone: '', tags: '', source: '', address: '', notes: '', oppTitle: '', oppValue: '' });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    try {
      const body = { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) };
      if (contact) {
        await api.put(`/contacts/${contact.id}`, body);
        onSaved();
      } else {
        if (f.oppTitle) body.opportunity = { title: f.oppTitle, value: f.oppValue };
        const c = await api.post('/contacts', body);
        onSaved();
        nav(`/contactos/${c.id}`);
      }
    } catch (e2) { setErr(e2.message); }
  }

  return (
    <Modal title={contact ? 'Editar contacto' : 'Nuevo contacto'} onClose={onClose}>
      <form onSubmit={save} className="form">
        <div className="form-grid">
          <Field label="Nombre *"><input required value={f.name} onChange={set('name')} autoFocus /></Field>
          <Field label="Empresa"><input value={f.company || ''} onChange={set('company')} /></Field>
          <Field label="Teléfono"><input value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
          <Field label="Etiquetas" hint="Separadas por coma"><input value={f.tags} onChange={set('tags')} /></Field>
          <Field label="Origen"><input value={f.source || ''} onChange={set('source')} placeholder="Instagram, referido, Google…" list="sources" /></Field>
        </div>
        <datalist id="sources">{['Instagram', 'Facebook', 'Google Ads', 'Referido', 'Sitio web', 'Visita a tienda', 'Llamada'].map((s) => <option key={s} value={s} />)}</datalist>
        <Field label="Dirección"><input value={f.address || ''} onChange={set('address')} /></Field>
        <label className="inline"><input type="checkbox" checked={!!f.tax_exempt} onChange={(e) => setF({ ...f, tax_exempt: e.target.checked ? 1 : 0 })} /> Exento de impuesto (Maryland)</label>
        <Field label="Notas"><textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        {!contact && (
          <div className="form-grid">
            <Field label="Crear oportunidad (opcional)"><input value={f.oppTitle} onChange={set('oppTitle')} placeholder="Ej. 100 camisetas evento" /></Field>
            <Field label="Valor estimado"><input type="number" value={f.oppValue} onChange={set('oppValue')} /></Field>
          </div>
        )}
        {err && <p className="danger">{err}</p>}
        <div className="row end gap"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn primary">Guardar</button></div>
      </form>
    </Modal>
  );
}
