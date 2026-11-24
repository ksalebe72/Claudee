// Atajos para cotizar más rápido: lo que el cliente ya pidió antes (app + DecoNetwork) y sus logos guardados.
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { all, get, insert, run } from './db.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });

run(`CREATE TABLE IF NOT EXISTS contact_logos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  hash TEXT NOT NULL, name TEXT, file_url TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(contact_id, hash)
)`);

// ---------- productos pedidos antes ----------
const PROCESO_DECO = [[/emb/i, 'bordado', 'Pecho izquierdo'], [/dtf/i, 'dtf', 'Frente'], [/trf|transfer|heat/i, 'heat_transfer', 'Frente']];

/**
 * Lo que el cliente ya pidió: líneas de prendas de sus cotizaciones/órdenes en la app y de su historial de Deco.
 * Una entrada por prenda+color (la más reciente), sin precios: al agregarla se cotiza con las tarifas de hoy.
 */
export function productosPrevios(contactId, { excluirJob = 0 } = {}) {
  const vistos = new Map();
  const poner = (clave, fila) => { if (!vistos.has(clave) || vistos.get(clave).fecha < fila.fecha) vistos.set(clave, fila); };

  const app = all(`SELECT i.*, j.kind, j.number, j.order_number, substr(COALESCE(j.invoice_date, j.created_at),1,10) AS fecha, p.sku
    FROM job_items i JOIN jobs j ON j.id = i.job_id LEFT JOIN products p ON p.id = i.product_id
    WHERE j.contact_id = ? AND j.id != ? AND COALESCE(i.line_type,'prenda') = 'prenda' AND (i.product_id IS NOT NULL OR i.description != '')
    ORDER BY j.id DESC LIMIT 300`, contactId, Number(excluirJob) || 0);
  for (const i of app) {
    poner(`app|${i.product_id || i.description}|${i.color || ''}`, {
      origen: 'app', de: i.kind === 'order' ? i.order_number : i.number, fecha: i.fecha,
      product_id: i.product_id, codigo: i.sku || null, descripcion: i.description, color: i.color || '',
      tallas: i.sizes || {}, cantidad: i.qty || 0,
      decoraciones: (i.decorations || []).map((d) => ({ process: d.process, location: d.location, width: d.width, height: d.height, ...(d.stitches ? { stitches: d.stitches } : {}), ...(d.sheets ? { sheets: d.sheets } : {}) })),
    });
  }
  const deco = all(`SELECT l.*, o.numero, substr(o.fecha,1,10) AS fecha FROM historial_lineas l JOIN historial_ordenes o ON o.id = l.orden_id
    WHERE o.contact_id = ? AND l.codigo IS NOT NULL AND l.codigo != '' ORDER BY o.fecha DESC LIMIT 500`, contactId);
  for (const l of deco) {
    const m = PROCESO_DECO.find(([re]) => re.test(l.decoracion || ''));
    poner(`deco|${l.codigo}|${l.color || ''}`, {
      origen: 'deco', de: `Deco ${l.numero}`, fecha: l.fecha, product_id: null, codigo: l.codigo, descripcion: l.producto, color: l.color || '',
      tallas: l.tallas || {}, cantidad: l.cantidad || 0,
      // Deco no guarda la ubicación ni el tamaño: se pone la más común y hay que revisarla
      decoraciones: m ? [{ process: m[1], location: m[2] }] : [], revisarDecoracion: !!m,
    });
  }
  return [...vistos.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 60);
}

// ---------- logos del cliente ----------
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };

export const logosDeCliente = (contactId) => all('SELECT id, name, file_url, created_at FROM contact_logos WHERE contact_id = ? ORDER BY id DESC', contactId);

/** Guarda un logo (data URL) en la biblioteca del cliente. Si ya estaba (mismo archivo), devuelve el existente. */
export function guardarLogo(contactId, dataUrl, nombre, uploadDir) {
  if (!get('SELECT id FROM contacts WHERE id = ?', contactId)) throw fail(404, 'Cliente no encontrado');
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  const ext = m && MIME_EXT[m[1]];
  if (!ext) throw fail(400, 'El logo debe ser una imagen (PNG, JPG, WEBP, SVG o GIF).');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 8 * 1024 * 1024) throw fail(400, 'El logo está vacío o pesa más de 8 MB.');
  const hash = createHash('sha1').update(buf).digest('hex');
  const ya = get('SELECT id, name, file_url, created_at FROM contact_logos WHERE contact_id = ? AND hash = ?', contactId, hash);
  if (ya) return ya;
  const archivo = `logo-${hash}.${ext}`;
  if (!existsSync(resolve(uploadDir, archivo))) writeFileSync(resolve(uploadDir, archivo), buf);
  const id = insert('contact_logos', { contact_id: contactId, hash, name: String(nombre || 'Logo').slice(0, 80), file_url: `/uploads/${archivo}` });
  return get('SELECT id, name, file_url, created_at FROM contact_logos WHERE id = ?', id);
}

export function borrarLogo(contactId, logoId) {
  const r = run('DELETE FROM contact_logos WHERE id = ? AND contact_id = ?', logoId, contactId);
  if (!r.changes) throw fail(404, 'Logo no encontrado');
  return logosDeCliente(contactId); // el archivo se queda: pruebas ya enviadas pueden usarlo
}

/** Guarda en la biblioteca del cliente las imágenes de un diseño del decorador (al enviar una prueba). */
export function guardarLogosDeDiseno(contactId, design, uploadDir) {
  if (!contactId || !design?.layers) return 0;
  let n = 0;
  for (const l of design.layers) {
    if (l.type !== 'image') continue;
    const src = l.orig || l.src;
    if (!/^data:image\//.test(src || '')) continue;
    try { guardarLogo(contactId, src, l.name || 'Logo', uploadDir); n++; } catch { /* imagen no válida: se omite */ }
  }
  return n;
}

/** Una sola vez: llena la biblioteca con los logos de las pruebas que ya existían. */
export function logosDePruebasAnteriores(uploadDir) {
  let n = 0;
  for (const p of all('SELECT p.design, j.contact_id FROM proofs p JOIN jobs j ON j.id = p.job_id WHERE p.design IS NOT NULL AND j.contact_id IS NOT NULL')) {
    try { n += guardarLogosDeDiseno(p.contact_id, typeof p.design === 'string' ? JSON.parse(p.design) : p.design, uploadDir); } catch { /* diseño ilegible */ }
  }
  return n;
}
