import React, { useState } from 'react';
import { api } from '../api.js';
import { Field, PageHeader, useMeta, useToast } from '../components/ui.jsx';

export default function Settings() {
  const meta = useMeta();
  const s = meta.settings;
  const [f, setF] = useState({ business_name: s.business_name, markup: s.markup * 100, tax_rate: s.tax_rate * 100, deposit_pct: s.deposit_pct * 100, sanmar_markup: (s.sanmar_markup ?? 1) * 100 });
  const [toast, notify] = useToast();
  async function save(e) {
    e.preventDefault();
    await api.put('/settings', { business_name: f.business_name, markup: Number(f.markup) / 100, tax_rate: Number(f.tax_rate) / 100, deposit_pct: Number(f.deposit_pct) / 100, sanmar_markup: Number(f.sanmar_markup) / 100 });
    await meta.reloadMeta();
    notify('Ajustes guardados');
  }
  return (
    <>
      <PageHeader title="Ajustes" subtitle="Datos del negocio y reglas de precios" />
      <form className="card form narrow" onSubmit={save}>
        <Field label="Nombre del negocio"><input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></Field>
        <Field label="Markup sobre costo de blanks (%)" hint="60 = vendes el blank a costo × 1.6"><input type="number" value={f.markup} onChange={(e) => setF({ ...f, markup: e.target.value })} /></Field>
        <Field label="Markup sobre costo SanMar (%)" hint={`100 = precio de venta es el costo de SanMar × 2. Hoy: costo × ${(1 + Number(f.sanmar_markup) / 100).toFixed(2)}`}><input type="number" value={f.sanmar_markup} onChange={(e) => setF({ ...f, sanmar_markup: e.target.value })} /></Field>
        <Field label="Impuesto por defecto (%)"><input type="number" step="0.01" value={f.tax_rate} onChange={(e) => setF({ ...f, tax_rate: e.target.value })} /></Field>
        <Field label="Anticipo sugerido (%)"><input type="number" value={f.deposit_pct} onChange={(e) => setF({ ...f, deposit_pct: e.target.value })} /></Field>
        <div className="row end"><button className="btn primary">Guardar</button></div>
      </form>
      <section className="card narrow">
        <h3>Integraciones</h3>
        <p className="muted">Los SMS y emails se registran en la conversación del contacto. Para enviarlos de verdad, configura Twilio (SMS) o SMTP/SendGrid (email) en <code>server/messaging.js</code> con variables de entorno. Ver README.</p>
      </section>
      {toast}
    </>
  );
}
