import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { PageHeader, useMeta, useToast } from '../components/ui.jsx';
import { Markdown } from '../components/IA.jsx';
import DonPixel, { saludoDonPixel, FRASES_PENSANDO } from '../components/DonPixel.jsx';

const OFICIO = ['¿Qué diferencia hay entre DTF y serigrafía?', '¿Cuándo conviene bordado y cuándo DTF?', '¿Qué archivo necesito para bordar un logo?'];

const SUGERENCIAS = [
  '¿Qué órdenes están por debajo del 30% de contribución y por qué?',
  '¿Qué clientes me dejan más ganancia este año?',
  '¿Cuánto tengo por cobrar y quién me debe más?',
  '¿Qué órdenes están atrasadas o vencen esta semana?',
  '¿Cuánto le toca a cada vendedor en la liquidación de este mes?',
  '¿Qué órdenes tienen costos incompletos?',
];

/** Asistente de solo lectura: responde con los datos del negocio. */
const SUGERENCIAS_ROL = {
  ventas: ['¿Cuánto llevo vendido este mes?', '¿Cuál es mi comisión de este mes?', '¿Cuáles de mis clientes tienen saldo pendiente?', '¿Qué cotizaciones mías siguen abiertas?'],
  logistica: ['¿Qué órdenes se entregan esta semana?', '¿Qué órdenes están atrasadas?', '¿Cuántas piezas hay en producción?', '¿Qué tareas tengo pendientes?'],
  coordinacion: ['¿Cuánto ha vendido cada vendedor este mes?', '¿Qué órdenes están atrasadas o vencen esta semana?', '¿Qué cotizaciones siguen abiertas y de quién son?', '¿Qué clientes tienen saldo pendiente?'],
};

export default function Asistente() {
  const meta = useMeta();
  const sugerencias = [...(SUGERENCIAS_ROL[meta.user.role] || SUGERENCIAS).slice(0, 4), ...OFICIO];
  const [frase, setFrase] = useState(0);
  const [modo, setModo] = useState('preguntar');
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, notify] = useToast();
  const fin = useRef(null);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, busy]);
  useEffect(() => {
    if (!busy) return undefined;
    setFrase(Math.floor(Math.random() * FRASES_PENSANDO.length));
    const t = setInterval(() => setFrase((f) => f + 1), 2500);
    return () => clearInterval(t);
  }, [busy]);

  async function preguntar(texto) {
    const pregunta = (texto ?? q).trim();
    if (!pregunta || busy) return;
    const historial = chat.map((m) => ({ role: m.role, content: m.content }));
    setChat((c) => [...c, { role: 'user', content: pregunta }]);
    setQ('');
    setBusy(true);
    try {
      const r = await api.post('/ia/preguntar', { pregunta, historial });
      setChat((c) => [...c, { role: 'assistant', content: r.respuesta }]);
    } catch (e) {
      notify(e.message, true);
      setChat((c) => c.slice(0, -1));
      setQ(pregunta);
    }
    setBusy(false);
  }

  if (!meta.integrations?.ia) {
    return (
      <>
        <PageHeader title="Don Pixel" />
        <div className="card narrow"><p>Don Pixel todavía no está conectado: falta la clave de la IA (<code>ANTHROPIC_API_KEY</code>) en Render → Environment. Cuando la pongas, Render reinicia la app y Don Pixel queda listo.</p></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={<span className="pixel-titulo"><DonPixel size={40} /> Don Pixel</span>} subtitle="El maestro del oficio de Color Plus: pregúntale por el negocio o por el oficio (DTF, bordado, serigrafía, telas, archivos), y pídele ayuda con emails e ideas de venta. Solo lee los datos; no envía ni cambia nada." >
        {modo === 'preguntar' && chat.length > 0 && <button className="btn" onClick={() => setChat([])}>Nueva conversación</button>}
      </PageHeader>
      <div className="tabs pixel-tabs">
        <button className={modo === 'preguntar' ? 'active' : ''} onClick={() => setModo('preguntar')}>💬 Preguntar</button>
        <button className={modo === 'email' ? 'active' : ''} onClick={() => setModo('email')}>✉️ Responder un email</button>
        <button className={modo === 'ideas' ? 'active' : ''} onClick={() => setModo('ideas')}>💡 Ideas de venta</button>
      </div>
      {modo === 'email' && <ResponderEmail notify={notify} />}
      {modo === 'ideas' && <IdeasVenta notify={notify} />}
      <div className="assistant" style={{ display: modo === 'preguntar' ? undefined : 'none' }}>
        {chat.length === 0 && (
          <div className="suggestions">
            <p className="don-pixel-saludo">{saludoDonPixel(String(meta.user.name || '').split(' ')[0])} Soy <strong>Don Pixel</strong>, años entre planchas, pantallas y máquinas de bordar. Pregúntame por tus órdenes y clientes, o cualquier duda del oficio.</p>
            {sugerencias.map((s) => <button key={s} className="chip" onClick={() => preguntar(s)}>{s}</button>)}
          </div>
        )}
        <div className="chat">
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === 'assistant' && <DonPixel size={26} className="msg-avatar" />}
              {m.role === 'assistant' ? <div className="msg-cuerpo"><Markdown text={m.content} /></div> : m.content}
            </div>
          ))}
          {busy && <div className="msg assistant typing"><DonPixel size={26} className="msg-avatar" />{FRASES_PENSANDO[frase % FRASES_PENSANDO.length]}</div>}
          <div ref={fin} />
        </div>
        <form className="ask" onSubmit={(e) => { e.preventDefault(); preguntar(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pregúntale a Don Pixel…" disabled={busy} autoFocus />
          <button className="btn primary" disabled={busy || !q.trim()}>Preguntar</button>
        </form>
        <p className="muted small">Las respuestas usan los datos de ColorPlus OS al momento de preguntar (últimos ~13 meses). Don Pixel puede equivocarse: verifica las cifras importantes en Reportes.</p>
      </div>
      {toast}
    </>
  );
}

/** Pegas el correo del cliente y Don Pixel escribe un borrador de respuesta (no se envía). */
function ResponderEmail({ notify }) {
  const [contactos] = useLoadSafe(() => api.get('/contacts'));
  const [f, setF] = useState({ email: '', contact_id: '', idioma: 'auto', instrucciones: '' });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  async function escribir(e) {
    e.preventDefault();
    setBusy(true);
    try { setRes(await api.post('/ia/responder-email', { ...f, contact_id: f.contact_id ? Number(f.contact_id) : null })); } catch (err) { notify(err.message, true); }
    setBusy(false);
  }
  const copiar = async () => { try { await navigator.clipboard.writeText(`${res.asunto}\n\n${res.respuesta}`); notify('Copiado. Pégalo en tu correo y envíalo tú.'); } catch { notify('No se pudo copiar; selecciónalo a mano.', true); } };
  async function guardarNota() {
    try { await api.post(`/contacts/${f.contact_id}/activities`, { type: 'nota', direction: 'interno', body: `Borrador de respuesta (Don Pixel, no enviado) · ${res.asunto}\n\n${res.respuesta}` }); notify('Guardado como nota en el cliente.'); } catch (err) { notify(err.message, true); }
  }
  return (
    <div className="pixel-grid">
      <form className="card form" onSubmit={escribir}>
        <h3>Correo del cliente</h3>
        <label className="field"><span>Cliente (opcional, para que Don Pixel vea sus órdenes)</span>
          <select value={f.contact_id} onChange={(e) => setF({ ...f, contact_id: e.target.value })}>
            <option value="">— Sin elegir —</option>
            {(contactos || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
          </select>
        </label>
        <label className="field"><span>Pega aquí el email que te mandaron</span>
          <textarea required rows={9} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Hola, quisiera cotizar 50 camisetas negras con nuestro logo para un evento el 15 de diciembre…" />
        </label>
        <div className="row gap wrap">
          <label className="field"><span>Responder en</span>
            <select value={f.idioma} onChange={(e) => setF({ ...f, idioma: e.target.value })}><option value="auto">El idioma del cliente</option><option value="es">Español</option><option value="en">Inglés</option></select>
          </label>
          <label className="field grow"><span>Indicaciones para Don Pixel (opcional)</span>
            <input value={f.instrucciones} onChange={(e) => setF({ ...f, instrucciones: e.target.value })} placeholder="Ej.: dile que le mandamos la cotización mañana" />
          </label>
        </div>
        <button className="btn btn-morado" disabled={busy || f.email.trim().length < 10}>{busy ? 'Don Pixel está escribiendo…' : '✉️ Escribir respuesta'}</button>
        <p className="muted small">Es un borrador: Don Pixel no envía nada. No inventa precios ni fechas; si faltan datos, te los marca para confirmar.</p>
      </form>
      <div className="card">
        <h3>Borrador de respuesta</h3>
        {!res && <p className="muted">Aquí aparecerá la respuesta para que la revises, la ajustes y la copies.</p>}
        {res && (
          <div className="form">
            <label className="field"><span>Asunto</span><input value={res.asunto} onChange={(e) => setRes({ ...res, asunto: e.target.value })} /></label>
            <label className="field"><span>Respuesta</span><textarea rows={12} value={res.respuesta} onChange={(e) => setRes({ ...res, respuesta: e.target.value })} /></label>
            {res.puntosAConfirmar?.length > 0 && (
              <div className="notice"><strong>Confirma antes de enviar:</strong><ul>{res.puntosAConfirmar.map((x) => <li key={x}>{x}</li>)}</ul></div>
            )}
            <div className="row gap wrap">
              <button type="button" className="btn primary" onClick={copiar}>Copiar</button>
              {f.contact_id && <button type="button" className="btn" onClick={guardarNota}>Guardar como nota del cliente</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Ideas de venta basadas en los clientes y trabajos que la persona puede ver. */
function IdeasVenta({ notify }) {
  const [enfoques] = useLoadSafe(() => api.get('/ia/enfoques-ideas'));
  const [enfoque, setEnfoque] = useState('general');
  const [extra, setExtra] = useState('');
  const [ideas, setIdeas] = useState('');
  const [busy, setBusy] = useState(false);
  async function pedir(e) {
    e.preventDefault();
    setBusy(true);
    try { setIdeas((await api.post('/ia/ideas-venta', { enfoque, extra })).ideas); } catch (err) { notify(err.message, true); }
    setBusy(false);
  }
  return (
    <div className="pixel-grid">
      <form className="card form" onSubmit={pedir}>
        <h3>¿Qué tipo de ideas quieres?</h3>
        <div className="enfoques">
          {Object.entries(enfoques || {}).map(([k, v]) => (
            <label key={k} className={`enfoque ${enfoque === k ? 'on' : ''}`}><input type="radio" name="enfoque" checked={enfoque === k} onChange={() => setEnfoque(k)} />{v}</label>
          ))}
        </div>
        <label className="field"><span>Algo más que deba saber Don Pixel (opcional)</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ej.: quiero enfocarme en iglesias y gimnasios" />
        </label>
        <button className="btn btn-morado" disabled={busy}>{busy ? 'Don Pixel está pensando…' : '💡 Darme ideas'}</button>
        <p className="muted small">Usa solo tus clientes y trabajos (los que puedes ver en la app). No promete precios ni descuentos.</p>
      </form>
      <div className="card">
        <h3>Ideas de Don Pixel</h3>
        {!ideas ? <p className="muted">Elige un enfoque y pulsa «Darme ideas».</p> : <Markdown text={ideas} />}
      </div>
    </div>
  );
}

function useLoadSafe(fn) {
  const [data, setData] = useState(null);
  useEffect(() => { fn().then(setData).catch(() => setData(null)); }, []);
  return [data];
}
