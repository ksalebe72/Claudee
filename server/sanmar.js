// Integración con SanMar Web Services (servicio estándar de información de producto).
// Credenciales por variables de entorno:
//   SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME, SANMAR_PASSWORD
//   SANMAR_ENDPOINT (opcional; por defecto producción)
// Las imágenes se descargan del lado del servidor y se guardan en server/uploads/sanmar/
// para poder usarlas en las pruebas (el navegador no puede exportar imágenes de otro dominio).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get, run, getSetting, setSetting } from './db.js';

const DEFAULT_ENDPOINT = 'https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort';
const NS = 'http://impl.webservice.integration.sanmar.com/';
const CACHE_HOURS = 12;

export const IMAGE_FIELDS = ['frontFlat', 'backFlat', 'frontModel', 'backModel', 'sideModel', 'threeQModel', 'colorProductImage', 'productImage'];

run(`CREATE TABLE IF NOT EXISTS supplier_cache (key TEXT PRIMARY KEY, data TEXT, fetched_at TEXT DEFAULT (datetime('now')))`);

export const sanmarConfigured = () =>
  !!(process.env.SANMAR_CUSTOMER_NUMBER && process.env.SANMAR_USERNAME && process.env.SANMAR_PASSWORD);

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function envelope({ style, color = '', size = '' }) {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:impl="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <impl:getProductInfoByStyleColorSize>
      <arg0><color>${esc(color)}</color><size>${esc(size)}</size><style>${esc(style)}</style></arg0>
      <arg1>
        <sanMarCustomerNumber>${esc(process.env.SANMAR_CUSTOMER_NUMBER)}</sanMarCustomerNumber>
        <sanMarUserName>${esc(process.env.SANMAR_USERNAME)}</sanMarUserName>
        <sanMarUserPassword>${esc(process.env.SANMAR_PASSWORD)}</sanMarUserPassword>
      </arg1>
    </impl:getProductInfoByStyleColorSize>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export async function callSanmar(params) {
  if (!sanmarConfigured()) throw Object.assign(new Error('SanMar no está configurado (faltan SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME, SANMAR_PASSWORD)'), { status: 400 });
  const res = await fetch(process.env.SANMAR_ENDPOINT || DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: envelope(params),
    signal: AbortSignal.timeout(30000),
  });
  const xml = await res.text();
  if (!res.ok && !xml.includes('Envelope')) throw new Error(`SanMar respondió ${res.status}`);
  return xml;
}

/** Lector XML mínimo: quita prefijos de namespace y aplana cada <listResponse> en un objeto de hojas. */
export function parseProductResponse(xml) {
  const clean = xml.replace(/<(\/?)[\w-]+:/g, '<$1');
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(clean);
  if (fault) throw new Error(`SanMar: ${unesc(fault[1])}`);
  if (/<errorOccur+ed>\s*true\s*<\/errorOccur+ed>/i.test(clean)) {
    const msg = /<message>([\s\S]*?)<\/message>/.exec(clean);
    throw new Error(`SanMar: ${msg ? unesc(msg[1]).trim() : 'error desconocido'}`);
  }
  const rows = [];
  const re = /<listResponse>([\s\S]*?)<\/listResponse>/g;
  let m;
  while ((m = re.exec(clean))) {
    const row = {};
    const leaf = /<(\w+)>([^<]*)<\/\1>/g;
    let f;
    while ((f = leaf.exec(m[1]))) if (!(f[1] in row)) row[f[1]] = unesc(f[2]).trim();
    rows.push(row);
  }
  return rows;
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL', 'OSFA'];
const sizeRank = (s) => { const i = SIZE_ORDER.indexOf(s); return i < 0 ? 99 : i; };
const num = (v) => (v === undefined || v === '' ? null : Number(v));

/** Agrupa las filas (una por color/talla) en un estilo con sus colores e imágenes. */
export function summarizeStyle(style, rows) {
  if (!rows.length) throw Object.assign(new Error(`SanMar no devolvió resultados para el estilo ${style}`), { status: 404 });
  const first = rows[0];
  const colors = new Map();
  const sizes = new Set();
  let minPrice = null;
  for (const r of rows) {
    const name = r.catalogColor || r.colorName || r.color;
    if (r.size) sizes.add(r.size);
    const price = num(r.piecePrice) ?? num(r.price);
    if (price != null && (minPrice == null || price < minPrice)) minPrice = price;
    if (!name || colors.has(name)) continue;
    const images = {};
    for (const k of IMAGE_FIELDS) if (r[k] && /^https?:\/\//.test(r[k])) images[k] = r[k];
    colors.set(name, {
      name,
      mainframeColor: r.color || name,
      swatch: r.colorSwatchImage || r.colorSquareImage || null,
      images,
    });
  }
  return {
    style: first.style || style,
    title: first.productTitle || first.title || style,
    brand: first.brandName || first.brand || '',
    category: first.category || '',
    piecePrice: minPrice,
    sizes: [...sizes].sort((a, b) => sizeRank(a) - sizeRank(b)),
    colors: [...colors.values()],
  };
}

export async function getStyle(style, { refresh = false } = {}) {
  style = String(style).trim().toUpperCase();
  const key = `sanmar:${style.toUpperCase()}`;
  if (!refresh) {
    const c = get(`SELECT data FROM supplier_cache WHERE key = ? AND fetched_at > datetime('now', ?)`, key, `-${CACHE_HOURS} hours`);
    if (c) return JSON.parse(c.data);
  }
  const data = summarizeStyle(style, parseProductResponse(await callSanmar({ style })));
  run(`INSERT INTO supplier_cache (key, data, fetched_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`, key, JSON.stringify(data));
  return data;
}

// ---------- imágenes ----------
export function isAllowedImageUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // SANMAR_EXTRA_IMAGE_HOSTS: hosts adicionales permitidos (p. ej. un CDN distinto o un servidor de pruebas)
    const extra = (process.env.SANMAR_EXTRA_IMAGE_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    return /(^|\.)sanmar\.com$/i.test(url.hostname) || extra.includes(url.host);
  } catch { return false; }
}

/** Descarga (una vez) una imagen de SanMar y devuelve la ruta local. */
export async function cacheImage(u, uploadDir) {
  if (!isAllowedImageUrl(u)) throw Object.assign(new Error('Solo se permiten imágenes de sanmar.com'), { status: 400 });
  const dir = resolve(uploadDir, 'sanmar');
  mkdirSync(dir, { recursive: true });
  const ext = (/\.(jpe?g|png|gif|webp|svg)(\?|$)/i.exec(u)?.[1] || 'jpg').toLowerCase();
  const name = `${createHash('sha1').update(u).digest('hex').slice(0, 20)}.${ext}`;
  const file = resolve(dir, name);
  if (!existsSync(file)) {
    const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Object.assign(new Error(`No se pudo descargar la imagen (${r.status})`), { status: 502 });
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return file;
}

// ---------- áreas de impresión calibradas por estilo ----------
const areasKey = (style, kind) => `areas:${String(style).toUpperCase()}:${kind}`;
export const getStyleAreas = (style, kind) => getSetting(areasKey(style, kind), null);
export const setStyleAreas = (style, kind, areas) => setSetting(areasKey(style, kind), areas);
