import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, useLoad } from '../utils.js';
import { Field, Modal, PageHeader, useMeta, useToast } from '../components/ui.jsx';
import { precioPrenda } from '../../../shared/pricing.js';

const csv = (a) => (a || []).join(', ');
const uncsv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export default function Catalog() {
  const meta = useMeta();
  const esDuena = meta.user.role === 'duena';
  const [products, reload] = useLoad(() => api.get('/products'));
  const [tarifas] = useLoad(() => api.get('/tarifas'));
  const [edit, setEdit] = useState(null);
  const [toast, notify] = useToast();

  function abrir(p) {
    setEdit(p ? { ...p, colorsTxt: csv(p.colors), sizesTxt: csv(p.sizes), base_cost: p.base_cost ?? '', price: p.price ?? '', markup_mode: p.markup_mode || '', markup_value: p.markup_value ?? '', size_costs: { ...(p.size_costs || {}) } }
      : { kind: 'prenda', sku: '', name: '', brand: '', category: '', base_cost: '', price: '', supplier: '', colorsTxt: '', sizesTxt: 'S, M, L, XL, 2XL', size_costs: {}, markup_mode: '', markup_value: '', commissionable: 1 });
  }
  async function guardar(e) {
    e.preventDefault();
    const body = {
      kind: edit.kind, sku: edit.sku, name: edit.name, brand: edit.brand, category: edit.category, supplier: edit.supplier,
      base_cost: numOrNull(edit.base_cost), price: numOrNull(edit.price), colors: uncsv(edit.colorsTxt), sizes: uncsv(edit.sizesTxt),
      size_costs: Object.fromEntries(Object.entries(edit.size_costs || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])),
    };
    if (esDuena) Object.assign(body, { markup_mode: edit.markup_mode || null, markup_value: numOrNull(edit.markup_value), commissionable: edit.commissionable ? 1 : 0 });
    try {
      if (edit.id) await api.put(`/products/${edit.id}`, body); else await api.post('/products', body);
      setEdit(null); reload(); notify('Guardado');
    } catch (err) { notify(err.message, true); }
  }
  async function importar() {
    const style = prompt('Estilo de SanMar a importar (ej. PC61, K500):');
    if (!style) return;
    try { const p = await api.post('/sanmar/import', { style }); notify(`Importado: ${p.brand} ${p.sku} · ${p.colors.length} colores`); reload(); } catch (e) { notify(e.message, true); }
  }
  async function eliminar() { if (confirm('¿Eliminar producto?')) { await api.del(`/products/${edit.id}`); setEdit(null); reload(); } }

  const cfg = tarifas?.config;
  const venta = (p) => {
    if (!cfg) return null;
    if (p.kind === 'servicio') return p.price;
    const override = p.markup_mode ? { tipo: p.markup_mode, valor: p.markup_value } : null;
    return precioPrenda(p.base_cost, cfg, override).precio;
  };

  return (
    <>
      <PageHeader title="Catálogo" subtitle={<>Prendas (SanMar, S&S) y servicios. El precio de venta sale de la matriz de <Link to="/ajustes">Ajustes → Tarifas</Link> ({cfg?.prendas.modo === 'fijo' ? 'modo fijo' : 'modo escalonado'}).</>}>
        {meta.integrations?.sanmar && <button className="btn" onClick={importar}>⬇ Importar de SanMar</button>}
        <button className="btn primary" onClick={() => abrir(null)}>+ Producto o servicio</button>
      </PageHeader>
      <div className="card no-pad">
        <table className="table">
          <thead><tr><th>SKU</th><th>Producto</th><th>Tipo</th><th>Marca</th><th>Proveedor</th><th className="num">Costo</th><th className="num">Venta</th><th>Excepción</th><th>Comisionable</th></tr></thead>
          <tbody>
            {products?.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => abrir(p)}>
                <td>{p.sku}</td><td><strong>{p.name}</strong><div className="muted small">{p.category}</div></td>
                <td>{p.kind === 'servicio' ? 'Servicio' : 'Prenda'}</td><td>{p.brand}</td><td className="muted">{p.supplier}</td>
                <td className="num">{p.base_cost == null ? <span className="warn-txt">desconocido</span> : money(p.base_cost)}{Object.keys(p.size_costs || {}).length > 0 && <div className="muted small">+ por talla</div>}</td>
                <td className="num">{venta(p) == null ? '—' : money(venta(p))}</td>
                <td>{p.markup_mode === 'porcentaje' ? `${p.markup_value}%` : p.markup_mode === 'precio_fijo' ? `fijo ${money(p.markup_value)}` : '—'}</td>
                <td>{p.commissionable === 0 ? <span className="badge tone-gray">no</span> : 'sí'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? 'Editar' : 'Nuevo producto o servicio'} onClose={() => setEdit(null)} wide>
          <form className="form" onSubmit={guardar}>
            <div className="seg">
              <button type="button" className={edit.kind !== 'servicio' ? 'on' : ''} onClick={() => setEdit({ ...edit, kind: 'prenda' })}>Prenda</button>
              <button type="button" className={edit.kind === 'servicio' ? 'on' : ''} onClick={() => setEdit({ ...edit, kind: 'servicio' })}>Servicio (website, media player…)</button>
            </div>
            <div className="form-grid three">
              <Field label="Nombre *"><input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="SKU / Estilo"><input value={edit.sku || ''} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></Field>
              <Field label="Categoría"><input value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
              {edit.kind !== 'servicio' && <Field label="Marca"><input value={edit.brand || ''} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} /></Field>}
              {edit.kind !== 'servicio' && <Field label="Proveedor"><input list="prov" value={edit.supplier || ''} onChange={(e) => setEdit({ ...edit, supplier: e.target.value })} /></Field>}
              <Field label="Costo unitario" hint="Vacío = desconocido (la orden queda incompleta, nunca se usa $0)"><input type="number" step="0.01" value={edit.base_cost} onChange={(e) => setEdit({ ...edit, base_cost: e.target.value })} /></Field>
              {edit.kind === 'servicio' && <Field label="Precio de venta"><input type="number" step="0.01" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></Field>}
            </div>
            <datalist id="prov"><option value="SanMar" /><option value="S&S Activewear" /></datalist>
            {edit.kind !== 'servicio' && <>
              <Field label="Colores" hint="Separados por coma"><input value={edit.colorsTxt} onChange={(e) => setEdit({ ...edit, colorsTxt: e.target.value })} /></Field>
              <Field label="Tallas" hint="Vacío = talla única (se cotiza por cantidad)"><input value={edit.sizesTxt} onChange={(e) => setEdit({ ...edit, sizesTxt: e.target.value })} /></Field>
              <div className="field"><span>Costo por talla (opcional: cuando el proveedor cobra distinto, p. ej. 2XL+)</span>
                <div className="sizes">
                  {uncsv(edit.sizesTxt).map((s) => (
                    <label key={s} className="size"><span>{s}</span>
                      <input type="number" step="0.01" placeholder={edit.base_cost === '' ? '?' : String(edit.base_cost)} value={edit.size_costs?.[s] ?? ''} onChange={(e) => setEdit({ ...edit, size_costs: { ...edit.size_costs, [s]: e.target.value } })} />
                    </label>
                  ))}
                </div>
              </div>
            </>}
            <fieldset className="owner-box" disabled={!esDuena}>
              <legend>Matriz (solo el dueño{esDuena ? '' : ' · solo lectura'})</legend>
              {edit.kind !== 'servicio' && (
                <div className="row gap wrap">
                  <label className="field"><span>Excepción de precio</span>
                    <select value={edit.markup_mode} onChange={(e) => setEdit({ ...edit, markup_mode: e.target.value })}>
                      <option value="">Ninguna (usa la matriz)</option><option value="porcentaje">Markup propio (%)</option><option value="precio_fijo">Precio fijo ($)</option>
                    </select>
                  </label>
                  {edit.markup_mode && <label className="field"><span>{edit.markup_mode === 'porcentaje' ? 'Markup %' : 'Precio $'}</span><input type="number" step="0.01" value={edit.markup_value} onChange={(e) => setEdit({ ...edit, markup_value: e.target.value })} /></label>}
                </div>
              )}
              <label className="inline"><input type="checkbox" checked={edit.commissionable !== 0 && edit.commissionable !== false} onChange={(e) => setEdit({ ...edit, commissionable: e.target.checked ? 1 : 0 })} /> Comisionable</label>
              <p className="muted small">Mensualidades de websites y media players: no comisionables. Los cambios quedan en el historial.</p>
            </fieldset>
            <div className="row between">
              {edit.id ? <button type="button" className="btn danger-ghost" onClick={eliminar}>Eliminar</button> : <span />}
              <button className="btn primary">Guardar</button>
            </div>
          </form>
        </Modal>
      )}
      {toast}
    </>
  );
}
