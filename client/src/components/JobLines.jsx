import React from 'react';
import { money } from '../utils.js';
import { PROCESOS } from '../../../shared/pricing.js';

export const LOCATIONS = ['Frente', 'Espalda', 'Pecho izquierdo', 'Pecho derecho', 'Manga izquierda', 'Manga derecha', 'Nuca', 'Frente gorra', 'Lateral gorra'];
/** Combinaciones de decoración más usadas: un toque las agrega con su ubicación (y el tamaño estándar de Ajustes). */
export const COMBOS_DECORACION = [
  { nombre: 'Bordado pecho izq.', decoraciones: [{ process: 'bordado', location: 'Pecho izquierdo' }] },
  { nombre: 'DTF frente + espalda', decoraciones: [{ process: 'dtf', location: 'Frente' }, { process: 'dtf', location: 'Espalda' }] },
  { nombre: 'DTF pecho izq. + espalda', decoraciones: [{ process: 'dtf', location: 'Pecho izquierdo' }, { process: 'dtf', location: 'Espalda' }] },
  { nombre: 'Bordado pecho + DTF espalda', decoraciones: [{ process: 'bordado', location: 'Pecho izquierdo' }, { process: 'dtf', location: 'Espalda' }] },
];
export const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

export const emptyPrenda = () => ({ line_type: 'prenda', product_id: '', description: '', color: '', sizes: {}, qty: 0, unit_cost: '', size_costs: {}, price_mode: 'auto', manual_price: '', line_discount: '', decorations: [] });
export const emptyDiseno = () => ({ line_type: 'diseno', description: 'Diseño/Digitalizado', qty: 1, unit_price: '', unit_cost: '', commissionable: false, decorations: [] });
/** Línea de digitalizado con el costo y precio de la matriz (se cobra la primera vez que se borda un logo). */
export const lineaDigitalizado = (cfg, logos = 1) => ({
  ...emptyDiseno(), description: 'Digitalizado de logo para bordado (primera vez)', qty: logos,
  unit_price: cfg?.bordado?.digitalizado?.precio ?? '', unit_cost: cfg?.bordado?.digitalizado?.costo ?? '',
});
export const esDigitalizado = (it) => (it.line_type || 'prenda') === 'diseno' && /digitaliz/i.test(it.description || '');

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

/**
 * Casilla única para la prenda: escribes el código (ej. PC61) y la línea se llena sola.
 * Primero busca en el catálogo; si no está y SanMar está conectado, lo trae de SanMar.
 */
export function CodigoPrenda({ idx, item, products, editable, onImport, onPick }) {
  const prendas = products.filter((p) => p.kind !== 'servicio');
  const actual = prendas.find((p) => p.id === Number(item.product_id));
  const [codigo, setCodigo] = React.useState(actual?.sku || '');
  const [estado, setEstado] = React.useState({ tipo: '', texto: '' });
  const ultimo = React.useRef(actual?.sku?.toUpperCase() || '');

  React.useEffect(() => { if (actual) { setCodigo(actual.sku); ultimo.current = actual.sku.toUpperCase(); } }, [actual?.id]);

  const buscar = async (valor = codigo) => {
    const c = valor.trim().toUpperCase();
    if (c.length < 2 || c === ultimo.current) return;
    ultimo.current = c;
    const enCatalogo = prendas.find((p) => String(p.sku).toUpperCase() === c);
    if (enCatalogo) { onPick(enCatalogo); setEstado({ tipo: '', texto: '' }); return; }
    if (!onImport) { setEstado({ tipo: 'warn', texto: 'No está en el catálogo (SanMar no está conectado).' }); return; }
    setEstado({ tipo: 'info', texto: 'Buscando en SanMar…' });
    try {
      const p = await onImport(c);
      if (ultimo.current !== c) return; // el usuario ya escribió otro código
      onPick(p); setEstado({ tipo: '', texto: '' });
    } catch (e) {
      if (ultimo.current === c) setEstado({ tipo: 'warn', texto: e.message });
    }
  };

  // Busca sola cuando dejas de escribir
  React.useEffect(() => {
    if (!editable) return undefined;
    const t = setTimeout(() => buscar(), 900);
    return () => clearTimeout(t);
  }, [codigo]);

  return (
    <div className="codigo-prenda">
      <input list={`prendas-${idx}`} disabled={!editable} value={codigo} placeholder="Código de prenda (ej. PC61)"
        onChange={(e) => { setCodigo(e.target.value.toUpperCase()); setEstado({ tipo: '', texto: '' }); }}
        onBlur={() => buscar()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }} />
      <datalist id={`prendas-${idx}`}>{prendas.map((p) => <option key={p.id} value={p.sku}>{p.brand} · {p.name}</option>)}</datalist>
      {estado.texto ? <small className={estado.tipo === 'warn' ? 'warn-txt' : 'muted'}>{estado.texto}</small>
        : actual ? <small className="muted">{actual.brand} · {actual.name}</small> : null}
    </div>
  );
}

export function LineEditor({ idx, item, calc, products, editable, onChange, onRemove, onDuplicate, onImportSanmar, tamanosDtf = [], produccion = false }) {
  // produccion = vista de Logística: tallas y decoraciones, sin precios, costos ni márgenes
  const product = products.find((p) => p.id === Number(item.product_id));
  const tipo = item.line_type || 'prenda';
  const set = (patch) => onChange(patch);
  const setDeco = (i, patch) => set({ decorations: item.decorations.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  // Tamaño estándar de la ubicación (Ajustes → Tarifas → DTF)
  const estandar = (ubic) => tamanosDtf.find((t) => String(t.ubicacion).trim().toLowerCase() === String(ubic || '').trim().toLowerCase());
  const conTamano = (d, ubic) => {
    if (d.process !== 'dtf') return {};
    const t = estandar(ubic);
    const anterior = estandar(d.location);
    const vacio = !d.width && !d.height;
    const eraEstandar = anterior && Number(d.width) === Number(anterior.ancho) && Number(d.height) === Number(anterior.alto);
    return t && (vacio || eraEstandar) ? { width: t.ancho, height: t.alto } : {};
  };

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
        {!produccion && <LineFoot calc={calc} />}
      </section>
    );
  }

  // Tallas del producto + cualquier talla con cantidad en la línea (para no ocultar piezas)
  const ORDEN = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
  const enLinea = Object.keys(item.sizes || {}).filter((k) => Number(item.sizes[k]) > 0);
  const todas = [...new Set([...(product?.sizes || []), ...enLinea])].sort((a, b) => (ORDEN.indexOf(a) + 1 || 99) - (ORDEN.indexOf(b) + 1 || 99));
  const sizes = todas.length ? todas : null;
  const tallas = calc?.prenda?.tallas || [];
  const ajustePct = Number(item.ajuste_pct) > 0 && item.price_mode !== 'manual' ? Math.round(Number(item.ajuste_pct) * 1000) / 10 : 0;
  const porTalla = Object.fromEntries(tallas.map((t) => [t.talla ?? '_', t]));

  return (
    <section className="card item">
      <div className="item-head">
        <span className="item-n">{idx + 1}</span>
        <CodigoPrenda idx={idx} item={item} products={products} editable={editable} onImport={onImportSanmar} onPick={(p) => set(snapshotFromProduct(p, item))} />
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
              {t && !produccion && <small className="size-price" title={`Costo ${t.costo == null ? 'desconocido' : money(t.costo)}`}>{t.precio == null ? '—' : money(t.precio)}</small>}
            </label>
          );
        })}
        <div className="size total-pcs"><span>Total</span><strong>{calc?.qty || 0}</strong></div>
      </div>

      {!produccion && <div className="row gap wrap price-row">
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
          {calc?.manual ? <span className="badge tone-amber">precio manual</span> : tallas[0]?.fuente ? <>Precio: {String(tallas[0].fuente).replace(/ \+ ajuste.*$/, '')}{tallas[0].factor ? ` (×${tallas[0].factor.toFixed(2)})` : ''}</> : null}
          {ajustePct > 0 && <span className="badge tone-blue" title="Ajuste a la meta de margen: sube por igual la prenda y sus decoraciones"> 🎯 +{ajustePct}% ajuste a meta</span>}
          {item.override && <span className="badge tone-violet">excepción del producto</span>}
        </div>
      </div>}

      <div className="decos">
        <div className="muted small">Decoración (sin markup de prendas)</div>
        {item.decorations.map((d, i) => {
          const dc = calc?.decoraciones?.[i];
          return (
            <div key={i} className="deco-row">
              <select disabled={!editable} value={d.process || ''} onChange={(e) => setDeco(i, { process: e.target.value })}>
                {Object.entries(PROCESOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input disabled={!editable} list="locations" value={d.location || ''} onChange={(e) => setDeco(i, { location: e.target.value, ...conTamano(d, e.target.value) })} placeholder="Ubicación" />
              {d.process === 'dtf' && <>
                <label className="inline">An. <input type="number" step="0.25" min="0" className="mini" disabled={!editable} value={blank(d.width)} onChange={(e) => setDeco(i, { width: e.target.value })} />"</label>
                <label className="inline">Al. <input type="number" step="0.25" min="0" className="mini" disabled={!editable} value={blank(d.height)} onChange={(e) => setDeco(i, { height: e.target.value })} />"</label>
              </>}
              {d.process === 'bordado' && <label className="inline">Puntadas <input type="number" step="500" min="0" className="mini" disabled={!editable} value={blank(d.stitches)} onChange={(e) => setDeco(i, { stitches: e.target.value })} placeholder="opc." /></label>}
              {d.process === 'heat_transfer' && <label className="inline">Hojas/pz <input type="number" step="0.25" min="0" className="mini" disabled={!editable} value={blank(d.sheets ?? 1)} onChange={(e) => setDeco(i, { sheets: e.target.value })} /></label>}
              {!produccion && <label className="inline" title="Precio por pieza a mano (queda marcado como manual)">$ man. <input type="number" step="0.01" className="mini" disabled={!editable} value={blank(d.manual_price)} onChange={(e) => setDeco(i, { manual_price: e.target.value })} placeholder="auto" /></label>}
              <span className="small deco-calc">
                {dc && produccion && dc.detalle && <div className="muted">{String(dc.detalle).replace(/ · \d+ hoja.*$/, '').replace(/ · (1ª ubicación|ubicación adicional)/, '')}</div>}
                {dc && !produccion && <>{pend(dc.precioPieza)}/pz · costo {pend(dc.costoPieza)}{dc.manual && <span className="badge tone-amber">manual</span>}{dc.detalle && <div className="muted">{dc.detalle}</div>}</>}
              </span>
              {editable && <button className="icon-btn" onClick={() => set({ decorations: item.decorations.filter((_, j) => j !== i) })}>×</button>}
            </div>
          );
        })}
        <datalist id="locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        {editable && (
          <div className="row gap">
            {Object.entries(PROCESOS).map(([k, v]) => (
              <button key={k} type="button" className="link-btn" onClick={() => {
                const location = item.decorations.length ? 'Espalda' : 'Frente';
                set({ decorations: [...item.decorations, { process: k, location, ...conTamano({ process: k }, location), ...(k === 'heat_transfer' ? { sheets: 1 } : {}) }] });
              }}>+ {v}</button>
            ))}
          </div>
        )}
        {editable && (
          <div className="row gap wrap combos-deco">
            <span className="muted small">De un toque:</span>
            {COMBOS_DECORACION.map((c) => (
              <button key={c.nombre} type="button" className="chip" title="Agrega la decoración ya con su ubicación y tamaño estándar"
                onClick={() => set({ decorations: [...item.decorations, ...c.decoraciones.map((d) => ({ ...d, ...conTamano(d, d.location) }))] })}>{c.nombre}</button>
            ))}
          </div>
        )}
      </div>
      {!produccion && <LineFoot calc={calc} />}
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
