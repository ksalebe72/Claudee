import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fileToDataUrl } from '../api.js';
import { money, fmtDate, fmtDateTime, label, today, useLoad } from '../utils.js';
import { Badge, Field, PageHeader, useMeta, useToast } from '../components/ui.jsx';
import { calcularLinea, calcularRentabilidad } from '../../../shared/pricing.js';
import ProofDesigner from '../components/designer/ProofDesigner.jsx';
import { LineEditor, emptyPrenda, emptyDiseno } from '../components/JobLines.jsx';
import { RentabilidadCard, VendedorCard, EnvioCostosCard, CostosRealesCard, CreditosCard } from '../components/FinancePanels.jsx';
import { RedactarIAModal } from '../components/IA.jsx';

/** Regla de comisión con la tasa vigente (misma lógica que el servidor). */
function reglaVigente(reglas, job) {
  let r = reglas.find((x) => x.id === Number(job.commission_rule_id));
  if (!r) return null;
  if (r.client_type && job.client_status && r.client_type !== job.client_status) {
    r = reglas.find((x) => x.salesperson_id === r.salesperson_id && x.client_type === job.client_status && x.active) || r;
  }
  const fecha = job.invoice_date || today();
  const tasa = r.tasas.find((t) => t.effective_from <= fecha);
  return { nombre: r.name, base: r.base, tasa: tasa ? tasa.rate : null };
}

export default function JobEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const ubicacion = useLocation();
  const meta = useMeta();
  const user = meta.user;
  const [products, , setProducts] = useLoad(() => api.get('/products'));
  // Trae un estilo de SanMar al catálogo y lo deja disponible en la lista sin recargar la página
  const importarSanmar = async (style) => {
    const p = await api.post('/sanmar/import', { style });
    setProducts((lista) => [...(lista || []).filter((x) => x.id !== p.id), p]);
    return p;
  };
  const [methodsList] = useLoad(() => api.get('/methods'));
  const [contacts] = useLoad(() => api.get('/contacts'));
  const [opps] = useLoad(() => api.get('/opportunities'));
  const [vendedores] = useLoad(() => api.get('/vendedores'));
  const [reglas] = useLoad(() => api.get('/comisiones/reglas'));
  const [tarifas] = useLoad(() => api.get('/tarifas'));
  const [job, setJob] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, notify] = useToast();
  const [designer, setDesigner] = useState(null);
  const [redactar, setRedactar] = useState(false);

  const reload = () => api.get(`/jobs/${id}`).then((j) => { setJob(j); setDirty(false); });
  useEffect(() => {
    if (id) reload();
    else {
      const contact_id = params.get('contact') ? Number(params.get('contact')) : '';
      setJob({
        kind: 'quote', status: 'borrador', title: '', notes: '', discount: '', contact_id,
        opportunity_id: params.get('opp') ? Number(params.get('opp')) : '',
        items: [emptyPrenda()], proofs: [], payments: [], extra_costs: [], shipping_charged: '', shipping_cost: '',
        tax_exempt: 0, salesperson_id: user.salesperson_id || null, commission_rule_id: null, client_status: '', client_status_manual: 0,
      });
      setDirty(true);
    }
  }, [id]);

  // Cotización nueva hecha por un vendedor: se pone sola la regla automática de su perfil
  useEffect(() => {
    if (id || !job || job.commission_rule_id || !job.salesperson_id || !vendedores || !reglas) return;
    const perfil = vendedores.find((v) => v.id === Number(job.salesperson_id))?.default_rule_id;
    const regla = reglas.find((r) => r.id === perfil && r.active);
    if (regla) setJob((j) => ({ ...j, commission_rule_id: regla.id }));
  }, [id, job?.salesperson_id, vendedores, reglas]);

  // Viene de «🎨 Proof» en una orden nueva: al guardarse, se abre el decorador
  useEffect(() => {
    if (id && job?.id === Number(id) && ubicacion.state?.abrirDecorador) {
      setDesigner({ initialDesign: null });
      nav(ubicacion.pathname, { replace: true, state: null });
    }
  }, [id, job?.id, ubicacion.state]);

  const cfg = job?.pricing?.config || tarifas?.config;
  const calcs = useMemo(() => (job && cfg ? job.items.map((it) => calcularLinea(it, cfg)) : []), [job, cfg]);
  // Rentabilidad para un juego de líneas (se usa en la vista previa y en «Ajustar a meta»)
  const rentabilidadDe = (lineas) => calcularRentabilidad({
    lineas, descuentoGlobal: job.discount, creditos: job.finanzas?.creditos || 0,
    envioCobrado: job.shipping_charged, costoEnvio: job.shipping_cost, costosExtra: job.extra_costs || [],
    tasaImpuesto: cfg.impuesto.tasa, exento: !!job.tax_exempt, reales: job.finanzas?.costos?.reales || {},
    regla: reglaVigente(reglas, job), margen: cfg.margen,
  });
  const finPreview = useMemo(() => {
    if (!job || !cfg || !reglas) return null;
    return calcularRentabilidad({
      lineas: calcs, descuentoGlobal: job.discount, creditos: job.finanzas?.creditos || 0,
      envioCobrado: job.shipping_charged, costoEnvio: job.shipping_cost, costosExtra: job.extra_costs || [],
      tasaImpuesto: cfg.impuesto.tasa, exento: !!job.tax_exempt, reales: job.finanzas?.costos?.reales || {},
      regla: reglaVigente(reglas, job), margen: cfg.margen,
    });
  }, [job, cfg, calcs, reglas]);

  if (!job || !products || !methodsList || !reglas || !vendedores || !cfg) return <div className="loading">Cargando…</div>;

  const isOrder = job.kind === 'order';
  const logistica = user.role === 'logistica'; // ve la orden y mueve producción; sin precios de costo ni márgenes
  const editable = !logistica && (!id || job.kind === 'quote' || ['arte', 'aprobacion'].includes(job.status));
  const fin = dirty || !job.finanzas ? { ...finPreview, aprobacion: { requerida: finPreview.aprobacionRequerida, otorgada: job.margin_approval, ok: !finPreview.aprobacionRequerida || (job.margin_approval && ({ gerencia: 1, duena: 2 })[job.margin_approval.nivel] >= ({ gerencia: 1, duena: 2 })[finPreview.aprobacionRequerida]) } } : job.finanzas;
  const portalUrl = job.token ? `${location.origin}/portal/${job.token}` : null;
  const tarifaVieja = id && job.kind === 'quote' && tarifas && job.pricing_version_id && job.pricing_version_id !== tarifas.id;
  const finanzasRol = ['finanzas', 'duena'].includes(user.role);

  const set = (patch) => { setJob((j) => ({ ...j, ...patch })); setDirty(true); };
  const setItem = (idx, patch) => set({ items: job.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });

  async function save({ abrirDecorador = false } = {}) {
    const body = {
      title: job.title || 'Cotización', contact_id: job.contact_id || null, opportunity_id: job.opportunity_id || null,
      due_date: job.due_date || null, priority: job.priority, assignee: job.assignee, notes: job.notes,
      discount: job.discount, shipping_charged: job.shipping_charged, shipping_cost: job.shipping_cost, extra_costs: job.extra_costs,
      tax_exempt: job.tax_exempt, salesperson_id: job.salesperson_id || null, commission_rule_id: job.commission_rule_id || null,
      ...(job.client_status_manual ? { client_status: job.client_status } : id ? { client_status: '' } : {}),
      items: job.items.filter((it) => it.product_id || it.description).map(({ calc: _c, ...it }) => it),
    };
    try {
      const saved = id ? await api.put(`/jobs/${id}`, body) : await api.post('/jobs', body);
      setJob(saved); setDirty(false); notify('Guardado');
      if (!id) nav(`/trabajos/${saved.id}`, { replace: true, state: abrirDecorador ? { abrirDecorador: true } : undefined });
      return saved;
    } catch (e) { notify(e.message, true); return null; }
  }
  async function act(path, body, msg) {
    try {
      if (dirty && !(await save())) return;
      const j = await api.post(`/jobs/${job.id}/${path}`, body);
      setJob(j); setDirty(false); notify(msg);
    } catch (e) { notify(e.message, true); }
  }
  async function duplicate() { const j = await api.post(`/jobs/${job.id}/duplicate`); nav(`/trabajos/${j.id}`); }
  async function remove() {
    if (!confirm('¿Eliminar este trabajo?')) return;
    await api.del(`/jobs/${job.id}`);
    nav(isOrder ? '/ordenes' : '/cotizaciones');
  }
  async function setInvoiceDate(v) {
    try { setJob(await api.put(`/jobs/${job.id}`, { invoice_date: v })); notify('Fecha de factura actualizada'); } catch (e) { notify(e.message, true); }
  }

  /**
   * Sube por igual el precio automático de las prendas y sus decoraciones hasta llegar al margen objetivo
   * (después de la comisión del vendedor). Si ya hay un ajuste, busca el mínimo necesario (puede bajarlo).
   */
  function ajustarAMeta() {
    const meta = cfg.margen.objetivo * 100;
    const ajustables = job.items.map((it) => (it.line_type || 'prenda') === 'prenda' && it.price_mode !== 'manual' && (it.product_id || it.description));
    if (!ajustables.some(Boolean)) return notify('No hay prendas con precio automático para ajustar.', true);
    const con = (a) => job.items.map((it, i) => (ajustables[i] ? { ...it, ajuste_pct: a } : it));
    const pct = (a) => rentabilidadDe(con(a).map((it) => calcularLinea(it, cfg))).contribucionPct;
    const base = pct(0);
    if (base == null) return notify('Completa primero los costos que faltan (la rentabilidad está incompleta).', true);
    if (base >= meta) {
      if (job.items.some((it) => Number(it.ajuste_pct) > 0)) { set({ items: con(0) }); notify(`Ajuste quitado: sin él ya da ${base}%.`); }
      else notify(`Esta orden ya da ${base}%: no hace falta ajustar.`);
      return;
    }
    if (pct(5) < meta) return notify('Ni subiendo 500% se llega a la meta: revisa costos o comisión.', true);
    let lo = 0, hi = 5;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (pct(mid) >= meta) hi = mid; else lo = mid; }
    const a = Math.ceil(hi * 10000) / 10000; // a la centésima de %
    set({ items: con(a) });
    notify(`Precios subidos ${Math.round(a * 1000) / 10}% → contribución ${pct(a)}%. Revisa y guarda.`);
  }
  function quitarAjuste() { set({ items: job.items.map((it) => ({ ...it, ajuste_pct: 0 })) }); }

  async function abrirDecorador(proof = null) {
    if (!job.items.some((it) => it.product_id || it.description)) return notify('Agrega primero la prenda a la orden.', true);
    if (!id) { await save({ abrirDecorador: true }); return; } // al guardar se abre solo
    if (dirty && !(await save())) return;
    try {
      const initialDesign = proof ? await api.get(`/proofs/${proof.id}/design`) : null;
      setDesigner({ initialDesign });
    } catch (e) { notify(e.message, true); }
  }

  const contactOpps = (opps || []).filter((o) => o.contact_id === Number(job.contact_id));
  const docNumber = isOrder ? job.order_number : job.number;
  const bloqueado = !fin.aprobacion.ok;

  return (
    <div className="job-editor">
      <PageHeader title={id ? `${docNumber} · ${job.title}` : 'Nueva cotización'} subtitle={id && <>{isOrder ? `De la cotización ${job.number}` : 'Cotización'} · <Badge status={job.status} /> · tarifas v{job.pricing_version_id}</>}>
        {!logistica && <button className="btn primary" onClick={() => abrirDecorador()}>🎨 Proof</button>}
        {id && !logistica && meta.integrations?.ia && <button className="btn ia-btn" onClick={() => setRedactar(true)}>✨ Redactar mensaje</button>}
        {id && <button className="btn" onClick={() => window.print()}>Imprimir</button>}
        {id && !logistica && <button className="btn" onClick={duplicate}>Duplicar</button>}
        {id && !logistica && <button className="btn danger-ghost" onClick={remove}>Eliminar</button>}
        {!logistica && <button className="btn primary" onClick={save} disabled={!dirty && !!id}>{dirty || !id ? 'Guardar' : 'Guardado ✓'}</button>}
      </PageHeader>

      {tarifaVieja && (
        <div className="notice">Esta cotización usa la versión {job.pricing_version_id} de las tarifas; la vigente es la {tarifas.id}. Sus precios no cambian solos.
          <button className="link-btn" onClick={() => act('actualizar-tarifas', {}, 'Recalculada con las tarifas vigentes')}>Recalcular con las tarifas vigentes</button>
        </div>
      )}

      {id && !isOrder && (
        <div className="action-bar">
          <span>Siguiente paso:</span>
          {job.status === 'borrador' && <button className="btn primary" disabled={bloqueado} onClick={() => act('send', {}, 'Cotización marcada como enviada. Comparte el enlace con el cliente.')}>Marcar como enviada</button>}
          {['borrador', 'enviada'].includes(job.status) && <button className="btn" onClick={() => act('approve', { approved: true }, 'Cotización aprobada')}>Marcar aprobada</button>}
          {['borrador', 'enviada'].includes(job.status) && <button className="btn" onClick={() => act('approve', { approved: false }, 'Cotización rechazada')}>Marcar rechazada</button>}
          {job.status !== 'rechazada' && <button className="btn" disabled={bloqueado} onClick={() => act('convert', {}, 'Convertida en orden')}>Convertir en orden</button>}
          {bloqueado && <span className="danger small">Requiere aprobación de margen</span>}
          {portalUrl && <CopyLink url={portalUrl} notify={notify} />}
        </div>
      )}

      {isOrder && (
        <div className="stepper">
          {meta.orderStatuses.map((s, i) => {
            const cur = meta.orderStatuses.indexOf(job.status);
            return (
              <button key={s} className={`step ${i < cur ? 'past' : ''} ${i === cur ? 'current' : ''}`} onClick={() => act('status', { status: s }, `Estado: ${label(s)}`)}>
                <span className="step-n">{i + 1}</span>{label(s)}
              </button>
            );
          })}
          {portalUrl && <CopyLink url={portalUrl} notify={notify} />}
        </div>
      )}

      <div className="job-grid">
        <div className="stack">
          <section className="card">
            <div className="form-grid three">
              <Field label="Título del trabajo"><input value={job.title} onChange={(e) => set({ title: e.target.value })} placeholder="Ej. Uniformes equipo de fútbol" /></Field>
              <Field label="Cliente">
                <select value={job.contact_id || ''} onChange={(e) => {
                  const c = contacts?.find((x) => x.id === Number(e.target.value));
                  set({ contact_id: c ? c.id : '', opportunity_id: '', tax_exempt: c?.tax_exempt ? 1 : 0 });
                }}>
                  <option value="">— Selecciona —</option>
                  {contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ''}</option>)}
                </select>
              </Field>
              <Field label="Oportunidad">
                <select value={job.opportunity_id || ''} onChange={(e) => set({ opportunity_id: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">—</option>
                  {contactOpps.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              </Field>
              <Field label="Fecha de entrega"><input type="date" value={job.due_date || ''} onChange={(e) => set({ due_date: e.target.value })} /></Field>
              <Field label="Prioridad">
                <select value={job.priority || 'normal'} onChange={(e) => set({ priority: e.target.value })}>
                  <option value="baja">Baja</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente (rush)</option>
                </select>
              </Field>
              {isOrder ? (
                <Field label="Fecha de factura">
                  <input type="date" value={job.invoice_date || ''} disabled={!finanzasRol} onChange={(e) => setInvoiceDate(e.target.value)} title="Solo Finanzas o el dueño" />
                </Field>
              ) : <Field label="Responsable"><input value={job.assignee || ''} onChange={(e) => set({ assignee: e.target.value })} placeholder="Quién lo lleva" /></Field>}
            </div>
          </section>

          {job.items.map((it, idx) => (
            <LineEditor key={idx} idx={idx} item={it} calc={calcs[idx]} products={products} editable={editable}
              onImportSanmar={meta.integrations?.sanmar ? importarSanmar : null} tamanosDtf={cfg.dtf.tamanos || []} produccion={logistica}
              onChange={(p) => setItem(idx, p)}
              onRemove={() => set({ items: job.items.filter((_, i) => i !== idx) })}
              onDuplicate={() => set({ items: [...job.items.slice(0, idx + 1), structuredClone(it), ...job.items.slice(idx + 1)] })} />
          ))}
          {editable && (
            <div className="row gap wrap">
              <button className="btn add-line grow" onClick={() => set({ items: [...job.items, emptyPrenda()] })}>+ Prenda</button>
              <button className="btn add-line" onClick={() => set({ items: [...job.items, emptyDiseno()] })}>+ Diseño / Digitalizado</button>
              {products.some((p) => p.kind === 'servicio') && <button className="btn add-line" onClick={() => {
                const p = products.find((x) => x.kind === 'servicio');
                set({ items: [...job.items, { line_type: 'servicio', product_id: p.id, description: p.name, qty: 1, unit_price: p.price ?? '', unit_cost: p.base_cost ?? '', commissionable: p.commissionable !== 0, decorations: [] }] });
              }}>+ Servicio</button>}
            </div>
          )}

          {!logistica && <EnvioCostosCard job={job} set={set} editable={editable || finanzasRol} />}
          {!logistica && <VendedorCard job={job} set={set} vendedores={vendedores} reglas={reglas} editable={(editable || finanzasRol) && user.role !== 'ventas'} />}

          <section className="card">
            <Field label="Notas (visibles para el cliente y producción)"><textarea rows={3} disabled={logistica} value={job.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </section>
        </div>

        <div className="stack sticky">
          {id && !logistica && <Proofs job={job} setJob={setJob} notify={notify} onDesign={abrirDecorador} />}
          {editable && (
            <div className="row gap ajuste-meta">
              <button className="btn" onClick={ajustarAMeta} title="Sube los precios automáticos lo justo para llegar a la meta, ya contando la comisión del vendedor">🎯 Ajustar a {Math.round(cfg.margen.objetivo * 100)}%</button>
              {job.items.some((it) => Number(it.ajuste_pct) > 0) && <button className="link-btn" onClick={quitarAjuste}>Quitar ajuste</button>}
            </div>
          )}
          {!logistica && <RentabilidadCard fin={fin} preview={dirty} margen={cfg.margen} user={user} jobId={job.id} notify={notify} onUpdated={reload} />}
          {id && isOrder && !logistica && (
            <section className="card">
              <h3>Cobro</h3>
              <div className="row between"><span>Pagado</span><span className="ok">{money(job.finanzas?.cobro?.pagado)}</span></div>
              <div className="row between"><span>Saldo</span><strong className={job.finanzas?.cobro?.saldo > 0 ? 'danger' : 'ok'}>{money(job.finanzas?.cobro?.saldo)}</strong></div>
              <div className="muted small">{job.finanzas?.cobro?.completo ? `Cobrada al 100% el ${fmtDate(job.finanzas.cobro.fechaCobroCompleto)}` : 'Aún no está cobrada al 100%'}</div>
            </section>
          )}
          {id && !logistica && <Payments job={job} setJob={setJob} notify={notify} deposit={meta.settings.deposit_pct} canDelete={finanzasRol} />}
          {id && isOrder && !logistica && <CostosRealesCard job={job} user={user} onUpdated={reload} notify={notify} />}
          {id && isOrder && !logistica && <CreditosCard job={job} user={user} onUpdated={reload} notify={notify} />}
          {id && job.contact && (
            <section className="card">
              <h3>Cliente</h3>
              <Link to={`/contactos/${job.contact.id}`}><strong>{job.contact.name}</strong></Link>
              <div className="muted">{job.contact.company}</div>
              <div>{job.contact.phone}</div>
              <div>{job.contact.email}</div>
            </section>
          )}
        </div>
      </div>
      {redactar && <RedactarIAModal job={job} notify={notify} onClose={() => setRedactar(false)} />}
      {designer && (
        <ProofDesigner job={job} methods={methodsList} business={meta.settings.business_name} brand={meta.brand} sanmarEnabled={!!meta.integrations?.sanmar} initialDesign={designer.initialDesign}
          notify={notify} onClose={() => setDesigner(null)} onSent={(j) => { setJob(j); setDesigner(null); }} />
      )}
      {toast}
    </div>
  );
}

function CopyLink({ url, notify }) {
  return (
    <span className="row gap">
      <button className="btn" onClick={() => { navigator.clipboard?.writeText(url); notify('Enlace del portal copiado'); }}>Copiar enlace del cliente</button>
      <a className="btn ghost" href={url} target="_blank" rel="noreferrer">Ver portal ↗</a>
    </span>
  );
}

function Proofs({ job, setJob, notify, onDesign }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const data = await fileToDataUrl(file);
      setJob(await api.post(`/jobs/${job.id}/proofs`, { file: data, filename: file.name, note }));
      setNote('');
      notify('Prueba guardada. Comparte el enlace del portal con el cliente.');
    } catch (err) { notify(err.message, true); }
    setBusy(false);
    e.target.value = '';
  }
  async function decide(p, status) {
    const comment = status === 'rechazada' ? prompt('¿Qué cambios pidió el cliente?') : '';
    if (comment === null) return;
    setJob(await api.post(`/proofs/${p.id}/decision`, { status, comment }));
  }
  return (
    <section className="card">
      <h3>Pruebas de arte</h3>
      <div className="stack-sm">
        <button className="btn primary designer-btn" onClick={() => onDesign(null)} disabled={!job.items.length}>🎨 Abrir decorador</button>
        <div className="muted small center">o sube un archivo ya terminado:</div>
        <input placeholder="Nota para el cliente (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="btn upload">{busy ? 'Subiendo…' : 'Subir prueba (imagen/PDF)'}<input type="file" accept="image/*,application/pdf" hidden onChange={upload} /></label>
      </div>
      <ul className="proofs">
        {job.proofs.map((p) => (
          <li key={p.id}>
            <a href={p.file_url} target="_blank" rel="noreferrer">
              {/\.pdf$/i.test(p.file_url) ? <div className="pdf-thumb">PDF</div> : <img src={p.file_url} alt={`Prueba v${p.version}`} />}
            </a>
            <div>
              <strong>v{p.version}</strong> <Badge status={p.status} />
              <div className="muted small">{fmtDateTime(p.created_at)}</div>
              {p.note && <div className="small">{p.note}</div>}
              {p.customer_comment && <div className="small quote">“{p.customer_comment}”</div>}
              {!!p.has_design && <button className="link-btn small" onClick={() => onDesign(p)}>✎ Editar como nueva versión</button>}
              {p.status === 'pendiente' && (
                <div className="row gap">
                  <button className="link-btn ok" onClick={() => decide(p, 'aprobada')}>Aprobar</button>
                  <button className="link-btn danger" onClick={() => decide(p, 'rechazada')}>Pedir cambios</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Payments({ job, setJob, notify, deposit, canDelete }) {
  const [f, setF] = useState({ amount: '', method: 'tarjeta', paid_at: today(), reference: '' });
  async function add(e) {
    e.preventDefault();
    try { setJob(await api.post(`/jobs/${job.id}/payments`, f)); setF({ ...f, amount: '', reference: '' }); notify('Pago registrado'); }
    catch (err) { notify(err.message, true); }
  }
  async function remove(p) {
    if (!confirm('¿Eliminar pago?')) return;
    try { await api.del(`/payments/${p.id}`); setJob(await api.get(`/jobs/${job.id}`)); } catch (err) { notify(err.message, true); }
  }
  const suggested = Math.round(job.total * deposit * 100) / 100;
  return (
    <section className="card">
      <h3>Pagos recibidos</h3>
      <p className="muted small">Solo registra pagos recibidos; el sistema no cobra.</p>
      <form className="stack-sm" onSubmit={add}>
        <div className="row gap">
          <input type="number" step="0.01" placeholder="Monto" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {['tarjeta', 'efectivo', 'transferencia', 'zelle', 'cheque', 'otro'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="row gap">
          <input type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} />
          <input placeholder="Referencia" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </div>
        <div className="row gap">
          {job.paid === 0 && job.total > 0 && <button type="button" className="link-btn" onClick={() => setF({ ...f, amount: suggested })}>Anticipo {Math.round(deposit * 100)}% ({money(suggested)})</button>}
          {job.balance > 0 && <button type="button" className="link-btn" onClick={() => setF({ ...f, amount: job.balance })}>Saldo completo</button>}
          <button className="btn">Registrar</button>
        </div>
      </form>
      <ul className="list">
        {job.payments.map((p) => (
          <li key={p.id}><span>{fmtDate(p.paid_at)}</span><span>{p.method}{p.reference ? ` · ${p.reference}` : ''}</span><strong>{money(p.amount)}</strong>{canDelete && <button className="icon-btn" onClick={() => remove(p)}>×</button>}</li>
        ))}
      </ul>
    </section>
  );
}
