import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, money, today, useLoad } from '../utils.js';
import { Field, PageHeader, useMeta, useToast } from '../components/ui.jsx';
import { LOCATIONS } from '../components/JobLines.jsx';

const TABS = { tarifas: 'Tarifas', comisiones: 'Vendedores y comisiones', usuarios: 'Usuarios', historial: 'Historial de cambios', general: 'General' };

export default function Settings() {
  const meta = useMeta();
  const esDuena = meta.user.role === 'duena';
  const [tab, setTab] = useState('tarifas');
  const [toast, notify] = useToast();
  return (
    <>
      <PageHeader title="Ajustes" subtitle={esDuena ? 'Matriz de precios y costos, comisiones y usuarios. Cada cambio queda en el historial.' : 'Solo el dueño puede modificar estos valores. Aquí los ves en modo lectura.'} />
      <div className="tabs big">
        {Object.entries(TABS).filter(([k]) => esDuena || ['tarifas', 'comisiones'].includes(k)).map(([k, v]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>
      {tab === 'tarifas' && <Tarifas editable={esDuena} notify={notify} />}
      {tab === 'comisiones' && <Comisiones editable={esDuena} notify={notify} />}
      {tab === 'usuarios' && esDuena && <Usuarios notify={notify} />}
      {tab === 'historial' && esDuena && <Historial />}
      {tab === 'general' && esDuena && <General notify={notify} />}
      {toast}
    </>
  );
}

// ---------- helpers de edición ----------
const toNum = (v) => (v === '' || v == null ? null : Number(v));
function NumIn({ value, onChange, disabled, step = '0.01', pct, placeholder, width }) {
  const shown = value == null ? '' : pct ? Math.round(value * 100000) / 1000 : value;
  return (
    <input type="number" step={step} className="mini" style={width ? { width } : undefined} disabled={disabled} value={shown} placeholder={placeholder ?? 'sin valor'}
      onChange={(e) => onChange(e.target.value === '' ? null : pct ? Number(e.target.value) / 100 : Number(e.target.value))} />
  );
}
const lim = (v) => (v == null ? 'en adelante' : v);

// ---------- Tarifas ----------
function Tarifas({ editable, notify }) {
  const [t, reload] = useLoad(() => api.get('/tarifas'));
  const [c, setC] = useState(null);
  const [nota, setNota] = useState('');
  useEffect(() => { if (t) setC(structuredClone(t.config)); }, [t]);
  if (!t || !c) return <div className="loading">Cargando…</div>;
  const upd = (fn) => setC((prev) => { const n = structuredClone(prev); fn(n); return n; });
  const changed = JSON.stringify(c) !== JSON.stringify(t.config);
  async function guardar() {
    try {
      const r = await api.put('/tarifas', { config: c, nota });
      notify(`Versión ${r.id} guardada (${r.cambios} cambio${r.cambios === 1 ? '' : 's'}). Las cotizaciones existentes conservan sus precios.`);
      setNota('');
      reload();
    } catch (e) { notify(e.message, true); }
  }
  const dis = !editable;
  const rowsEditor = (arr, path, cols, nuevo) => (
    <table className="table mini-table edit-table">
      <thead><tr>{cols.map((col) => <th key={col.k}>{col.l}</th>)}{editable && <th />}</tr></thead>
      <tbody>
        {arr.map((row, i) => (
          <tr key={i}>
            {cols.map((col) => <td key={col.k}>{col.text
              ? <input disabled={dis} list={col.list} value={row[col.k] ?? ''} placeholder={col.ph} onChange={(e) => { const v = e.target.value; upd((n) => { path(n)[i][col.k] = v; }); }} />
              : <NumIn disabled={dis} step={col.step} value={row[col.k]} onChange={(v) => upd((n) => { path(n)[i][col.k] = v; })} placeholder={col.ph} />}</td>)}
            {editable && <td><button className="icon-btn" onClick={() => upd((n) => { path(n).splice(i, 1); })}>×</button></td>}
          </tr>
        ))}
      </tbody>
      {editable && <tfoot><tr><td colSpan={cols.length + 1}><button className="link-btn" onClick={() => upd((n) => { path(n).push(nuevo()); })}>+ fila</button></td></tr></tfoot>}
    </table>
  );

  return (
    <div className="settings-grid">
      <section className="card">
        <h3>A) Prendas · precio de venta = costo × factor</h3>
        <div className="seg">
          <button disabled={dis} className={c.prendas.modo === 'escalonado' ? 'on' : ''} onClick={() => upd((n) => { n.prendas.modo = 'escalonado'; })}>Escalonado</button>
          <button disabled={dis} className={c.prendas.modo === 'fijo' ? 'on' : ''} onClick={() => upd((n) => { n.prendas.modo = 'fijo'; })}>Fijo (como DecoNetwork)</button>
        </div>
        <h4>Modo escalonado</h4>
        <table className="table mini-table edit-table">
          <thead><tr><th>Si el costo es menor que</th><th>Factor</th><th>Markup</th>{editable && <th />}</tr></thead>
          <tbody>
            {c.prendas.escalonado.map((tr, i) => (
              <tr key={i}>
                <td>{tr.menorQue == null ? <span className="muted">resto (sin límite)</span> : <NumIn disabled={dis} value={tr.menorQue} onChange={(v) => upd((n) => { n.prendas.escalonado[i].menorQue = v; })} />}</td>
                <td><NumIn disabled={dis} value={tr.factor} onChange={(v) => upd((n) => { n.prendas.escalonado[i].factor = v; })} /></td>
                <td className="muted">{tr.factor ? `${Math.round((tr.factor - 1) * 100)}%` : ''}</td>
                {editable && <td>{tr.menorQue != null && <button className="icon-btn" onClick={() => upd((n) => { n.prendas.escalonado.splice(i, 1); })}>×</button>}</td>}
              </tr>
            ))}
          </tbody>
          {editable && <tfoot><tr><td colSpan={4}><button className="link-btn" onClick={() => upd((n) => { n.prendas.escalonado.splice(n.prendas.escalonado.length - 1, 0, { menorQue: 10, factor: 2 }); })}>+ tramo</button></td></tr></tfoot>}
        </table>
        <h4>Modo fijo</h4>
        <label className="inline">Factor <NumIn disabled={dis} value={c.prendas.fijo.factor} onChange={(v) => upd((n) => { n.prendas.fijo.factor = v; })} /> <span className="muted">({Math.round((c.prendas.fijo.factor - 1) * 100)}% de markup)</span></label>
        <p className="muted small">Ejemplo con el modo activo: prenda de $4.00 → {money(4 * (c.prendas.modo === 'fijo' ? c.prendas.fijo.factor : (c.prendas.escalonado.find((x) => x.menorQue == null || 4 < x.menorQue)?.factor || 0)))}. Las excepciones por producto (porcentaje o precio fijo) se ponen en Catálogo.</p>
      </section>

      <section className="card">
        <h3>B) Bordado · por logo y por ubicación</h3>
        {rowsEditor(c.bordado.filas, (n) => n.bordado.filas, [
          { k: 'puntadasHasta', l: 'Puntadas hasta', step: '500', ph: 'cualquiera' },
          { k: 'cantidadDesde', l: 'Desde (piezas)', step: '1' },
          { k: 'costo', l: 'COSTO $' },
          { k: 'precio', l: 'PRECIO $' },
        ], () => ({ puntadasHasta: 5000, cantidadDesde: 1, costo: null, precio: null }))}
        <p className="muted small">Sin rangos todavía: una sola fila. Para rangos de puntadas agrega filas con «Puntadas hasta» (5,000 / 10,000 / 15,000) y deja una fila vacía para «más».</p>
        <h4>Digitalizado del logo (se cobra la primera vez que se borda cada logo)</h4>
        <div className="row gap wrap">
          <label className="inline">Costo $ <NumIn disabled={dis} value={c.bordado.digitalizado?.costo} onChange={(v) => upd((n) => { n.bordado.digitalizado = { ...(n.bordado.digitalizado || {}), costo: v }; })} /></label>
          <label className="inline">Precio $ <NumIn disabled={dis} value={c.bordado.digitalizado?.precio} onChange={(v) => upd((n) => { n.bordado.digitalizado = { ...(n.bordado.digitalizado || {}), precio: v }; })} /></label>
        </div>
        <p className="muted small">En la orden aparece como línea «Digitalizado» (no comisionable). La app avisa cuando un cliente borda por primera vez.</p>
      </section>

      <section className="card">
        <h3>C) DTF</h3>
        <h4>Costo interno</h4>
        <div className="seg">
          <button disabled={dis} className={c.dtf.costoModo === 'hoja' ? 'on' : ''} onClick={() => upd((n) => { n.dtf.costoModo = 'hoja'; })}>Por hoja</button>
          <button disabled={dis} className={c.dtf.costoModo === 'area' ? 'on' : ''} onClick={() => upd((n) => { n.dtf.costoModo = 'area'; })}>Por pie² del diseño</button>
        </div>
        {c.dtf.costoModo === 'hoja' ? (
          <div className="row gap wrap">
            <label className="inline">Hoja <NumIn disabled={dis} step="0.5" value={c.dtf.hoja.ancho} onChange={(v) => upd((n) => { n.dtf.hoja.ancho = v; })} />×<NumIn disabled={dis} step="0.5" value={c.dtf.hoja.alto} onChange={(v) => upd((n) => { n.dtf.hoja.alto = v; })} />"</label>
            <label className="inline">Costo por hoja $ <NumIn disabled={dis} value={c.dtf.hoja.costo} onChange={(v) => upd((n) => { n.dtf.hoja.costo = v; })} /></label>
            <label className="inline">Aprovechamiento <NumIn disabled={dis} pct step="1" value={c.dtf.hoja.aprovechamiento} onChange={(v) => upd((n) => { n.dtf.hoja.aprovechamiento = v; })} />%</label>
          </div>
        ) : (
          <div className="row gap wrap">
            <label className="inline">Material por pie² (144 in²) $ <NumIn disabled={dis} value={c.dtf.costoPieCuadrado} onChange={(v) => upd((n) => { n.dtf.costoPieCuadrado = v; })} /></label>
          </div>
        )}
        <div className="row gap wrap">
          <label className="inline">Aplicación $ <NumIn disabled={dis} value={c.dtf.costoAplicacion} onChange={(v) => upd((n) => { n.dtf.costoAplicacion = v; })} /></label>
          <label className="inline">se cobra
            <select disabled={dis} value={c.dtf.aplicacionPor} onChange={(e) => upd((n) => { n.dtf.aplicacionPor = e.target.value; })}>
              <option value="prenda">una vez por prenda</option>
              <option value="ubicacion">por cada ubicación</option>
            </select>
          </label>
        </div>
        <p className="muted small">{c.dtf.costoModo === 'hoja'
          ? <>Se suman los diseños de todas las piezas de la línea y se cuentan las hojas necesarias. Ej.: 1 camiseta con pecho 3.5×3.5 + espalda 9.5×12 = 1 hoja ({money(c.dtf.hoja.costo)}) + aplicación = {money(Number(c.dtf.hoja.costo) + Number(c.dtf.costoAplicacion))}. Si en la práctica sobra espacio sin usar, baja el aprovechamiento (ej. 85%).</>
          : <>Ejemplo, prenda con frente 10×12" y pecho 3.5×3.5": costo DTF {money((120 + 12.25) / 144 * c.dtf.costoPieCuadrado + c.dtf.costoAplicacion * (c.dtf.aplicacionPor === 'ubicacion' ? 2 : 1))} por prenda.</>}</p>
        <h4>Tamaños estándar por ubicación</h4>
        {rowsEditor(c.dtf.tamanos || [], (n) => (n.dtf.tamanos ||= []), [{ k: 'ubicacion', l: 'Ubicación', text: true, list: 'ubicaciones-dtf', ph: 'Ej. Pecho izquierdo' }, { k: 'ancho', l: 'Ancho "', step: '0.25' }, { k: 'alto', l: 'Alto "', step: '0.25' }], () => ({ ubicacion: '', ancho: null, alto: null }))}
        <datalist id="ubicaciones-dtf">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        <p className="muted small">Al elegir la ubicación en una orden, el ancho y el alto se llenan solos (se pueden cambiar en esa línea).</p>
        <div className="row gap wrap top">
          <div><h4>Precio 1ª ubicación (por área)</h4>{rowsEditor(c.dtf.primera, (n) => n.dtf.primera, [{ k: 'hasta', l: 'Hasta in²', step: '1', ph: 'más' }, { k: 'precio', l: 'PRECIO $' }], () => ({ hasta: 50, precio: null }))}</div>
          <div><h4>Precio ubicación adicional</h4>{rowsEditor(c.dtf.adicional, (n) => n.dtf.adicional, [{ k: 'hasta', l: 'Hasta in²', step: '1', ph: 'más' }, { k: 'precio', l: 'PRECIO $' }], () => ({ hasta: 50, precio: null }))}</div>
        </div>
        <label className="inline">Mínimo de piezas DTF <NumIn disabled={dis} step="1" value={c.dtf.minimo} onChange={(v) => upd((n) => { n.dtf.minimo = v; })} placeholder="sin mínimo" /></label>
        <p className="muted small">La ubicación más cara de la prenda se cobra como 1ª; las demás con la tabla adicional. Tramos: «hasta» incluye el límite (15 in² entra en el primer tramo). Una fila sin «hasta» es el tramo final.</p>
      </section>

      <section className="card">
        <h3>D) Heat transfer</h3>
        <h4>Por hoja (tramos por cantidad total de hojas)</h4>
        {rowsEditor(c.heatTransfer.hojas, (n) => n.heatTransfer.hojas, [{ k: 'cantidadDesde', l: 'Desde (hojas)', step: '1' }, { k: 'costo', l: 'COSTO $/hoja' }, { k: 'precio', l: 'PRECIO $/hoja' }], () => ({ cantidadDesde: 10, costo: null, precio: null }))}
        <div className="row gap wrap">
          <label className="inline">Aplicación por ubicación · COSTO $ <NumIn disabled={dis} value={c.heatTransfer.aplicacion.costo} onChange={(v) => upd((n) => { n.heatTransfer.aplicacion.costo = v; })} /></label>
          <label className="inline">PRECIO $ <NumIn disabled={dis} value={c.heatTransfer.aplicacion.precio} onChange={(v) => upd((n) => { n.heatTransfer.aplicacion.precio = v; })} /></label>
          <label className="inline">Mínimo <NumIn disabled={dis} step="1" value={c.heatTransfer.minimo} onChange={(v) => upd((n) => { n.heatTransfer.minimo = v; })} placeholder="sin mínimo" /></label>
        </div>
        <p className="muted small">Mientras falten valores, toda línea de heat transfer queda con «costo pendiente» y su precio se pone a mano en la línea. El setup se cobra con una línea de Diseño/Setup.</p>
      </section>

      <section className="card">
        <h3>E) Impuesto, márgenes y liquidación</h3>
        <div className="row gap wrap">
          <label className="inline">Impuesto ({c.impuesto.nombre}) % <NumIn disabled={dis} pct value={c.impuesto.tasa} onChange={(v) => upd((n) => { n.impuesto.tasa = v ?? 0; })} /></label>
          <label className="inline">Contribución objetivo % <NumIn disabled={dis} pct value={c.margen.objetivo} onChange={(v) => upd((n) => { n.margen.objetivo = v ?? 0; })} /></label>
          <label className="inline">Contribución mínima % <NumIn disabled={dis} pct value={c.margen.minimo} onChange={(v) => upd((n) => { n.margen.minimo = v ?? 0; })} /></label>
          <label className="inline">Día de pago de comisiones <NumIn disabled={dis} step="1" value={c.liquidacion.diaPago} onChange={(v) => upd((n) => { n.liquidacion.diaPago = v; })} /></label>
        </div>
        <p className="muted small">Impuesto sobre productos + envío cobrado; clientes exentos = 0%. Verde ≥ objetivo · amarillo entre mínimo y objetivo · rojo bajo el mínimo (aprueba gerencia) · contribución negativa: excepción del dueño.</p>
      </section>

      {editable && changed && (
        <div className="save-bar">
          <input className="grow" placeholder="Nota de esta versión (opcional), p. ej. «Tabla DTF Color Plus 2026-11»" value={nota} onChange={(e) => setNota(e.target.value)} />
          <button className="btn" disabled={!changed} onClick={() => setC(structuredClone(t.config))}>Descartar</button>
          <button className="btn primary" disabled={!changed} onClick={guardar}>Guardar nueva versión</button>
        </div>
      )}
      <section className="card">
        <h3>Versiones</h3>
        <p className="muted small">Vigente: versión {t.id}. Cada cotización guarda la versión con la que se calculó.</p>
        <ul className="list">{t.versiones.map((v) => <li key={v.id}><span>v{v.id} · {v.note || '—'}</span><span className="muted">{v.created_by}</span><span>{fmtDateTime(v.created_at)}</span></li>)}</ul>
      </section>
    </div>
  );
}

// ---------- Comisiones ----------
const BASES = { venta_neta: 'Venta neta de productos', ganancia_producto: 'Ganancia de producto', ganancia_total: 'Ganancia de producto + envío' };
function Comisiones({ editable, notify }) {
  const [vend, reloadV] = useLoad(() => api.get('/vendedores'));
  const [reglas, reloadR] = useLoad(() => api.get('/comisiones/reglas'));
  const [nueva, setNueva] = useState(null);
  const [tasa, setTasa] = useState({});
  if (!vend || !reglas) return <div className="loading">Cargando…</div>;
  const run = async (fn, msg) => { try { await fn(); notify(msg); reloadV(); reloadR(); } catch (e) { notify(e.message, true); } };
  return (
    <div className="settings-grid">
      <section className="card">
        <h3>Vendedores</h3>
        <ul className="list">
          {vend.map((v) => (
            <li key={v.id} className="vendedor-fila"><strong>{v.name}</strong><span className="muted">{v.active ? 'activo' : 'inactivo'}</span>
              <label className="inline small">Regla automática
                <select disabled={!editable} value={v.default_rule_id || ''} onChange={(e) => run(() => api.put(`/vendedores/${v.id}`, { default_rule_id: e.target.value ? Number(e.target.value) : null }), 'Regla automática actualizada')}>
                  <option value="">— la primera activa —</option>
                  {reglas.filter((r) => r.active && (r.salesperson_id === v.id || !r.salesperson_id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              {editable && <button className="link-btn" onClick={() => run(() => api.put(`/vendedores/${v.id}`, { active: !v.active }), 'Actualizado')}>{v.active ? 'Desactivar' : 'Activar'}</button>}</li>
          ))}
        </ul>
        {editable && <button className="link-btn" onClick={() => { const name = prompt('Nombre del vendedor'); if (name) run(() => api.post('/vendedores', { name }), 'Vendedor agregado'); }}>+ vendedor</button>}
      </section>
      <section className="card wide">
        <h3>Reglas de comisión</h3>
        <p className="muted small">La base excluye impuesto, envío, líneas de Diseño/Digitalizado y productos marcados «no comisionable». Si la base sobre ganancia sale negativa, la comisión es $0. La tasa usada es la vigente en la fecha de factura.</p>
        <table className="table">
          <thead><tr><th>Regla</th><th>Vendedor</th><th>Base</th><th>Cliente</th><th>Tasa vigente</th><th>Historial de tasas</th>{editable && <th>Nueva tasa</th>}</tr></thead>
          <tbody>
            {reglas.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'muted'}>
                <td><strong>{r.name}</strong>{!r.active && ' (inactiva)'}</td>
                <td>{r.salesperson_name || 'Cualquiera'}</td>
                <td>{editable ? <select value={r.base} onChange={(e) => run(() => api.put(`/comisiones/reglas/${r.id}`, { base: e.target.value }), 'Base actualizada')}>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : BASES[r.base]}</td>
                <td>{r.client_type || '—'}</td>
                <td><strong>{(() => { const t = r.tasas.find((x) => x.effective_from <= today()); return t ? `${Math.round(t.rate * 10000) / 100}%` : '—'; })()}</strong></td>
                <td className="small">{r.tasas.map((t) => <div key={t.id}>{Math.round(t.rate * 10000) / 100}% desde {t.effective_from === '2000-01-01' ? 'el inicio' : t.effective_from}</div>)}</td>
                {editable && (
                  <td>
                    <div className="row gap">
                      <input type="number" step="0.5" className="mini" placeholder="%" value={tasa[r.id]?.rate ?? ''} onChange={(e) => setTasa({ ...tasa, [r.id]: { ...tasa[r.id], rate: e.target.value } })} />
                      <input type="date" value={tasa[r.id]?.date ?? today()} onChange={(e) => setTasa({ ...tasa, [r.id]: { ...tasa[r.id], date: e.target.value } })} />
                      <button className="btn" disabled={tasa[r.id]?.rate === undefined || tasa[r.id]?.rate === ''} onClick={() => run(() => api.post(`/comisiones/reglas/${r.id}/tasas`, { rate: Number(tasa[r.id].rate) / 100, effective_from: tasa[r.id].date || today() }).then(() => setTasa({ ...tasa, [r.id]: {} })), 'Tasa agregada')}>Agregar</button>
                    </div>
                    <button className="link-btn small" onClick={() => run(() => api.put(`/comisiones/reglas/${r.id}`, { active: !r.active }), 'Actualizada')}>{r.active ? 'Desactivar regla' : 'Activar regla'}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {editable && !nueva && <button className="link-btn" onClick={() => setNueva({ name: '', salesperson_id: '', base: 'venta_neta', client_type: '', rate: '', effective_from: today() })}>+ regla</button>}
        {nueva && (
          <div className="row gap wrap">
            <input placeholder="Nombre" value={nueva.name} onChange={(e) => setNueva({ ...nueva, name: e.target.value })} />
            <select value={nueva.salesperson_id} onChange={(e) => setNueva({ ...nueva, salesperson_id: e.target.value })}><option value="">Cualquier vendedor</option>{vend.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <select value={nueva.base} onChange={(e) => setNueva({ ...nueva, base: e.target.value })}>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={nueva.client_type} onChange={(e) => setNueva({ ...nueva, client_type: e.target.value })}><option value="">Todo cliente</option><option value="nuevo">Cliente nuevo</option><option value="existente">Cliente existente</option></select>
            <input type="number" step="0.5" className="mini" placeholder="%" value={nueva.rate} onChange={(e) => setNueva({ ...nueva, rate: e.target.value })} />
            <input type="date" value={nueva.effective_from} onChange={(e) => setNueva({ ...nueva, effective_from: e.target.value })} />
            <button className="btn primary" onClick={() => run(() => api.post('/comisiones/reglas', { ...nueva, salesperson_id: nueva.salesperson_id ? Number(nueva.salesperson_id) : null, rate: Number(nueva.rate) / 100 }).then(() => setNueva(null)), 'Regla creada')}>Crear</button>
            <button className="btn" onClick={() => setNueva(null)}>Cancelar</button>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Usuarios ----------
function Usuarios({ notify }) {
  const meta = useMeta();
  const [users, reload] = useLoad(() => api.get('/usuarios'));
  const [vend] = useLoad(() => api.get('/vendedores'));
  const [f, setF] = useState({ name: '', username: '', password: '', role: 'ventas', salesperson_id: '' });
  if (!users || !vend) return <div className="loading">Cargando…</div>;
  const run = async (fn, msg) => { try { await fn(); notify(msg); reload(); } catch (e) { notify(e.message, true); } };
  return (
    <section className="card">
      <h3>Usuarios</h3>
      <table className="table">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Vendedor</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.username}</td>
              <td><select value={u.role} disabled={u.id === meta.user.id} onChange={(e) => run(() => api.put(`/usuarios/${u.id}`, { role: e.target.value }), 'Rol actualizado')}>{Object.entries(meta.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td><select value={u.salesperson_id || ''} onChange={(e) => run(() => api.put(`/usuarios/${u.id}`, { salesperson_id: e.target.value ? Number(e.target.value) : null }), 'Actualizado')}><option value="">—</option>{vend.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></td>
              <td>{u.active ? 'activo' : 'inactivo'}</td>
              <td className="row gap">
                {u.id !== meta.user.id && <button className="link-btn" onClick={() => run(() => api.put(`/usuarios/${u.id}`, { active: !u.active }), 'Actualizado')}>{u.active ? 'Desactivar' : 'Activar'}</button>}
                <button className="link-btn" onClick={() => { const p = prompt('Nueva contraseña (mínimo 8 caracteres)'); if (p) run(() => api.put(`/usuarios/${u.id}`, { password: p }), 'Contraseña cambiada'); }}>Cambiar contraseña</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Nuevo usuario</h4>
      <form className="row gap wrap" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/usuarios', { ...f, salesperson_id: f.salesperson_id ? Number(f.salesperson_id) : null }).then(() => setF({ ...f, name: '', username: '', password: '' })), 'Usuario creado'); }}>
        <input required placeholder="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input required placeholder="Usuario" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input required type="password" minLength={8} placeholder="Contraseña" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(meta.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.salesperson_id} onChange={(e) => setF({ ...f, salesperson_id: e.target.value })}><option value="">Sin vendedor</option>{vend.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <button className="btn primary">Crear</button>
      </form>
      <p className="muted small"><strong>Dueño:</strong> todo · <strong>Finanzas (CFO):</strong> costos reales, confirmar costos, revisar y marcar liquidaciones pagadas, reportes · <strong>Gerencia:</strong> aprobar márgenes bajos, ver reportes y liquidaciones · <strong>Coordinación de ventas:</strong> vende y ve todo (clientes, órdenes, márgenes, liquidaciones y reportes), aprueba márgenes bajos, asigna clientes a los vendedores y manda a producción · <strong>Ventas:</strong> solo sus propios clientes y órdenes · <strong>Logística:</strong> órdenes y producción, sin costos ni márgenes.</p>
    </section>
  );
}

// ---------- Historial ----------
const AREAS = { '': 'Todo', tarifas: 'Tarifas', comisiones: 'Comisiones', productos: 'Productos', costos: 'Costos', creditos: 'Créditos', liquidacion: 'Liquidaciones', aprobacion_margen: 'Aprobaciones de margen', ordenes: 'Órdenes', pagos: 'Pagos', ajustes: 'General' };
const show = (v) => { if (v == null) return '—'; try { const x = JSON.parse(v); return typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x); } catch { return v; } };
function Historial() {
  const [area, setArea] = useState('');
  const [rows] = useLoad(() => api.get(`/auditoria${area ? `?area=${area}` : ''}`), [area]);
  return (
    <section className="card no-pad">
      <div className="row gap pad"><select value={area} onChange={(e) => setArea(e.target.value)}>{Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><span className="muted small">Últimos 500 cambios</span></div>
      <table className="table">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Área</th><th>Qué</th><th>Antes</th><th>Después</th><th>Ref.</th></tr></thead>
        <tbody>{rows?.map((r) => (
          <tr key={r.id}><td className="small">{fmtDateTime(r.at)}</td><td>{r.user_name}</td><td>{AREAS[r.area] || r.area}</td><td className="small">{r.field}</td><td className="small mono">{show(r.old_value)}</td><td className="small mono">{show(r.new_value)}</td><td className="small muted">{r.ref}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

// ---------- General ----------
function General({ notify }) {
  const meta = useMeta();
  const s = meta.settings;
  const [f, setF] = useState({ business_name: s.business_name, deposit_pct: s.deposit_pct * 100 });
  async function save(e) {
    e.preventDefault();
    try { await api.put('/settings', { business_name: f.business_name, deposit_pct: Number(f.deposit_pct) / 100 }); await meta.reloadMeta(); notify('Guardado'); } catch (err) { notify(err.message, true); }
  }
  return (
    <div className="settings-grid">
      <Marca notify={notify} />
      <EstadoIA />
      <Respaldos notify={notify} />
      <form className="card form" onSubmit={save}>
        <h3>Negocio</h3>
        <Field label="Nombre del negocio"><input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} /></Field>
        <Field label="Anticipo sugerido (%)"><input type="number" value={f.deposit_pct} onChange={(e) => setF({ ...f, deposit_pct: e.target.value })} /></Field>
        <div className="row end"><button className="btn primary">Guardar</button></div>
        <p className="muted small">Mensajes al cliente: el sistema no envía correos ni SMS. Las automatizaciones de envío vienen apagadas.</p>
      </form>
    </div>
  );
}

function Marca({ notify }) {
  const meta = useMeta();
  const b = meta.brand || {};
  const [colores, setColores] = useState({ primary: b.primary, sidebar: b.sidebar });
  const [busy, setBusy] = useState(null);
  async function subir(file, tipo) {
    if (!file) return;
    setBusy(tipo);
    try {
      const data = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(file); });
      await api.post('/settings/logo', { file: data, tipo });
      await meta.reloadMeta();
      notify(tipo === 'icon' ? 'Ícono actualizado' : 'Logo actualizado');
    } catch (e) { notify(e.message, true); }
    setBusy(null);
  }
  async function restaurar(tipo) { await api.del(`/settings/logo?tipo=${tipo}`); await meta.reloadMeta(); notify('Restaurado al de Color Plus'); }
  async function guardarColores(valores) {
    try { await api.put('/settings', { brand_primary: valores.primary, brand_sidebar: valores.sidebar }); await meta.reloadMeta(); notify('Colores guardados'); } catch (e) { notify(e.message, true); }
  }
  const esPropio = (u) => u?.startsWith('/uploads/');
  return (
    <section className="card brand-card">
      <h3>Marca: logo y colores</h3>
      <p className="muted small">Por defecto el sistema usa la marca de Color Plus. Aquí puedes reemplazar el logo, el ícono o los colores; cada cambio queda en el historial.</p>
      <div className="brand-preview" style={{ background: colores.sidebar }}>
        <img src={b.icon} alt="Ícono" className="brand-mark" />
        <strong style={{ color: '#fff' }}>{meta.settings.business_name}</strong>
        <span className="btn primary" style={{ background: colores.primary, borderColor: colores.primary, marginLeft: 'auto' }}>Botón</span>
      </div>
      <div className="brand-assets">
        <div>
          <div className="asset-box"><img src={b.logo} alt="Logo completo" /></div>
          <strong className="small">Logo completo</strong>
          <div className="muted small">Inicio de sesión, portal del cliente y PDF</div>
          <label className="link-btn">{busy === 'logo' ? 'Subiendo…' : 'Cambiar'}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { subir(e.target.files[0], 'logo'); e.target.value = ''; }} /></label>
          {esPropio(b.logo) && <button className="link-btn" onClick={() => restaurar('logo')}>Volver al de Color Plus</button>}
        </div>
        <div>
          <div className="asset-box dark" style={{ background: colores.sidebar }}><img src={b.icon} alt="Ícono" /></div>
          <strong className="small">Ícono</strong>
          <div className="muted small">Menú lateral y pestaña del navegador</div>
          <label className="link-btn">{busy === 'icon' ? 'Subiendo…' : 'Cambiar'}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { subir(e.target.files[0], 'icon'); e.target.value = ''; }} /></label>
          {esPropio(b.icon) && <button className="link-btn" onClick={() => restaurar('icon')}>Volver al de Color Plus</button>}
        </div>
      </div>
      <div className="row gap wrap">
        <label className="inline">Color principal <input type="color" value={colores.primary} onChange={(e) => setColores({ ...colores, primary: e.target.value })} /> <code>{colores.primary}</code></label>
        <label className="inline">Menú lateral <input type="color" value={colores.sidebar} onChange={(e) => setColores({ ...colores, sidebar: e.target.value })} /> <code>{colores.sidebar}</code></label>
      </div>
      <div className="brand-strip" title="Colores del logo" />
      <div className="row gap wrap">
        <button className="btn primary" onClick={() => guardarColores(colores)}>Guardar colores</button>
        <button className="btn" onClick={() => { guardarColores({ primary: null, sidebar: null }).then(() => meta.reloadMeta()).then(() => {}); setColores({ primary: '#613bbb', sidebar: '#1c1340' }); }}>Colores de Color Plus</button>
      </div>
    </section>
  );
}

function EstadoIA() {
  const meta = useMeta();
  const [e] = useLoad(() => api.get('/ia/estado'));
  const [prueba, setPrueba] = useState(null);
  if (!e) return null;
  async function probar() {
    setPrueba({ cargando: true });
    try { setPrueba(await api.post('/ia/probar')); } catch (err) { setPrueba({ error: err.message }); }
  }
  const NOMBRES = { prueba: 'Prueba de conexión', cotizar: 'Cotizar desde mensaje', preguntar: 'Don Pixel (preguntas)', redactar: 'Redactar mensajes', email: 'Don Pixel (responder emails)', ideas: 'Don Pixel (ideas de venta)' };
  return (
    <section className="card">
      <h3>✨ Inteligencia artificial</h3>
      {e.configurada ? <p className="ok">Clave cargada · modelo <code>{e.modelo}</code></p> : <p className="warn-txt">Don Pixel no está conectado: falta <code>ANTHROPIC_API_KEY</code> en Render → Environment.</p>}
      {e.configurada && meta.user.role === 'duena' && (
        <div className="row gap wrap">
          <button className="btn" onClick={probar} disabled={prueba?.cargando}>{prueba?.cargando ? 'Probando…' : '🔌 Probar conexión'}</button>
          {prueba?.ok && <span className="ok small">✓ Conectado. Don Pixel dice: «{prueba.respuesta}»</span>}
          {prueba?.error && <span className="danger small">✗ {prueba.error}</span>}
        </div>
      )}
      {e.usoDelMes?.length > 0 && (
        <table className="table mini-table">
          <thead><tr><th>Uso de este mes</th><th className="num">Consultas</th><th className="num">Tokens</th></tr></thead>
          <tbody>{e.usoDelMes.map((u) => <tr key={u.feature}><td>{NOMBRES[u.feature] || u.feature}</td><td className="num">{u.consultas}</td><td className="num">{(u.entrada + u.salida).toLocaleString('es')}</td></tr>)}</tbody>
        </table>
      )}
      <p className="muted small">La IA arma borradores y responde preguntas; no guarda, no envía ni cobra nada por su cuenta. Límite: 40 consultas por hora por usuario. El costo se ve en console.anthropic.com.</p>
    </section>
  );
}

function Respaldos({ notify }) {
  const [lista, reload] = useLoad(() => api.get('/respaldos'));
  const [busy, setBusy] = useState(false);
  async function ahora() {
    setBusy(true);
    try { await api.post('/respaldos'); notify('Respaldo creado'); reload(); } catch (e) { notify(e.message, true); }
    setBusy(false);
  }
  const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
  return (
    <section className="card">
      <div className="row between"><h3>Respaldos de la base de datos</h3><button className="btn" disabled={busy} onClick={ahora}>{busy ? 'Creando…' : 'Respaldar ahora'}</button></div>
      <p className="muted small">Se crea uno automático cada día y se guardan los últimos 14 en el servidor. <strong>Descarga uno cada semana</strong> y guárdalo en tu Drive: así tienes una copia fuera del servidor.</p>
      <ul className="list">
        {lista?.map((r) => (
          <li key={r.nombre}><span>{r.nombre}</span><span className="muted small">{mb(r.bytes)}</span><a className="btn" href={`/api/respaldos/${encodeURIComponent(r.nombre)}`}>⬇ Descargar</a></li>
        ))}
        {lista && !lista.length && <li className="muted">Todavía no hay respaldos.</li>}
      </ul>
    </section>
  );
}
