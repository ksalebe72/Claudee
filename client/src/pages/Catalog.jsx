import React, { useState } from 'react';
import { api } from '../api.js';
import { money, useLoad } from '../utils.js';
import { Field, Modal, PageHeader, useMeta } from '../components/ui.jsx';

const csv = (a) => (a || []).join(', ');
const uncsv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function Catalog() {
  const meta = useMeta();
  const [tab, setTab] = useState('products');
  const [products, reloadP] = useLoad(() => api.get('/products'));
  const [methods, reloadM] = useLoad(() => api.get('/methods'));
  const [editP, setEditP] = useState(null);
  const [editM, setEditM] = useState(null);

  async function saveP(e) {
    e.preventDefault();
    const body = { ...editP, base_cost: Number(editP.base_cost) || 0, colors: uncsv(editP.colorsTxt), sizes: uncsv(editP.sizesTxt) };
    delete body.colorsTxt; delete body.sizesTxt;
    if (editP.id) await api.put(`/products/${editP.id}`, body); else await api.post('/products', body);
    setEditP(null); reloadP();
  }
  async function saveM(e) {
    e.preventDefault();
    const body = { ...editM, setup_fee: Number(editM.setup_fee) || 0, color_price: Number(editM.color_price) || 0, setup_per_color: editM.setup_per_color ? 1 : 0,
      tiers: editM.tiers.filter((t) => t.min !== '').map((t) => ({ min: Number(t.min), price: Number(t.price) })).sort((a, b) => a.min - b.min) };
    if (editM.id) await api.put(`/methods/${editM.id}`, body); else await api.post('/methods', body);
    setEditM(null); reloadM();
  }
  async function delP() { if (confirm('¿Eliminar producto?')) { await api.del(`/products/${editP.id}`); setEditP(null); reloadP(); } }
  async function delM() { if (confirm('¿Eliminar método?')) { await api.del(`/methods/${editM.id}`); setEditM(null); reloadM(); } }

  return (
    <>
      <PageHeader title="Catálogo y precios" subtitle={`Precio de venta del blank = costo × ${(1 + meta.settings.markup).toFixed(2)} (markup ${Math.round(meta.settings.markup * 100)}%, cámbialo en Ajustes)`}>
        {tab === 'products'
          ? <button className="btn primary" onClick={() => setEditP({ sku: '', name: '', brand: '', category: '', base_cost: '', supplier: '', colorsTxt: '', sizesTxt: 'S, M, L, XL, 2XL' })}>+ Producto</button>
          : <button className="btn primary" onClick={() => setEditM({ code: '', name: '', setup_fee: 0, color_price: 0, setup_per_color: 0, tiers: [{ min: 1, price: '' }] })}>+ Método</button>}
      </PageHeader>
      <div className="tabs big">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Productos (blanks)</button>
        <button className={tab === 'methods' ? 'active' : ''} onClick={() => setTab('methods')}>Métodos de decoración</button>
      </div>

      {tab === 'products' && (
        <div className="card no-pad">
          <table className="table">
            <thead><tr><th>SKU</th><th>Producto</th><th>Marca</th><th>Categoría</th><th>Proveedor</th><th>Colores</th><th>Tallas</th><th className="num">Costo</th><th className="num">Venta</th></tr></thead>
            <tbody>
              {products?.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEditP({ ...p, colorsTxt: csv(p.colors), sizesTxt: csv(p.sizes) })}>
                  <td>{p.sku}</td><td><strong>{p.name}</strong></td><td>{p.brand}</td><td>{p.category}</td><td className="muted">{p.supplier}</td>
                  <td className="small">{csv(p.colors)}</td><td className="small">{csv(p.sizes) || 'Talla única'}</td>
                  <td className="num">{money(p.base_cost)}</td><td className="num">{money(p.base_cost * (1 + meta.settings.markup))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'methods' && (
        <div className="cards-grid">
          {methods?.map((m) => (
            <div key={m.id} className="card clickable" onClick={() => setEditM({ ...m, tiers: m.tiers.map((t) => ({ ...t })) })}>
              <h3>{m.name}</h3>
              <div className="muted small">Setup {money(m.setup_fee)}{m.setup_per_color ? ' por color (pantalla)' : ''}{m.color_price ? ` · +${money(m.color_price)}/pz por color extra` : ''}</div>
              <table className="table mini-table">
                <thead><tr><th>Desde</th><th className="num">Precio/pz por ubicación</th></tr></thead>
                <tbody>{m.tiers.map((t) => <tr key={t.min}><td>{t.min} pzs</td><td className="num">{money(t.price)}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {editP && (
        <Modal title={editP.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setEditP(null)}>
          <form className="form" onSubmit={saveP}>
            <div className="form-grid">
              <Field label="Nombre *"><input required value={editP.name} onChange={(e) => setEditP({ ...editP, name: e.target.value })} /></Field>
              <Field label="SKU / Estilo"><input value={editP.sku || ''} onChange={(e) => setEditP({ ...editP, sku: e.target.value })} /></Field>
              <Field label="Marca"><input value={editP.brand || ''} onChange={(e) => setEditP({ ...editP, brand: e.target.value })} /></Field>
              <Field label="Categoría"><input value={editP.category || ''} onChange={(e) => setEditP({ ...editP, category: e.target.value })} /></Field>
              <Field label="Proveedor"><input value={editP.supplier || ''} onChange={(e) => setEditP({ ...editP, supplier: e.target.value })} placeholder="SanMar, S&S, alphabroder…" /></Field>
              <Field label="Costo unitario"><input type="number" step="0.01" value={editP.base_cost} onChange={(e) => setEditP({ ...editP, base_cost: e.target.value })} /></Field>
            </div>
            <Field label="Colores" hint="Separados por coma"><input value={editP.colorsTxt} onChange={(e) => setEditP({ ...editP, colorsTxt: e.target.value })} /></Field>
            <Field label="Tallas" hint="Vacío = talla única (se cotiza por cantidad). 2XL+ lleva recargo automático."><input value={editP.sizesTxt} onChange={(e) => setEditP({ ...editP, sizesTxt: e.target.value })} /></Field>
            <div className="row between">
              {editP.id ? <button type="button" className="btn danger-ghost" onClick={delP}>Eliminar</button> : <span />}
              <button className="btn primary">Guardar</button>
            </div>
          </form>
        </Modal>
      )}

      {editM && (
        <Modal title={editM.id ? `Editar ${editM.name}` : 'Nuevo método'} onClose={() => setEditM(null)}>
          <form className="form" onSubmit={saveM}>
            <div className="form-grid">
              <Field label="Nombre *"><input required value={editM.name} onChange={(e) => setEditM({ ...editM, name: e.target.value })} /></Field>
              <Field label="Código *" hint="Sin espacios, ej. dtg"><input required disabled={!!editM.id} value={editM.code} onChange={(e) => setEditM({ ...editM, code: e.target.value.toLowerCase().replace(/\W/g, '') })} /></Field>
              <Field label="Cargo de setup"><input type="number" step="0.01" value={editM.setup_fee} onChange={(e) => setEditM({ ...editM, setup_fee: e.target.value })} /></Field>
              <Field label="Costo por color extra /pz"><input type="number" step="0.01" value={editM.color_price} onChange={(e) => setEditM({ ...editM, color_price: e.target.value })} /></Field>
            </div>
            <label className="inline"><input type="checkbox" checked={!!editM.setup_per_color} onChange={(e) => setEditM({ ...editM, setup_per_color: e.target.checked })} /> Cobrar setup por cada color (pantallas de serigrafía)</label>
            <h4>Escala de precios por cantidad</h4>
            {editM.tiers.map((t, i) => (
              <div key={i} className="row gap">
                <label className="inline">Desde <input className="mini" type="number" value={t.min} onChange={(e) => setEditM({ ...editM, tiers: editM.tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)) })} /> pzs</label>
                <label className="inline">$ <input className="mini" type="number" step="0.01" value={t.price} onChange={(e) => setEditM({ ...editM, tiers: editM.tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} /> /pz</label>
                <button type="button" className="icon-btn" onClick={() => setEditM({ ...editM, tiers: editM.tiers.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => setEditM({ ...editM, tiers: [...editM.tiers, { min: '', price: '' }] })}>+ escala</button>
            <div className="row between">
              {editM.id ? <button type="button" className="btn danger-ghost" onClick={delM}>Eliminar</button> : <span />}
              <button className="btn primary">Guardar</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
