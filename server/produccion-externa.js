// Producción externa: la producción se terceriza. Cuando el cliente aprueba, se prepara una orden de compra (PO)
// para el taller con las instrucciones, las cantidades y las pruebas de arte aprobadas.
// La app PREPARA el PO; una persona lo manda (enlace o PDF). No envía correos ni crea pedidos en SanMar.
import express from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import PDFDocument from 'pdfkit';
import { all, get, run, insert, getSetting, transaction } from './db.js';
import { audit } from './config.js';
import { computeJob } from './finance.js';
import { requireRole } from './auth.js';
import { esLogistica, soloPropios, jobPermitido } from './scope.js';
import { PROCESOS } from '../shared/pricing.js';
import { fechaUS } from '../shared/idiomas.js';
import { loadJob, logSystem, setOrderStatus, nextNumber, UPLOAD_DIR } from './api.js';
import { getBrand, logoFilePath } from './brand.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const wrap = (fn) => (req, res) => { try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const txt = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const ahora = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Quién manda a producción: Coordinación de ventas (Ana Isabel), Gerencia y el dueño. */
export const MANDAN = ['duena', 'gerencia', 'coordinacion'];
export const ESTADOS_PO = { borrador: 'Borrador', enviado: 'Enviado al taller', recibido: 'Recibido por el taller', terminado: 'Terminado', cancelado: 'Cancelado' };

run(`CREATE TABLE IF NOT EXISTS talleres (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contacto TEXT, email TEXT, phone TEXT,
  address TEXT, notas TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
)`);
run(`CREATE TABLE IF NOT EXISTS production_pos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  taller_id INTEGER NOT NULL REFERENCES talleres(id), numero TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'borrador', instrucciones TEXT, fecha_entrega TEXT,
  lineas TEXT NOT NULL DEFAULT '[]', pruebas TEXT NOT NULL DEFAULT '[]', total REAL,
  created_by TEXT, created_at TEXT DEFAULT (datetime('now')), sent_at TEXT, sent_by TEXT, received_at TEXT, done_at TEXT,
  nota_taller TEXT, cancel_reason TEXT
)`);
run('CREATE INDEX IF NOT EXISTS idx_po_job ON production_pos(job_id)');

// ---------- talleres ----------
const TALLER_CAMPOS = ['name', 'contacto', 'email', 'phone', 'address', 'notas'];
const tallerDe = (b, prev = {}) => Object.fromEntries(TALLER_CAMPOS.map((k) => [k, k in b ? txt(b[k], 500) : prev[k] ?? null]));

// ---------- requisitos y contenido del PO ----------
/** La orden solo va a producción cuando el cliente aprobó: es una orden (cotización aprobada) y su última prueba de arte está aprobada. */
export function requisitos(job) {
  const ultima = job.proofs?.[0] || null; // loadJob las trae de la versión más nueva a la más vieja
  const lista = [
    { clave: 'orden', ok: job.kind === 'order', texto: 'La cotización está aprobada y convertida en orden' },
    { clave: 'arte', ok: ultima?.status === 'aprobada', texto: ultima ? (ultima.status === 'aprobada' ? `El cliente aprobó la prueba de arte v${ultima.version}` : `El cliente todavía no aprueba la prueba de arte v${ultima.version}`) : 'Falta enviar la prueba de arte y que el cliente la apruebe' },
  ];
  return { ok: lista.every((r) => r.ok), lista };
}

/**
 * Líneas del PO a partir de la orden. Las prendas las compra Color Plus y SanMar las manda directo al taller,
 * así que el PO no cobra prendas: cobra la decoración (costo de la matriz, por pieza) y los servicios con costo (digitalizado).
 * Un costo desconocido queda en null («por definir»): nunca se toma como $0.
 */
export function lineasDeOrden(job) {
  const { lineas: calcs } = computeJob(job, { persist: false });
  const out = [];
  job.items.forEach((it, i) => {
    const tipo = it.line_type || 'prenda';
    const c = calcs[i];
    if (tipo === 'prenda') {
      const qty = c?.qty || it.qty || 0;
      out.push({
        tipo: 'prenda', descripcion: it.description, codigo: it.product_sku || null, marca: it.product_brand || null, color: it.color || '',
        tallas: Object.fromEntries(Object.entries(it.sizes || {}).filter(([, n]) => Number(n) > 0)), cantidad: qty,
        decoraciones: (it.decorations || []).map((d, k) => {
          const costo = num(c?.decoraciones?.[k]?.costoPieza);
          return {
            proceso: d.process, nombre: PROCESOS[d.process] || d.process, ubicacion: d.location || '', ancho: num(d.width), alto: num(d.height),
            puntadas: num(d.stitches), hojas: num(d.sheets), colores: txt(d.inks, 200) || null,
            costoUnitario: costo, total: costo == null ? null : r2(costo * qty),
          };
        }),
      });
    } else {
      const costo = num(it.unit_cost);
      const qty = Number(it.qty) || 1;
      out.push({ tipo: 'servicio', descripcion: it.description, cantidad: qty, costoUnitario: costo, total: costo == null ? null : r2(costo * qty) });
    }
  });
  return out;
}

const totalDe = (lineas) => {
  const montos = lineas.flatMap((l) => (l.tipo === 'prenda' ? l.decoraciones.map((d) => d.total) : [l.total]));
  return montos.some((m) => m == null) ? null : r2(montos.reduce((a, m) => a + m, 0));
};
const faltanCostos = (lineas) => lineas.flatMap((l) => (l.tipo === 'prenda'
  ? l.decoraciones.filter((d) => d.costoUnitario == null).map((d) => `${l.descripcion}: ${d.nombre} ${d.ubicacion}`)
  : l.costoUnitario == null ? [l.descripcion] : []));

const leer = (po) => po && ({ ...po, lineas: JSON.parse(po.lineas || '[]'), pruebas: JSON.parse(po.pruebas || '[]') });
const poDeJob = (jobId) => leer(get("SELECT * FROM production_pos WHERE job_id = ? AND status != 'cancelado' ORDER BY id DESC LIMIT 1", jobId));
const poPorId = (id) => leer(get('SELECT * FROM production_pos WHERE id = ?', id));

/** Lo que hay que pedir en SanMar, con envío directo al taller (la app no hace el pedido: es una lista para quien compra). */
function listaCompra(lineas) {
  return lineas.filter((l) => l.tipo === 'prenda').flatMap((l) => Object.entries(l.tallas).map(([talla, n]) => ({ codigo: l.codigo, descripcion: l.descripcion, color: l.color, talla, cantidad: Number(n) })));
}

/** Vista interna del PO. Logística y Ventas ven el estado y las instrucciones, pero no lo que se le paga al taller. */
function vista(po, user) {
  if (!po) return null;
  const taller = get('SELECT * FROM talleres WHERE id = ?', po.taller_id);
  const sinMontos = esLogistica(user) || soloPropios(user);
  const lineas = sinMontos ? po.lineas.map((l) => (l.tipo === 'prenda' ? { ...l, decoraciones: l.decoraciones.map(({ costoUnitario: _c, total: _t, ...d }) => d) } : (({ costoUnitario: _c, total: _t, ...x }) => x)(l))) : po.lineas;
  return {
    ...po, lineas, total: sinMontos ? undefined : po.total, taller, estado: ESTADOS_PO[po.status], faltanCostos: sinMontos ? [] : faltanCostos(po.lineas),
    listaCompra: listaCompra(po.lineas),
  };
}

function cambiarEstado(po, status, extra = {}) {
  const sets = Object.entries({ status, ...extra });
  run(`UPDATE production_pos SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), po.id);
}

// ---------- rutas internas ----------
export const produccionExternaApi = express.Router();
const r = produccionExternaApi;

r.get('/talleres', wrap((req) => { requireRole(req, 'duena', 'gerencia', 'coordinacion', 'finanzas', 'logistica'); return all('SELECT * FROM talleres ORDER BY active DESC, name'); }));
r.post('/talleres', wrap((req) => {
  requireRole(req, ...MANDAN);
  const d = tallerDe(req.body);
  if (!d.name) throw fail(400, 'El nombre del taller es obligatorio.');
  const id = insert('talleres', d);
  audit(req.user, 'talleres', `taller ${d.name}`, null, d, String(id));
  return get('SELECT * FROM talleres WHERE id = ?', id);
}));
r.put('/talleres/:id', wrap((req) => {
  requireRole(req, ...MANDAN);
  const t = get('SELECT * FROM talleres WHERE id = ?', req.params.id);
  if (!t) throw fail(404, 'Taller no encontrado');
  const d = { ...tallerDe(req.body, t), active: req.body.active === undefined ? t.active : req.body.active ? 1 : 0 };
  if (!d.name) throw fail(400, 'El nombre del taller es obligatorio.');
  run(`UPDATE talleres SET ${Object.keys(d).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(d), t.id);
  audit(req.user, 'talleres', `taller ${t.name}`, Object.fromEntries(Object.keys(d).map((k) => [k, t[k]])), d, String(t.id));
  return get('SELECT * FROM talleres WHERE id = ?', t.id);
}));

/** Estado de producción externa de una orden: requisitos, PO vigente y vista previa de lo que llevaría. */
r.get('/jobs/:id/po', wrap((req) => {
  const job = loadJob(req.params.id);
  const po = poDeJob(job.id);
  const sinMontos = esLogistica(req.user) || soloPropios(req.user);
  const previa = po || sinMontos ? null : lineasDeOrden(job);
  return {
    requisitos: requisitos(job), po: vista(po, req.user), puedeMandar: MANDAN.includes(req.user.role),
    previa: previa && { lineas: previa, total: totalDe(previa), faltanCostos: faltanCostos(previa) },
    historial: all("SELECT numero, status, cancel_reason, created_at FROM production_pos WHERE job_id = ? AND status = 'cancelado' ORDER BY id DESC", job.id),
  };
}));

r.post('/jobs/:id/po', wrap((req) => {
  requireRole(req, ...MANDAN);
  const job = loadJob(req.params.id);
  const req0 = requisitos(job);
  if (!req0.ok) throw fail(400, `Todavía no se puede mandar a producción: ${req0.lista.filter((x) => !x.ok).map((x) => x.texto).join('; ')}.`);
  if (poDeJob(job.id)) throw fail(400, 'Esta orden ya tiene un PO. Cancélalo si necesitas hacer otro.');
  const taller = get('SELECT * FROM talleres WHERE id = ? AND active = 1', Number(req.body.taller_id));
  if (!taller) throw fail(400, 'Escoge el taller.');
  const lineas = lineasDeOrden(job);
  if (!lineas.some((l) => (l.tipo === 'prenda' ? l.decoraciones.length : true))) throw fail(400, 'La orden no tiene decoración ni servicios para mandar a un taller.');
  const aprobada = job.proofs[0];
  const id = transaction(() => {
    const pid = insert('production_pos', {
      job_id: job.id, taller_id: taller.id, numero: nextNumber('PO', 'seq_po'), token: randomBytes(16).toString('hex'),
      instrucciones: txt(req.body.instrucciones) || null, fecha_entrega: /^\d{4}-\d{2}-\d{2}$/.test(req.body.fecha_entrega || '') ? req.body.fecha_entrega : job.due_date || null,
      lineas: JSON.stringify(lineas), pruebas: JSON.stringify([{ version: aprobada.version, file_url: aprobada.file_url }]), total: totalDe(lineas), created_by: req.user.name,
    });
    logSystem(job, `PO de producción creado para ${taller.name} (borrador)`);
    return pid;
  });
  return vista(poPorId(id), req.user);
}));

function poEditable(req) {
  requireRole(req, ...MANDAN);
  const po = poPorId(req.params.id);
  if (!po) throw fail(404, 'PO no encontrado');
  return po;
}

/** Corrige el PO mientras es borrador: taller, instrucciones, fecha, y el costo por pieza de cada decoración o servicio. */
r.put('/po/:id', wrap((req) => {
  const po = poEditable(req);
  if (po.status !== 'borrador') throw fail(400, 'El PO ya se mandó: no se puede cambiar. Cancélalo y haz uno nuevo si hace falta.');
  const b = req.body;
  const d = {};
  if ('taller_id' in b) { const t = get('SELECT id FROM talleres WHERE id = ? AND active = 1', Number(b.taller_id)); if (!t) throw fail(400, 'Taller no válido'); d.taller_id = t.id; }
  if ('instrucciones' in b) d.instrucciones = txt(b.instrucciones) || null;
  if ('fecha_entrega' in b) d.fecha_entrega = /^\d{4}-\d{2}-\d{2}$/.test(b.fecha_entrega || '') ? b.fecha_entrega : null;
  if (Array.isArray(b.lineas)) {
    // Solo se aceptan cambios de costo y quitar líneas de servicio; cantidades, tallas y decoración vienen de la orden
    const costo = (v) => { const n = num(v); if (n != null && (n < 0 || n > 100000)) throw fail(400, 'Costo no válido'); return n; };
    const nuevas = [];
    po.lineas.forEach((l, i) => {
      const e = b.lineas[i] || {};
      if (l.tipo === 'servicio') {
        if (e.quitar) return;
        const cu = 'costoUnitario' in e ? costo(e.costoUnitario) : l.costoUnitario;
        nuevas.push({ ...l, costoUnitario: cu, total: cu == null ? null : r2(cu * l.cantidad) });
      } else {
        nuevas.push({ ...l, decoraciones: l.decoraciones.map((x, k) => {
          const ed = e.decoraciones?.[k] || {};
          const cu = 'costoUnitario' in ed ? costo(ed.costoUnitario) : x.costoUnitario;
          return { ...x, colores: 'colores' in ed ? txt(ed.colores, 200) || null : x.colores, costoUnitario: cu, total: cu == null ? null : r2(cu * l.cantidad) };
        }) });
      }
    });
    d.lineas = JSON.stringify(nuevas);
    d.total = totalDe(nuevas);
    if (po.total !== d.total) audit(req.user, 'produccion', `total del ${po.numero}`, po.total, d.total, String(po.id));
  }
  if (Object.keys(d).length) run(`UPDATE production_pos SET ${Object.keys(d).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(d), po.id);
  return vista(poPorId(po.id), req.user);
}));

/** Marca el PO como enviado (la persona ya lo mandó por enlace o PDF) y pasa la orden a Producción. */
r.post('/po/:id/enviar', wrap((req) => {
  const po = poEditable(req);
  if (po.status !== 'borrador') throw fail(400, 'Este PO ya estaba enviado.');
  const job = loadJob(po.job_id);
  const req0 = requisitos(job);
  if (!req0.ok) throw fail(400, `No se puede mandar: ${req0.lista.filter((x) => !x.ok).map((x) => x.texto).join('; ')}.`);
  const faltan = faltanCostos(po.lineas);
  if (faltan.length) throw fail(400, `Falta el costo de: ${faltan.join('; ')}. Ponlo en el PO antes de mandarlo (un costo desconocido no se toma como $0).`);
  transaction(() => {
    cambiarEstado(po, 'enviado', { sent_at: ahora(), sent_by: req.user.name });
    logSystem(job, `${po.numero} enviado al taller por ${req.user.name}`);
    setOrderStatus(job.id, 'produccion');
  });
  audit(req.user, 'produccion', `${po.numero} de ${job.order_number}`, 'borrador', { estado: 'enviado', total: po.total }, String(po.id));
  return vista(poPorId(po.id), req.user);
}));

/** Avance a mano, por si el taller no usa el enlace: recibido / terminado. */
r.post('/po/:id/estado', wrap((req) => {
  const po = poEditable(req);
  avanzar(po, req.body.estado, req.user.name, req.body.nota);
  return vista(poPorId(po.id), req.user);
}));

r.post('/po/:id/cancelar', wrap((req) => {
  const po = poEditable(req);
  if (po.status === 'cancelado') return vista(po, req.user);
  if (po.status === 'terminado') throw fail(400, 'El taller ya terminó este PO: no se puede cancelar.');
  const motivo = txt(req.body.motivo, 300);
  if (po.status !== 'borrador' && motivo.length < 3) throw fail(400, 'Escribe el motivo: este PO ya se le mandó al taller.');
  cambiarEstado(po, 'cancelado', { cancel_reason: motivo || null });
  logSystem(loadJob(po.job_id), `${po.numero} cancelado${motivo ? `: ${motivo}` : ''}`);
  audit(req.user, 'produccion', `${po.numero}`, po.status, { estado: 'cancelado', motivo }, String(po.id));
  return { ok: true };
}));

r.get('/po/:id/pdf', (req, res) => {
  try {
    const po = poPorId(req.params.id);
    if (!po) throw fail(404, 'PO no encontrado');
    if (esLogistica(req.user)) throw fail(403, 'Logística no ve lo que se le paga al taller.');
    if (soloPropios(req.user) && !jobPermitido(req.user, po.job_id)) throw fail(404, 'PO no encontrado');
    pdfDelPO(po, res, { conMontos: !soloPropios(req.user) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

function avanzar(po, estado, quien, nota) {
  const orden = ['enviado', 'recibido', 'terminado'];
  if (!['recibido', 'terminado'].includes(estado)) throw fail(400, 'Estado no válido');
  if (!orden.includes(po.status)) throw fail(400, po.status === 'borrador' ? 'Este PO todavía no se ha enviado.' : 'Este PO está cancelado.');
  if (orden.indexOf(estado) <= orden.indexOf(po.status)) return; // ya estaba en ese punto o más adelante
  const job = loadJob(po.job_id);
  transaction(() => {
    if (estado === 'recibido') cambiarEstado(po, 'recibido', { received_at: ahora(), ...(nota ? { nota_taller: txt(nota, 500) } : {}) });
    else {
      cambiarEstado(po, 'terminado', { done_at: ahora(), received_at: po.received_at || ahora(), ...(nota ? { nota_taller: txt(nota, 500) } : {}) });
      // El taller terminó: la orden pasa a Calidad y queda una tarea para revisarla
      setOrderStatus(job.id, 'calidad');
      insert('tasks', { title: `Revisar ${job.order_number}: el taller terminó el ${po.numero}`, due_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), job_id: job.id, contact_id: job.contact_id || null });
    }
    logSystem(job, `${po.numero}: ${estado === 'recibido' ? 'recibido' : 'terminado'} (${quien})${nota ? ` · ${txt(nota, 200)}` : ''}`);
  });
}

// ---------- página pública del taller (por token; sin sesión) ----------
/** Lo que ve el taller: instrucciones, cantidades, artes y lo que se le paga. Nunca datos del cliente ni precios de venta. */
function publico(tok) {
  const po = leer(get("SELECT * FROM production_pos WHERE token = ? AND status != 'borrador'", String(tok || '')));
  if (!po) throw fail(404, 'Enlace inválido o PO todavía no enviado');
  const job = get('SELECT order_number, title FROM jobs WHERE id = ?', po.job_id);
  const taller = get('SELECT name, contacto, address FROM talleres WHERE id = ?', po.taller_id);
  return {
    numero: po.numero, status: po.status, estado: ESTADOS_PO[po.status], orden: job?.order_number, trabajo: job?.title,
    fecha: po.sent_at?.slice(0, 10), fecha_entrega: po.fecha_entrega, instrucciones: po.instrucciones, lineas: po.lineas, total: po.total,
    pruebas: po.pruebas, taller, received_at: po.received_at, done_at: po.done_at, cancel_reason: po.status === 'cancelado' ? po.cancel_reason : undefined,
    business_name: getSetting('business_name', 'Color Plus LLC'), brand: getBrand(), _po: po,
  };
}
r.get('/portal/taller/:token', wrap((req) => { const { _po, ...p } = publico(req.params.token); return p; }));
r.post('/portal/taller/:token/estado', wrap((req) => {
  const { _po } = publico(req.params.token);
  if (_po.status === 'cancelado') throw fail(400, 'Este PO fue cancelado.');
  avanzar(_po, req.body.estado, 'taller', req.body.nota);
  const { _po: _x, ...p } = publico(req.params.token);
  return p;
}));
r.get('/portal/taller/:token/pdf', (req, res) => {
  try { pdfDelPO(publico(req.params.token)._po, res, { conMontos: true }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- PDF ----------
const dinero = (n) => (n == null ? 'por definir' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Fecha estilo americano: 2026-12-10 → 12/10/2026 */
const COLOR_ESTADO = { borrador: ['#eef0f5', '#555555'], enviado: ['#e7f0ff', '#1556c0'], recibido: ['#fff3d6', '#8a5a00'], terminado: ['#dff5e7', '#17663c'], cancelado: ['#fde8e6', '#b42318'] };
const GRADIENTE = ['#1ec5da', '#613bbb', '#bd68d4', '#f8822b', '#facc59'];

/** PDF del PO con el mismo diseño que la página del enlace: franja de marca, logo, cajas por línea, tallas en recuadros y la prueba en su marco. */
function pdfDelPO(po, res, { conMontos }) {
  const job = get('SELECT order_number, title FROM jobs WHERE id = ?', po.job_id);
  const taller = get('SELECT * FROM talleres WHERE id = ?', po.taller_id);
  const negocio = getSetting('business_name', 'Color Plus LLC');
  const M = 44;
  const doc = new PDFDocument({ size: 'LETTER', margin: M });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${po.numero}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width - M * 2;
  const DER = M + W;
  const GRIS = '#6b7189', TEXTO = '#1c2033', BORDE = '#e3e5ee', SUAVE = '#ebe7f7';
  const franja = () => {
    const g = doc.linearGradient(M, 0, DER, 0);
    GRADIENTE.forEach((c, k) => g.stop(k / (GRADIENTE.length - 1), c));
    doc.rect(M, 30, W, 4).fill(g);
  };
  const fondo = () => doc.page.height - M;
  let y = 0;
  const cabe = (alto) => { if (y + alto > fondo()) { doc.addPage(); franja(); y = 50; } };
  const titulo = (t) => { cabe(40); doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXTO).text(t, M, y); y += 20; };

  // ---- encabezado ----
  franja();
  y = 48;
  const logo = logoFilePath(UPLOAD_DIR);
  if (logo) { try { doc.image(logo, M, y, { fit: [120, 52] }); y += 60; } catch { /* sin logo */ } }
  const yCab = y;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(TEXTO).text(`Orden de compra ${po.numero}`, M, y, { width: W - 190 });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`${negocio} · Orden interna ${job?.order_number || '—'} · ${job?.title || ''}`, M, y, { width: W - 190 });
  y = doc.y;
  // columna derecha: estado, taller y fecha
  const [bg, fg] = COLOR_ESTADO[po.status] || COLOR_ESTADO.borrador;
  const etiqueta = ESTADOS_PO[po.status];
  doc.font('Helvetica-Bold').fontSize(8.5);
  const wB = doc.widthOfString(etiqueta) + 16;
  let yD = logo ? 52 : yCab;
  doc.roundedRect(DER - wB, yD, wB, 16, 8).fill(bg);
  doc.fillColor(fg).text(etiqueta, DER - wB, yD + 4.5, { width: wB, align: 'center' });
  yD += 26;
  const derecha = (negrita, resto) => {
    doc.font('Helvetica').fontSize(10);
    const wr = doc.widthOfString(resto);
    doc.font('Helvetica-Bold');
    const wn = doc.widthOfString(negrita);
    doc.fillColor(TEXTO).text(negrita, DER - wn - wr, yD, { lineBreak: false });
    doc.font('Helvetica').text(resto, DER - wr, yD, { lineBreak: false });
    yD += 18;
  };
  derecha('Para: ', taller?.name || '—');
  derecha('Entregar el: ', fechaUS(po.fecha_entrega) || 'por confirmar');
  y = Math.max(y, yD) + 12;
  doc.moveTo(M, y).lineTo(DER, y).lineWidth(1).strokeColor(BORDE).stroke();
  y += 16;

  if (po.status === 'cancelado') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b42318').text(`Este PO fue cancelado.${po.cancel_reason ? ` ${po.cancel_reason}` : ''}`, M, y, { width: W });
    y = doc.y + 12;
  }

  // ---- instrucciones ----
  if (po.instrucciones) {
    titulo('Instrucciones');
    doc.font('Helvetica').fontSize(10).fillColor(TEXTO);
    cabe(doc.heightOfString(po.instrucciones, { width: W }) + 10);
    doc.text(po.instrucciones, M, y, { width: W });
    y = doc.y + 16;
  }

  // ---- trabajo ----
  titulo('Trabajo');
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text('Las prendas las envía SanMar directo a tu taller. Verifica cantidades y tallas al recibirlas.', M, y, { width: W });
  y = doc.y + 8;
  const PAD = 10;
  const filaMonto = (izq, der, negritaDer = false) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(TEXTO);
    const wDer = der ? doc.widthOfString(der) + 4 : 0;
    doc.text(izq, M + PAD, y, { width: W - PAD * 2 - wDer - 8 });
    const yFin = doc.y;
    if (der) doc.font(negritaDer ? 'Helvetica-Bold' : 'Helvetica').text(der, DER - PAD - wDer, y, { width: wDer, align: 'right', lineBreak: false });
    y = yFin + 5;
  };
  po.lineas.forEach((l, i) => {
    const esPrenda = l.tipo === 'prenda';
    const alto = esPrenda ? 62 + l.decoraciones.length * 20 : 30;
    cabe(alto + 8);
    const y0 = y;
    y += PAD;
    if (esPrenda) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXTO).text(`${i + 1}. ${l.codigo ? `${l.codigo} · ` : ''}${l.descripcion}`, M + PAD, y, { continued: !!l.color, width: W - PAD * 2 });
      if (l.color) doc.font('Helvetica').text(` · ${l.color}`);
      y = doc.y + 6;
      // tallas en recuadros, como en la página
      let x = M + PAD;
      const chip = (arriba, abajo, resaltado) => {
        const w = Math.max(40, doc.font('Helvetica-Bold').fontSize(10).widthOfString(String(abajo)) + 18, doc.font('Helvetica').fontSize(7.5).widthOfString(String(arriba)) + 14);
        if (x + w > DER - PAD) { x = M + PAD; y += 34; }
        doc.roundedRect(x, y, w, 30, 5).fillAndStroke(resaltado ? SUAVE : '#ffffff', BORDE);
        doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(String(arriba), x, y + 5, { width: w, align: 'center', lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXTO).text(String(abajo), x, y + 15, { width: w, align: 'center', lineBreak: false });
        x += w + 6;
      };
      for (const [t, n] of Object.entries(l.tallas)) chip(t, n, false);
      chip('Total', l.cantidad, true);
      y += 38;
      for (const d of l.decoraciones) {
        doc.moveTo(M + PAD, y - 2).lineTo(DER - PAD, y - 2).dash(2, { space: 2 }).strokeColor(BORDE).stroke().undash();
        y += 4;
        const detalle = [`${d.nombre} · ${d.ubicacion}`, d.ancho && d.alto ? `${d.ancho}" × ${d.alto}"` : null, d.puntadas ? `${d.puntadas} puntadas` : null, d.hojas ? `${d.hojas} hoja(s) por pieza` : null, d.colores ? `colores: ${d.colores}` : null].filter(Boolean).join(' · ');
        filaMonto(detalle, conMontos ? `${dinero(d.costoUnitario)}/pz × ${l.cantidad} = ${dinero(d.total)}` : '');
      }
    } else {
      filaMonto(`${i + 1}. ${l.descripcion} × ${l.cantidad}`, conMontos ? dinero(l.total) : '', true);
    }
    y += PAD - 5;
    doc.roundedRect(M, y0, W, y - y0, 7).lineWidth(1).strokeColor(BORDE).stroke();
    y += 6;
  });
  if (conMontos) {
    cabe(30);
    y += 4;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXTO).text('Total a pagar', DER - 300, y, { width: 150, lineBreak: false });
    doc.text(dinero(po.total), DER - 150, y, { width: 150, align: 'right', lineBreak: false });
    y += 28;
  }

  // ---- arte aprobado (misma caja que en la página) ----
  for (const p of po.pruebas) {
    const archivo = resolve(UPLOAD_DIR, basename(String(p.file_url || '')));
    const esImagen = /\.(png|jpe?g)$/i.test(archivo) && existsSync(archivo);
    if (fondo() - y < 260) { doc.addPage(); franja(); y = 50; }
    titulo(`Arte aprobado por el cliente${po.pruebas.length > 1 ? ` · v${p.version}` : ''}`);
    const altoCaja = Math.min(fondo() - y, 520);
    doc.roundedRect(M, y, W, altoCaja, 10).fill(SUAVE);
    doc.roundedRect(M + 12, y + 12, W - 24, altoCaja - 24, 6).fill('#ffffff');
    if (esImagen) {
      try { doc.image(archivo, M + 20, y + 20, { fit: [W - 40, altoCaja - 40], align: 'center', valign: 'center' }); } catch { doc.font('Helvetica').fontSize(10).fillColor(GRIS).text('No se pudo incluir la imagen; ábrela desde el enlace del PO.', M + 24, y + 28, { width: W - 48 }); }
    } else doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(`La prueba v${p.version} no es una imagen; ábrela o descárgala desde el enlace del PO.`, M + 24, y + 28, { width: W - 48 });
    y += altoCaja + 16;
  }
  doc.end();
}
