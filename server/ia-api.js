// Rutas de IA. Todo es solo lectura o borrador: la IA no guarda, no envía y no cobra nada.
import express from 'express';
import { get, insert } from './db.js';
import { requireRole } from './auth.js';
import { iaConfigurada, IA_MODEL, cotizarDesdeMensaje, preguntarAlNegocio, redactarMensaje, TIPOS_MENSAJE, usoDelMes, responderEmail, ideasDeVenta, ENFOQUES_IDEAS } from './ia.js';

const r = express.Router();
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) {
    if (!e.status || e.status >= 500) console.error(`[IA] ${e.message}`); // nunca se registra el contenido
    res.status(e.status || 500).json({ error: e.message });
  }
};
const fail = (status, msg) => Object.assign(new Error(msg), { status });

r.get('/ia/estado', wrap((req) => ({
  configurada: iaConfigurada(), modelo: IA_MODEL, tiposMensaje: TIPOS_MENSAJE,
  ...(req.user.role === 'duena' ? { usoDelMes: usoDelMes() } : {}),
})));

r.post('/ia/cotizar', wrap((req) => cotizarDesdeMensaje(req.body.texto, req.user)));

r.post('/ia/preguntar', wrap((req) => {
  return preguntarAlNegocio(req.body.pregunta, req.body.historial, req.user);
}));

r.post('/ia/responder-email', wrap((req) => responderEmail(req.body || {}, req.user)));
r.post('/ia/ideas-venta', wrap((req) => ideasDeVenta(req.body || {}, req.user)));
r.get('/ia/enfoques-ideas', wrap(() => ENFOQUES_IDEAS));

r.post('/ia/redactar', wrap((req) => redactarMensaje({
  jobId: req.body.jobId, tipo: req.body.tipo, idioma: req.body.idioma, instrucciones: req.body.instrucciones,
  baseUrl: `${req.protocol}://${req.get('host')}`,
}, req.user)));

// Guarda un borrador como nota interna en la conversación del cliente (no se envía).
r.post('/ia/guardar-nota', wrap((req) => {
  const job = get('SELECT id, contact_id FROM jobs WHERE id = ?', req.body.jobId);
  if (!job?.contact_id) throw fail(400, 'La orden no tiene cliente asignado.');
  const texto = `Borrador (IA, no enviado)${req.body.asunto ? ` · ${String(req.body.asunto).slice(0, 200)}` : ''}\n\n${String(req.body.mensaje || '').slice(0, 8000)}`;
  const id = insert('activities', { contact_id: job.contact_id, job_id: job.id, type: 'nota', direction: 'interno', body: texto, status: `por ${req.user.name}` });
  return { ok: true, id };
}));

export default r;
