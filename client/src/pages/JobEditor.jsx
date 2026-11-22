import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, fileToDataUrl } from '../api.js';
import { money, fmtDate, fmtDateTime, label, today, useLoad } from '../utils.js';
import { Badge, Field, PageHeader, useMeta, useToast } from '../components/ui.jsx';
import { priceItem, jobTotals } from '../../../shared/pricing.js';
import ProofDesigner from '../components/designer/ProofDesigner.jsx';

const LOCATIONS = ['Frente', 'Espalda', 'Pecho izquierdo', 'Pecho derecho', 'Manga izquierda', 'Manga derecha', 'Nuca', 'Frente gorra', 'Lateral gorra'];
const emptyItem = () => ({ product_id: '', description: '', color: '', sizes: {}, qty: 0, decorations: [{ method: 'serigrafia', location: 'Frente', colors: 1 }], custom_price: '' });

export default function JobEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const meta = useMeta();
  const [products] = useLoad(() => api.get('/products'));
  const [methodsList] = useLoad(() => api.get('/methods'));
  const [contacts] = useLoad(() => api.get('/contacts'));
  const [opps] = useLoad(() => api.get('/opportunities'));
  const [job, setJob] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, notify] = useToast();
  const [designer, setDesigner] = useState(null);

  useEffect(() => {
    if (id) api.get(`/jobs/${id}`).then((j) => { setJob(j); setDirty(false); });
    else setJob({
      kind: 'quote', status: 'borrador', title: '', notes: '', discount: 0, tax_rate: meta.settings.tax_rate,
      contact_id: params.get('contact') ? Number(params.get('contact')) : '', opportunity_id: params.get('opp') ? Number(params.get('opp')) : '',
      items: [emptyItem()], proofs: [], payments: [],
    });
  }, [id]);

  const methods = useMemo(() => Object.fromEntries((methodsList || []).map((m) => [m.code, m])), [methodsList]);
  const productById = useMemo(() => Object.fromEntries((products || []).map((p) => [p.id, p])), [products]);

  if (!job || !products || !methodsList) return <div className="loading">Cargando…</div>;

  const priced = job.items.map((it) => priceItem(it, productById[it.product_id], methods, meta.settings.markup));
  const totals = jobTotals(priced, job.discount, job.tax_rate);
  const isOrder = job.kind === 'order';
  const editable = !id || job.kind === 'quote' || ['arte', 'aprobacion'].includes(job.status);
  const portalUrl = job.token ? `${location.origin}/portal/${job.token}` : null;

  const set = (patch) => { setJob({ ...job, ...patch }); setDirty(true); };
  const setItem = (idx, patch) => set({ items: job.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });

  async function save() {
    const body = {
      title: job.title || 'Cotización', contact_id: job.contact_id || null, opportunity_id: job.opportunity_id || null,
      due_date: job.due_date || null, priority: job.priority, assignee: job.assignee, notes: job.notes,
      discount: Number(job.discount) || 0, tax_rate: Number(job.tax_rate) || 0,
      items: job.items.filter((it) => it.product_id || it.description),
    };
    try {
      const saved = id ? await api.put(`/jobs/${id}`, body) : await api.post('/jobs', body);
      setJob(saved); setDirty(false); notify('Guardado');
      if (!id) nav(`/trabajos/${saved.id}`, { replace: true });
      return saved;
    } catch (e) { notify(e.message, true); }
  }
  async function act(path, body, msg) {
    try {
      if (dirty) await save();
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

  const contactOpps = (opps || []).filter((o) => o.contact_id === Number(job.contact_id));
  const docNumber = isOrder ? job.order_number : job.number;

  return (
    <div className="job-editor">
      <PageHeader title={id ? `${docNumber} · ${job.title}` : 'Nueva cotización'} subtitle={id && <>{isOrder ? `De la cotización ${job.number}` : 'Cotización'} · <Badge status={job.status} /></>}>
        {id && <button className="btn" onClick={() => window.print()}>Imprimir</button>}
        {id && <button className="btn" onClick={duplicate}>Duplicar</button>}
        {id && <button className="btn danger-ghost" onClick={remove}>Eliminar</button>}
        <button className="btn primary" onClick={save} disabled={!dirty && !!id}>{dirty || !id ? 'Guardar' : 'Guardado ✓'}</button>
      </PageHeader>

      {id && !isOrder && (
        <div className="action-bar">
          <span>Siguiente paso:</span>
          {job.status === 'borrador' && <button className="btn primary" onClick={() => act('send', {}, 'Cotización enviada al cliente')}>Enviar al cliente</button>}
          {['borrador', 'enviada'].includes(job.status) && <button className="btn" onClick={() => act('approve', { approved: true }, 'Cotización aprobada')}>Marcar aprobada</button>}
          {['borrador', 'enviada'].includes(job.status) && <button className="btn" onClick={() => act('approve', { approved: false }, 'Cotización rechazada')}>Marcar rechazada</button>}
          {job.status !== 'rechazada' && <button className="btn" onClick={() => act('convert', {}, 'Convertida en orden')}>Convertir en orden</button>}
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
                <select value={job.contact_id || ''} onChange={(e) => set({ contact_id: e.target.value ? Number(e.target.value) : '', opportunity_id: '' })}>
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
              <Field label="Responsable"><input value={job.assignee || ''} onChange={(e) => set({ assignee: e.target.value })} placeholder="Quién lo lleva" /></Field>
            </div>
          </section>

          {job.items.map((it, idx) => (
            <ItemEditor key={idx} idx={idx} item={it} priced={priced[idx]} products={products} methods={methodsList} productById={productById}
              editable={editable} onChange={(p) => setItem(idx, p)}
              onRemove={() => set({ items: job.items.filter((_, i) => i !== idx) })}
              onDuplicate={() => set({ items: [...job.items.slice(0, idx + 1), structuredClone(it), ...job.items.slice(idx + 1)] })} />
          ))}
          {editable && <button className="btn add-line" onClick={() => set({ items: [...job.items, emptyItem()] })}>+ Agregar producto</button>}

          <section className="card">
            <Field label="Notas (visibles para el cliente y producción)"><textarea rows={3} value={job.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </section>
        </div>

        <div className="stack sticky">
          <section className="card totals">
            <h3>Resumen</h3>
            <div className="row between"><span>Piezas</span><span>{priced.reduce((a, p) => a + p.qty, 0)}</span></div>
            <div className="row between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
            <div className="row between"><span>Descuento</span><input className="mini" type="number" value={job.discount} onChange={(e) => set({ discount: e.target.value })} /></div>
            <div className="row between"><span>Impuesto (%)</span><input className="mini" type="number" step="0.01" value={Math.round((job.tax_rate || 0) * 10000) / 100} onChange={(e) => set({ tax_rate: Number(e.target.value) / 100 })} /></div>
            <div className="row between"><span>Impuesto</span><span>{money(totals.tax)}</span></div>
            <div className="row between total"><span>Total</span><span>{money(totals.total)}</span></div>
            {id && <>
              <div className="row between"><span>Pagado</span><span className="ok">{money(job.paid)}</span></div>
              <div className="row between total"><span>Saldo</span><span className={job.balance > 0 ? 'danger' : 'ok'}>{money(totals.total - (job.paid || 0))}</span></div>
            </>}
          </section>

          {id && <Proofs job={job} setJob={setJob} notify={notify} onDesign={async (proof) => {
            if (dirty) await save();
            try {
              const initialDesign = proof ? await api.get(`/proofs/${proof.id}/design`) : null;
              setDesigner({ initialDesign });
            } catch (e) { notify(e.message, true); }
          }} />}
          {id && <Payments job={job} setJob={setJob} notify={notify} deposit={meta.settings.deposit_pct} />}
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
      {designer && (
        <ProofDesigner job={job} methods={methodsList} business={meta.settings.business_name} sanmarEnabled={!!meta.integrations?.sanmar} initialDesign={designer.initialDesign}
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

function ItemEditor({ idx, item, priced, products, methods, productById, editable, onChange, onRemove, onDuplicate }) {
  const product = productById[item.product_id];
  const sizes = product?.sizes?.length ? product.sizes : null;
  const setDeco = (i, patch) => onChange({ decorations: item.decorations.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <section className="card item">
      <div className="item-head">
        <span className="item-n">{idx + 1}</span>
        <select disabled={!editable} value={item.product_id || ''} onChange={(e) => {
          const p = productById[e.target.value];
          onChange({ product_id: e.target.value ? Number(e.target.value) : '', description: p?.name || item.description, color: p?.colors?.[0] || '', sizes: {} });
        }}>
          <option value="">— Producto del catálogo —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.brand} {p.sku} · {p.name}</option>)}
        </select>
        {product?.colors?.length > 0 && (
          <select disabled={!editable} value={item.color} onChange={(e) => onChange({ color: e.target.value })}>
            {product.colors.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <div className="item-actions">
          {editable && <button className="icon-btn" title="Duplicar" onClick={onDuplicate}>⧉</button>}
          {editable && <button className="icon-btn" title="Quitar" onClick={onRemove}>🗑</button>}
        </div>
      </div>
      <input className="desc" disabled={!editable} value={item.description} placeholder="Descripción (o producto libre)" onChange={(e) => onChange({ description: e.target.value })} />

      <div className="sizes">
        {(sizes || ['Cant.']).map((s) => (
          <label key={s} className="size">
            <span>{s}</span>
            <input type="number" min="0" disabled={!editable}
              value={sizes ? item.sizes?.[s] || '' : item.qty || ''}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                if (sizes) { const n = { ...item.sizes, [s]: v }; if (!v) delete n[s]; onChange({ sizes: n }); }
                else onChange({ qty: v, sizes: {} });
              }} />
          </label>
        ))}
        <div className="size total-pcs"><span>Total</span><strong>{priced.qty}</strong></div>
      </div>

      <div className="decos">
        <div className="muted small">Decoraciones</div>
        {item.decorations.map((d, i) => (
          <div key={i} className="deco-row">
            <select disabled={!editable} value={d.method} onChange={(e) => setDeco(i, { method: e.target.value })}>
              {methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
            <input disabled={!editable} list="locations" value={d.location} onChange={(e) => setDeco(i, { location: e.target.value })} placeholder="Ubicación" />
            <label className="inline">Colores <input type="number" min="1" className="mini" disabled={!editable} value={d.colors} onChange={(e) => setDeco(i, { colors: Number(e.target.value) })} /></label>
            <span className="muted small">{priced.breakdown[i] ? `${money(priced.breakdown[i].per_unit)}/pz${priced.breakdown[i].setup ? ` + setup ${money(priced.breakdown[i].setup)}` : ''}` : ''}</span>
            {editable && <button className="icon-btn" onClick={() => onChange({ decorations: item.decorations.filter((_, j) => j !== i) })}>×</button>}
          </div>
        ))}
        <datalist id="locations">{LOCATIONS.map((l) => <option key={l} value={l} />)}</datalist>
        {editable && <button className="link-btn" onClick={() => onChange({ decorations: [...item.decorations, { method: methods[0]?.code, location: 'Espalda', colors: 1 }] })}>+ decoración</button>}
      </div>

      <div className="item-foot">
        <span className="muted small">
          Blank {money(priced.blank)} · Deco {money(priced.deco_unit)}/pz{priced.upcharge ? ` · Tallas extra ${money(priced.upcharge)}` : ''}{priced.setup ? ` · Setup ${money(priced.setup)}` : ''}
        </span>
        <label className="inline small">Precio manual/pz <input className="mini" type="number" step="0.01" disabled={!editable} value={item.custom_price ?? ''} onChange={(e) => onChange({ custom_price: e.target.value })} placeholder="auto" /></label>
        <span className="item-total">{priced.qty ? `${money(priced.unit_price)}/pz · ` : ''}<strong>{money(priced.total)}</strong></span>
      </div>
    </section>
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
      notify('Prueba subida y enviada al cliente');
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

function Payments({ job, setJob, notify, deposit }) {
  const [f, setF] = useState({ amount: '', method: 'tarjeta', paid_at: today(), reference: '' });
  async function add(e) {
    e.preventDefault();
    try { setJob(await api.post(`/jobs/${job.id}/payments`, f)); setF({ ...f, amount: '', reference: '' }); notify('Pago registrado'); }
    catch (err) { notify(err.message, true); }
  }
  async function remove(p) {
    if (!confirm('¿Eliminar pago?')) return;
    await api.del(`/payments/${p.id}`);
    setJob(await api.get(`/jobs/${job.id}`));
  }
  const suggested = Math.round(job.total * deposit * 100) / 100;
  return (
    <section className="card">
      <h3>Pagos</h3>
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
          <li key={p.id}><span>{fmtDate(p.paid_at)}</span><span>{p.method}{p.reference ? ` · ${p.reference}` : ''}</span><strong>{money(p.amount)}</strong><button className="icon-btn" onClick={() => remove(p)}>×</button></li>
        ))}
      </ul>
    </section>
  );
}
