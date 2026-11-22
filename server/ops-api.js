// Operación: chequeo de salud (público, para Render) y respaldos (solo el dueño).
import express from 'express';
import { get } from './db.js';
import { requireRole } from './auth.js';
import { listarRespaldos, crearRespaldo, rutaRespaldo } from './backup.js';

export const healthRouter = express.Router();
healthRouter.get('/salud', (req, res) => {
  try {
    get('SELECT 1 AS ok');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

const r = express.Router();
const wrap = (fn) => (req, res) => {
  try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
r.get('/respaldos', wrap((req) => { requireRole(req, 'duena'); return listarRespaldos(); }));
r.post('/respaldos', wrap((req) => { requireRole(req, 'duena'); return crearRespaldo({ manual: true }); }));
r.get('/respaldos/:nombre', wrap((req, res) => {
  requireRole(req, 'duena');
  const f = rutaRespaldo(req.params.nombre);
  if (!f) throw Object.assign(new Error('Respaldo no encontrado'), { status: 404 });
  res.download(f);
  return undefined;
}));
export default r;
