import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { PageHeader, useMeta, useToast } from '../components/ui.jsx';
import { Markdown } from '../components/IA.jsx';

const SUGERENCIAS = [
  '¿Qué órdenes están por debajo del 30% de contribución y por qué?',
  '¿Qué clientes me dejan más ganancia este año?',
  '¿Cuánto tengo por cobrar y quién me debe más?',
  '¿Qué órdenes están atrasadas o vencen esta semana?',
  '¿Cuánto le toca a cada vendedor en la liquidación de este mes?',
  '¿Qué órdenes tienen costos incompletos?',
];

/** Asistente de solo lectura: responde con los datos del negocio. */
export default function Asistente() {
  const meta = useMeta();
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, notify] = useToast();
  const fin = useRef(null);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, busy]);

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
        <PageHeader title="Asistente del negocio" />
        <div className="card narrow"><p>La IA no está configurada en el servidor. Falta la variable <code>ANTHROPIC_API_KEY</code> (ver README → Inteligencia artificial).</p></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="✨ Asistente del negocio" subtitle="Pregunta sobre ventas, márgenes, cobros y comisiones. Solo lee los datos: no cambia nada." >
        {chat.length > 0 && <button className="btn" onClick={() => setChat([])}>Nueva conversación</button>}
      </PageHeader>
      <div className="assistant">
        {chat.length === 0 && (
          <div className="suggestions">
            {SUGERENCIAS.map((s) => <button key={s} className="chip" onClick={() => preguntar(s)}>{s}</button>)}
          </div>
        )}
        <div className="chat">
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            </div>
          ))}
          {busy && <div className="msg assistant typing">Revisando los datos…</div>}
          <div ref={fin} />
        </div>
        <form className="ask" onSubmit={(e) => { e.preventDefault(); preguntar(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe tu pregunta…" disabled={busy} autoFocus />
          <button className="btn primary" disabled={busy || !q.trim()}>Preguntar</button>
        </form>
        <p className="muted small">Las respuestas usan los datos de ColorPlus OS al momento de preguntar (últimos ~13 meses). La IA puede equivocarse: verifica las cifras importantes en Reportes.</p>
      </div>
      {toast}
    </>
  );
}
