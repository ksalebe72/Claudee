// Adaptador de la app para el cliente de SanMar (services/sanmar):
// caché persistente en SQLite, descarga de fotos y áreas de impresión calibradas por estilo.
// El precio de venta (markup) se calcula aquí, en la app, no en el módulo de SanMar.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, get, run, getSetting, setSetting } from './db.js';
import { createSanmarClient, TTL_SEGUNDOS } from '../services/sanmar/index.js';

// ---------- caché en SQLite ----------
run(`CREATE TABLE IF NOT EXISTS supplier_cache (key TEXT PRIMARY KEY, data TEXT, fetched_at TEXT DEFAULT (datetime('now')))`);
if (!db.prepare('PRAGMA table_info(supplier_cache)').all().some((c) => c.name === 'expires_at')) {
  db.exec('ALTER TABLE supplier_cache ADD COLUMN expires_at TEXT');
}

export const sqliteCache = {
  get(key) {
    const r = get(`SELECT data FROM supplier_cache WHERE key = ? AND expires_at > datetime('now')`, key);
    return r ? JSON.parse(r.data) : undefined;
  },
  set(key, value, ttlSeconds) {
    run(`INSERT INTO supplier_cache (key, data, fetched_at, expires_at) VALUES (?, ?, datetime('now'), datetime('now', ?))
         ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      key, JSON.stringify(value), `+${Math.round(ttlSeconds)} seconds`);
  },
};

export function clearSanmarCache(estilo) {
  if (estilo) run(`DELETE FROM supplier_cache WHERE key LIKE ?`, `sanmar:%:${String(estilo).toUpperCase()}%`);
  else run(`DELETE FROM supplier_cache WHERE key LIKE 'sanmar:%'`);
}

export const sanmar = createSanmarClient({ cache: sqliteCache });
export const sanmarConfigured = () => sanmar.configurado();

// ---------- precio de venta ----------
/** Markup sobre el costo de SanMar. 1 = 100% (precio de venta = costo × 2). */
export const getSanmarMarkup = () => Number(getSetting('sanmar_markup', 1));
export const precioVenta = (costo, markup = getSanmarMarkup()) => (costo == null ? null : Math.round(costo * (1 + markup) * 100) / 100);

// ---------- fotos ----------
export function isAllowedImageUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // SANMAR_EXTRA_IMAGE_HOSTS: hosts adicionales permitidos (p. ej. un CDN distinto o un servidor de pruebas)
    const extra = (process.env.SANMAR_EXTRA_IMAGE_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    return /(^|\.)sanmar\.com$/i.test(url.hostname) || extra.includes(url.host);
  } catch { return false; }
}

/** Descarga una foto de SanMar y la guarda 24 h en server/uploads/sanmar/. Devuelve la ruta local. */
export async function cacheImage(u, uploadDir) {
  if (!isAllowedImageUrl(u)) throw Object.assign(new Error('Solo se permiten imágenes de sanmar.com'), { status: 400 });
  const dir = resolve(uploadDir, 'sanmar');
  mkdirSync(dir, { recursive: true });
  const ext = (/\.(jpe?g|png|gif|webp|svg)(\?|$)/i.exec(u)?.[1] || 'jpg').toLowerCase();
  const file = resolve(dir, `${createHash('sha1').update(u).digest('hex').slice(0, 20)}.${ext}`);
  const fresca = existsSync(file) && Date.now() - statSync(file).mtimeMs < TTL_SEGUNDOS.fotos * 1000;
  if (!fresca) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Object.assign(new Error(`No se pudo descargar la foto (${r.status})`), { status: 502 });
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (!existsSync(file)) throw Object.assign(e, { status: e.status || 502 }); // si falla, sirve la copia vieja
    }
  }
  return file;
}

// ---------- áreas de impresión calibradas por estilo ----------
const areasKey = (style, kind) => `areas:${String(style).toUpperCase()}:${kind}`;
export const getStyleAreas = (style, kind) => getSetting(areasKey(style, kind), null);
export const setStyleAreas = (style, kind, areas) => setSetting(areasKey(style, kind), areas);
