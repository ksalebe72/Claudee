import React from 'react';
import { money } from '../utils.js';
import { PROCESOS } from '../../../shared/pricing.js';

export const LOCATIONS = ['Frente', 'Espalda', 'Pecho izquierdo', 'Pecho derecho', 'Manga izquierda', 'Manga derecha', 'Nuca', 'Frente gorra', 'Lateral gorra'];
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

export const emptyPrenda = () => ({ line_type: 'prenda', product_id: '', description: '', color: '', sizes: {}, qty: 0, unit_cost: '', size_costs: {}, price_mode: 'auto', manual_price: '', line_discount: '', decorations: [] });
export const emptyDiseno = () => ({ line_type: 'diseno', description: 'Diseño/Digitalizado', qty: 1, unit_price: '', unit_cost: '', commissionable: false, decorations: [] });

/** Copia en la línea los datos del producto (costo, tallas, excepción de markup), igual que el servidor. */
export function snapshotFromProduct(p, prev = {}) {
  if (!p) return { ...prev, product_id: '' };
  const override = p.markup_mode ? { tipo: p.markup_mode, valor: p.markup_value } : null;
  const servicio = p.kind === 'servicio';
  return {
    ...prev, product_id: p.id, description: p.name, color: p.colors?.[0] || '',
    line_type: servicio ? 'servicio' : 'prenda', unit_cost: p.base_cost ?? '', size_costs: p.size_costs || {},
    override, commissionable: p.commissionable !== 0,
    ...(servicio ? { unit_price: p.price ?? '', qty: prev.qty || 1, decorations: [] } : { sizes: {} }),
  };
}

const blank = (v) => (v == null ? '' : v);
const pend = (v, txt = 'pendiente') => (v == null ? <span className="warn-txt">{txt}</span> : money(v));

export function LineEditor({ idx, item, calc, products, editable, onChange, onRemove, onDuplicate }) {
  const product = products.find((p) => p.id === Number(item.product_id));
  const tipo = item.line_type || 'prenda';
  const set = (patch) => onChange(patch);
  const setDeco = (i, patch) => set({ decorations: item.decorations.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  if (tipo === 'diseno' || tipo === 'servicio') {
    return (
      <section className="card item">
        <div className="item-head">
          <span className="item-n">{idx + 1}</span>
          {tipo === 'servicio' ? (
            <select disabled={!editable} value={item.product_id || ''} onChange={(e) => set(snapshotFromProduct(products.find((p) => p.id === Number(e.target.value)), item))}>
              {products.filter((p) => p.kind === 'servicio').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : <strong className="grow">Diseño / Digitalizado / Setup</strong>}
          <span className="badge tone-gray">{tipo === 'diseno' ? 'no comisionable' : item.commissionable === false ? 'no comisionable' : 'comisionable'}</span>
          {editable && <button className="icon-btn" title="Quitar" onClick={onRemove}>🗑</button>}
        </div>
        <input className="desc" disabled={!editable} value={item.description} onChange={(e) => set({ description: e.target.value })} />
        <div className="row gap wrap">
          <label className="field mini-field"><span>Cantidad</span><input type="number" min="1" disabled={!editable} value={blank(item.qty)} onChange={(e) => set({ qty: e.target.value })} /></label>
          <label className="field mini-field"><span>Precio unitario</span><input type="number" step="0.01" disabled={!editable} value={blank(item.unit_price)} onChange={(e) => set({ unit_price: e.target.value })} placeholder="—" /></label>
          <label className="field mini-field"><span>Costo unitario</span><input type="number" step="0.01" disabled={!editable} value={blank(item.unit_cost)} onChange={(e) => set({ unit_cost: e.target.value })} placeholder="desconocido" /></label>
        </div>
        <LineFoot calc={calc} />
      </section>
    );
  }

  const sizes = product?.sizes?.length ? product.sizes : Object.keys(item.sizes || {}).length ? Object.keys(item.sizes) : null;
  const tallas = calc?.prenda?.tallas || [];
  const porTalla = Object.fromEntries(tallas.map((t) => [t.talla ?? '_', t]));

  return (
    <section className="card item">
      <div className="item-head">
        <span className="item-n">{idx + 1}</span>
        <select disabled={!editable} value={item.product_id || ''} onChange={(e) => set(snapshotFromProduct(products.find((p) => p.id === Number(e.target.value)), item))}>
          <option value="">— Prenda del catálogo —</option>
          {products.filter((p) => p.kind !== 'servicio').map((p) => <option key={p.id} value={p.id}>{p.brand} {p.sku} · {p.name}</option>)}
        </select>
        {product?.colors?.length > 0 && (
          <select disabled={!editable} value={item.color} onChange={(e) => set({ color: e.target.value })}>
            {product.colors.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <div className="item-actions">
          {editable && <button className="icon-btn" title="Duplicar" onClick={onDuplicate}>⧉</button>}
          {editable && <button className="icon-btn" title="Quitar" onClick={onRemove}>🗑</button>}
        </div>
      </div>
      <input className="desc" disabled={!editable} value={item.description} placeholder="Descripción" onChange={(e) => set({ description: e.target.value })} />

      <div className="sizes">
        {(sizes || [null]).map((s) => {
          const t = porTalla[s ?? '_'];
          return (
            <label key={s ?? 'qty'} className="size">
              <span>{s || 'Cant.'}</span>
              <input type="number" min="0" disabled={!editable}
                value={s ? item.sizes?.[s] || '' : item.qty || ''}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0);
                  if (s) { const n = { ...item.sizes, [s]: v }; if (!v) delete n[s]; set({ sizes: n }); }
                  else set({ qty: v, sizes: {} });
                }} />
              {t && <small className="size-price" title={`Costo ${t.costo == null ? 'desconocido' : money(t.costo)}`}>{t.precio == null ? '—' : money(t.precio)}</small>}
            </label>
          );
        })}
        <div className="size total-pcs"><span>Total</span><strong>{calc?.qty || 0}</strong></div>
      </div>

      <div className="row gap wrap price-row">
        <label className="field mini-field"><span>Costo prenda</span>
          <input type="number" step="0.01" disabled={!editable} value={blank(item.unit_cost)} onChange={(e) => set({ unit_cost: e.target.value })} placeholder="desconocido" title="Costo del proveedor por pieza. Vacío = desconocido (nunca se toma como $0)." />
        </label>
        <div className="field mini-field"><span>Precio prenda</span>
          <div className="seg small">
            <button type="button" disabled={!editable} className={item.price_mode !== 'manual' ? 'on' : ''} onClick={() => set({ price_mode: 'auto' })}>Automático</button>
            <button type="button" disabled={!editable} className={item.price_mode === 'manual' ? 'on' : ''} onClick={() => set({ price_mode: 'manual' })}>Manual</button>
          </div>
        </div>
        {item.price_mode === 'manual' && (
          <label className="field mini-field"><span>Precio manual/pz</span><input type="number" step="0.01" disabled={!editable} value={blank(item.manual_price)} onChange={(e) => set({ manual_price: e.target.value })} /></label>
        )}
        <label className="field mini-field"><span>Descuento línea $</span><input type="number" step="0.01" disabled={!editable} value={blank(item.line_discount)} onChange={(e) => set({ line_discount: e.target.value })} placeholder="0" /></label>
        <div className="muted small grow">
          {calc?.manual ? <span className="badge tone-amber">precio manual</span> : tallas[0]?.fuente ? <>Precio: {tallas[0].fuente}{tallas[0].factor ? ` (×${tallas[0].factor.toFixed(2)})` : ''}</> : null}
          {item.override && <span className="badge tone-violet">excepción del producto</span>}
        </div>
      </div>

      <div className="decos">
        <div className="muted small">Decoración (sin markup de prendas)</div>
        {item.decorations.map((d, i) => {
          const dc = calc?.decoraciones?.[i];
          return (
            <div key={i} className="deco-row">
              <select disabled={!editable} value={d.process || ''} onChange={(e) => setDeco(i, { process: e.target.value })}>
                {Object.entries(PROCESOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input disabled={!editable} list="locations" value={d.location || ''} onChange={(e) => setDeco(i, { location: e.target.value })} placeholder="Ubicación" />
              {d.process === 'dtf' && <>
                <label className="inline">An. <input type="number" step="0.25" min="0" className="mini" disabled={!editable} value={blank(d.width)} onChange={(e) => setDeco(i, { width: e.target.value })} />"</label>
                <label className="inline">Al. <input type="number" step="0.25" min="0" className="mini" disabled={!editable} value={blank(d.height)} onChange={(e) => setDeco(i, { height: e.target.value })} />"</label>
              </>}
              {d.process === 'bordado' && <label className="inline">Puntadas <input type="number" step="500" min="0" className="mini" disabled={!editable} value={blank(d.stitches)} onChange={(e) => setDeco(i, { stitches: e.target.value })} placeholder="opc." /></label>}
              {d.process === 'heat_transfer' && <label className="inline">Hojas/pz <input type="number" step="0.25" min="0" className="mini" disabled={!editable} value={blank(d.sheets ?? 1)} onChange={(e) => setDeco(i, { sheets: e.target.value })} /></label>}
              <label className="inline" title="Precio por pieza a mano (queda marcado como manual)">$ man. <input type="number" step="0.01" className="mini" disabled={!editable} value={blank(d.manual_price)} onChange={(e) => setDeco(i, { manual_price: e.target.value })} placeholder="auto" /></label>
              <span className="small deco-calc">
                {dc && <>{pend(dc.precioPieza)}/pz · costo {pend(dc.costoPieza)}{dc.manual && <span className="badge tone-amber">manual</span>}{dc.detalle && <div className="muted">{dc.detalle}</div>}</>}
              </span>
              {editable && <button className="icon-btn" onClick={() => set({ decorations: item.decorations.filter((_, j) => j !== i) })}>×</button>}
            </div>
          );
        })}
        <datalist id="locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        {editable && (
          <div className="row gap">
            {Object.entries(PROCESOS).map(([k, v]) => (
              <button key={k} type="button" className="link-btn" onClick={() => set({ decorations: [...item.decorations, { process: k, location: item.decorations.length ? 'Espalda' : 'Frente', ...(k === 'heat_transfer' ? { sheets: 1 } : {}) }] })}>+ {v}</button>
            ))}
          </div>
        )}
      </div>
      <LineFoot calc={calc} />
    </section>
  );
}

function LineFoot({ calc }) {
  if (!calc) return null;
  const ganancia = calc.venta == null || calc.costo == null ? null : calc.venta - calc.costo;
  return (
    <div className="item-foot">
      <span className="small">
        Venta {pend(calc.venta)} · Costo {pend(calc.costo, 'incompleto')} · Ganancia {pend(ganancia, '—')}
        {calc.descuento > 0 && <> · Desc. {money(calc.descuento)}</>}
      </span>
      {calc.unitPrice != null && <span className="item-total">{money(calc.unitPrice)}/pz · <strong>{money(calc.ventaBruta)}</strong></span>}
      {(calc.faltantesCosto.length > 0 || calc.faltantesPrecio.length > 0 || calc.avisos.length > 0) && (
        <ul className="missing">
          {calc.faltantesPrecio.map((f) => <li key={f} className="danger">Precio: {f}</li>)}
          {calc.faltantesCosto.map((f) => <li key={f}>Falta costo: {f}</li>)}
          {calc.avisos.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}
