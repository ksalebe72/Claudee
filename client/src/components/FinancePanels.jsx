import React, { useState } from 'react';
import { api } from '../api.js';
import { money, fmtDate, fmtDateTime, today } from '../utils.js';
import { CATEGORIAS_COSTO } from '../../../shared/pricing.js';

const pend = (v, txt = 'pendiente') => (v == null ? <span className="warn-txt">{txt}</span> : money(v));
export const SEMAFORO = {
  verde: { tone: 'green', label: 'Verde · sobre el objetivo' },
  amarillo: { tone: 'amber', label: 'Amarillo · entre mínimo y objetivo' },
  rojo: { tone: 'red', label: 'Rojo · bajo el mínimo' },
  incompleta: { tone: 'gray', label: 'Incompleta · falta un costo o precio' },
};
export function Semaforo({ fin, small }) {
  const s = SEMAFORO[fin?.semaforo || 'incompleta'];
  return <span className={`badge tone-${s.tone} ${small ? '' : 'semaforo'}`} title={s.label}>● {fin?.contribucionPct == null ? (small ? 'incompleta' : s.label) : `${fin.contribucionPct}%`}</span>;
}
const BASES = { venta_neta: 'venta neta de productos', ganancia_producto: 'ganancia de producto', ganancia_total: 'ganancia de producto + envío' };

/** Resumen de rentabilidad, comisión, semáforo y aprobación de margen. */
export function RentabilidadCard({ fin, preview, margen, user, jobId, onUpdated, notify }) {
  const [nota, setNota] = useState('');
  const req = fin.aprobacion?.requerida ?? fin.aprobacionRequerida;
  const otorgada = fin.aprobacion?.otorgada;
  const ok = fin.aprobacion ? fin.aprobacion.ok : !req;
  const puede = req === 'duena' ? user.role === 'duena' : ['gerencia', 'coordinacion', 'duena'].includes(user.role);
  async function aprobar() {
    try { await api.post(`/jobs/${jobId}/aprobar-margen`, { nota }); setNota(''); onUpdated(); notify('Aprobación registrada'); } catch (e) { notify(e.message, true); }
  }
  const c = fin.comision;
  return (
    <section className="card totals">
      <div className="row between"><h3>Rentabilidad</h3><Semaforo fin={fin} /></div>
      {preview && <p className="muted small">Vista previa con cambios sin guardar.</p>}
      <div className="row between"><span>Venta de productos</span><span>{money(fin.ventaProductos)}</span></div>
      {fin.descuentoGlobal > 0 && <div className="row between small muted"><span>Descuento global</span><span>−{money(fin.descuentoGlobal)}</span></div>}
      {fin.creditos > 0 && <div className="row between small muted"><span>Créditos / devoluciones</span><span>−{money(fin.creditos)}</span></div>}
      <div className="row between"><span>Envío cobrado</span><span>{money(fin.envioCobrado)}</span></div>
      <div className="row between"><span>Ingreso sin impuesto</span><strong>{money(fin.ingresoSinImpuesto)}</strong></div>
      <div className="row between"><span>Impuesto {fin.tasaImpuesto ? `${Math.round(fin.tasaImpuesto * 10000) / 100}%` : '(exento)'}</span><span>{money(fin.impuesto)}</span></div>
      <div className="row between total"><span>Total factura</span><span>{money(fin.total)}</span></div>
      <hr />
      <div className="row between"><span>Costo de producto</span><span>{pend(fin.costoProducto, 'incompleto')}</span></div>
      {fin.diferenciaCosto != null && <div className="row between small"><span>Cotizado {money(fin.costoProductoCotizado)} → real</span><span className={fin.diferenciaCosto > 0 ? 'danger' : 'ok'}>{fin.diferenciaCosto > 0 ? '+' : ''}{money(fin.diferenciaCosto)}</span></div>}
      <div className="row between"><span>Ganancia de producto</span><span>{pend(fin.gananciaProducto, '—')}</span></div>
      <div className="row between"><span>Ganancia de envío</span><span>{pend(fin.gananciaEnvio, '—')}</span></div>
      <div className="row between"><span>Ganancia bruta</span><strong>{pend(fin.gananciaBruta, '—')}</strong></div>
      <div className="row between"><span>Comisión {c.tasa != null && c.regla ? `(${Math.round(c.tasa * 1000) / 10}%)` : ''}</span><span>{c.estado === 'sin_regla' ? <span className="muted">sin regla</span> : c.estado === 'dueno' ? <span className="muted">dueño · sin comisión</span> : pend(c.monto)}</span></div>
      {c.regla && <div className="muted small">{c.regla} · sobre {BASES[c.baseTipo]}{c.base != null ? ` · base ${money(c.base)}` : ''}{c.motivo ? ` · ${c.motivo}` : ''}</div>}
      <div className="row between total"><span>Contribución</span><span>{pend(fin.contribucion, '—')}{fin.contribucionPct != null && <small> ({fin.contribucionPct}%)</small>}</span></div>
      {margen && <div className="muted small">Objetivo {Math.round(margen.objetivo * 100)}% · mínimo {Math.round(margen.minimo * 100)}%</div>}

      {(fin.faltantes?.length > 0 || fin.faltantesPrecio?.length > 0) && (
        <div className="missing-box">
          <strong>Incompleta: falta</strong>
          <ul>{[...fin.faltantesPrecio, ...fin.faltantes].map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      {fin.avisos?.length > 0 && <ul className="missing">{fin.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}

      {req && (
        <div className={`approval ${ok ? 'ok' : ''}`}>
          {ok ? (
            <p>✔ {req === 'duena' ? 'Excepción autorizada por el dueño' : otorgada?.nivel === 'duena' ? 'Margen aprobado por el dueño' : 'Margen aprobado por gerencia'}: {otorgada?.por} · {fmtDateTime(otorgada?.fecha?.replace('T', ' ').slice(0, 19))}{otorgada?.nota ? ` · «${otorgada.nota}»` : ''}</p>
          ) : (
            <>
              <p><strong>{req === 'duena' ? 'Contribución negativa: requiere excepción del dueño.' : 'Contribución menor al mínimo: requiere aprobación de gerencia.'}</strong> No se puede enviar ni convertir en orden hasta aprobarla.</p>
              {!preview && jobId && puede && (
                <div className="row gap">
                  <input className="grow" placeholder={req === 'duena' ? 'Motivo de la excepción (obligatorio)' : 'Nota (opcional)'} value={nota} onChange={(e) => setNota(e.target.value)} />
                  <button className="btn primary" onClick={aprobar}>{req === 'duena' ? 'Autorizar excepción' : 'Aprobar margen'}</button>
                </div>
              )}
              {!puede && <p className="muted small">Pídele a {req === 'duena' ? 'el dueño' : 'gerencia o al dueño'} que la revise.</p>}
              {preview && <p className="muted small">Guarda los cambios para poder aprobar.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Vendedor, regla de comisión y tipo de cliente. */
export function VendedorCard({ job, set, vendedores, reglas, editable }) {
  const opciones = reglas.filter((r) => r.active && (!r.salesperson_id || r.salesperson_id === Number(job.salesperson_id)));
  return (
    <section className="card">
      <h3>Vendedor y comisión</h3>
      <div className="form-grid three">
        <label className="field"><span>Vendedor</span>
          <select disabled={!editable} value={job.salesperson_id || ''} onChange={(e) => {
            const sp = e.target.value ? Number(e.target.value) : null;
            // Las reglas especiales (wraps) no se sugieren solas: se eligen a mano en la orden
            const especial = (r) => /wrap/i.test(r.name);
            const propias = reglas.filter((r) => r.active && r.salesperson_id === sp).sort((a, b) => especial(a) - especial(b));
            const perfil = vendedores.find((v) => v.id === sp)?.default_rule_id;
            const sugerida = propias.find((r) => r.id === perfil) || propias.find((r) => !r.client_type || r.client_type === job.client_status) || propias[0] || reglas.find((r) => r.name === 'Sin comisión');
            set({ salesperson_id: sp, commission_rule_id: sugerida?.id || null });
          }}>
            <option value="">— Sin vendedor —</option>
            {vendedores.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Regla de comisión</span>
          <select disabled={!editable} value={job.commission_rule_id || ''} onChange={(e) => set({ commission_rule_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— Ninguna —</option>
            {opciones.map((r) => <option key={r.id} value={r.id}>{r.name} · {Math.round((r.tasas[0]?.rate ?? 0) * 1000) / 10}%</option>)}
          </select>
        </label>
        <label className="field"><span>Cliente</span>
          <select disabled={!editable} value={job.client_status_manual ? job.client_status : ''} onChange={(e) => set(e.target.value ? { client_status: e.target.value, client_status_manual: 1 } : { client_status: '', client_status_manual: 0 })}>
            <option value="">Automático ({job.client_status || 'nuevo'})</option>
            <option value="nuevo">Nuevo (a mano)</option>
            <option value="existente">Existente (a mano)</option>
          </select>
        </label>
      </div>
      <p className="muted small">Automático: «existente» si el cliente tiene otra orden cobrada al 100%. Si la regla depende del tipo de cliente, se ajusta sola.</p>
    </section>
  );
}

/** Envío, costos extra, descuento global e impuesto. */
export function EnvioCostosCard({ job, set, editable }) {
  const extras = job.extra_costs || [];
  const setExtra = (i, patch) => set({ extra_costs: extras.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <section className="card">
      <h3>Envío, setup y otros costos</h3>
      <div className="form-grid three">
        <label className="field"><span>Envío cobrado al cliente</span><input type="number" step="0.01" disabled={!editable} value={job.shipping_charged ?? ''} onChange={(e) => set({ shipping_charged: e.target.value })} placeholder="0" /></label>
        <label className="field"><span>Costo de envío</span><input type="number" step="0.01" disabled={!editable} value={job.shipping_cost ?? ''} onChange={(e) => set({ shipping_cost: e.target.value })} placeholder="desconocido" /></label>
        <label className="field"><span>Descuento global $</span><input type="number" step="0.01" disabled={!editable} value={job.discount ?? ''} onChange={(e) => set({ discount: e.target.value })} placeholder="0" /></label>
      </div>
      <label className="inline"><input type="checkbox" disabled={!editable} checked={!!job.tax_exempt} onChange={(e) => set({ tax_exempt: e.target.checked ? 1 : 0 })} /> Cliente exento de impuesto</label>
      <div className="stack-sm extras">
        <div className="muted small">Costos directos de la orden (no se cobran aparte; reducen la ganancia)</div>
        {extras.map((x, i) => (
          <div key={i} className="row gap">
            <select disabled={!editable} value={x.tipo || 'otro'} onChange={(e) => setExtra(i, { tipo: e.target.value })}><option value="setup">Setup</option><option value="otro">Otro directo</option></select>
            <input className="grow" disabled={!editable} value={x.concepto || ''} placeholder="Concepto" onChange={(e) => setExtra(i, { concepto: e.target.value })} />
            <input type="number" step="0.01" className="mini" disabled={!editable} value={x.monto ?? ''} placeholder="monto" onChange={(e) => setExtra(i, { monto: e.target.value })} />
            {editable && <button className="icon-btn" onClick={() => set({ extra_costs: extras.filter((_, j) => j !== i) })}>×</button>}
          </div>
        ))}
        {editable && <button className="link-btn" onClick={() => set({ extra_costs: [...extras, { tipo: 'setup', concepto: '', monto: '' }] })}>+ costo directo</button>}
      </div>
    </section>
  );
}

/** Costos reales de facturas de proveedor y confirmación de costos (Finanzas). */
export function CostosRealesCard({ job, user, onUpdated, notify }) {
  const puede = ['finanzas', 'duena'].includes(user.role);
  const [f, setF] = useState({ category: 'prendas', supplier: 'SanMar', invoice_ref: '', amount: '', cost_date: today() });
  const fin = job.finanzas;
  async function add(e) {
    e.preventDefault();
    try { await api.post(`/jobs/${job.id}/costos-reales`, f); setF({ ...f, invoice_ref: '', amount: '' }); onUpdated(); notify('Costo real registrado'); } catch (err) { notify(err.message, true); }
  }
  async function del(c) { if (confirm('¿Eliminar este costo real?')) { await api.del(`/costos-reales/${c.id}`); onUpdated(); } }
  async function confirmar(v) { try { await api.post(`/jobs/${job.id}/confirmar-costos`, { confirmar: v }); onUpdated(); notify(v ? 'Costos confirmados' : 'Confirmación retirada'); } catch (err) { notify(err.message, true); } }
  const cats = Object.keys(CATEGORIAS_COSTO);
  return (
    <section className="card">
      <h3>Costos reales (facturas de proveedor)</h3>
      <table className="table mini-table">
        <thead><tr><th>Categoría</th><th className="num">Cotizado</th><th className="num">Real</th></tr></thead>
        <tbody>
          {cats.filter((c) => fin.costos.cotizado[c] !== 0 || fin.costos.reales[c] != null).map((c) => (
            <tr key={c}><td>{CATEGORIAS_COSTO[c]}</td><td className="num">{pend(fin.costos.cotizado[c], 'desconocido')}</td><td className="num">{fin.costos.reales[c] != null ? money(fin.costos.reales[c]) : '—'}</td></tr>
          ))}
        </tbody>
      </table>
      <ul className="list">
        {job.costosReales.map((c) => (
          <li key={c.id}><span>{CATEGORIAS_COSTO[c.category]} · {c.supplier || '—'} {c.invoice_ref ? `#${c.invoice_ref}` : ''}<div className="muted small">{fmtDate(c.cost_date)} · {c.created_by}</div></span><strong>{money(c.amount)}</strong>{puede && <button className="icon-btn" onClick={() => del(c)}>×</button>}</li>
        ))}
      </ul>
      {puede && (
        <form className="stack-sm" onSubmit={add}>
          <div className="row gap">
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c} value={c}>{CATEGORIAS_COSTO[c]}</option>)}</select>
            <input list="proveedores" placeholder="Proveedor" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
          </div>
          <datalist id="proveedores">{['SanMar', 'S&S Activewear', 'Halftone', 'UPS', 'FedEx', 'USPS'].map((p) => <option key={p} value={p} />)}</datalist>
          <div className="row gap">
            <input placeholder="# factura" value={f.invoice_ref} onChange={(e) => setF({ ...f, invoice_ref: e.target.value })} />
            <input type="number" step="0.01" placeholder="Monto" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div className="row gap"><input type="date" value={f.cost_date} onChange={(e) => setF({ ...f, cost_date: e.target.value })} /><button className="btn">Agregar</button></div>
          <p className="muted small">El costo real reemplaza al cotizado en su categoría.</p>
        </form>
      )}
      <div className={`approval ${fin.costosConfirmados ? 'ok' : ''}`}>
        {fin.costosConfirmados
          ? <p>✔ Costos confirmados por {fin.costosConfirmadosPor} · {fmtDateTime(fin.costosConfirmadosEn)} {puede && <button className="link-btn small" onClick={() => confirmar(false)}>Retirar</button>}</p>
          : <p>Costos sin confirmar. La comisión no entra a liquidación hasta confirmarlos. {puede && <button className="btn" disabled={fin.faltantes.length > 0} onClick={() => confirmar(true)}>Confirmar costos</button>}</p>}
      </div>
    </section>
  );
}

const TIPOS_CREDITO = { descuento: 'Descuento posterior', credito: 'Crédito', devolucion: 'Devolución' };
/** Créditos, descuentos posteriores y devoluciones: reducen la venta y la base de comisión. */
export function CreditosCard({ job, user, onUpdated, notify }) {
  const puede = ['finanzas', 'duena'].includes(user.role);
  const [f, setF] = useState({ type: 'devolucion', amount: '', credit_date: today(), note: '' });
  async function add(e) {
    e.preventDefault();
    try { await api.post(`/jobs/${job.id}/creditos`, f); setF({ ...f, amount: '', note: '' }); onUpdated(); notify('Registrado'); } catch (err) { notify(err.message, true); }
  }
  async function del(c) { if (confirm('¿Eliminar?')) { await api.del(`/creditos/${c.id}`); onUpdated(); } }
  if (!puede && !job.creditos.length) return null;
  return (
    <section className="card">
      <h3>Créditos y devoluciones</h3>
      <ul className="list">
        {job.creditos.map((c) => <li key={c.id}><span>{TIPOS_CREDITO[c.type]}{c.note ? ` · ${c.note}` : ''}<div className="muted small">{fmtDate(c.credit_date)} · {c.created_by}</div></span><strong>−{money(c.amount)}</strong>{puede && <button className="icon-btn" onClick={() => del(c)}>×</button>}</li>)}
      </ul>
      {puede && (
        <form className="stack-sm" onSubmit={add}>
          <div className="row gap">
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TIPOS_CREDITO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input type="number" step="0.01" placeholder="Monto (sin impuesto)" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </div>
          <div className="row gap"><input type="date" value={f.credit_date} onChange={(e) => setF({ ...f, credit_date: e.target.value })} /><input className="grow" placeholder="Nota" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /><button className="btn">Agregar</button></div>
          <p className="muted small">Reduce la venta y la base comisionable. Si la comisión ya se pagó, se crea un ajuste negativo en la siguiente liquidación.</p>
        </form>
      )}
    </section>
  );
}
