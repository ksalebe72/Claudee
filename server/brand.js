// Identidad visual de Color Plus: logo, ícono y colores.
// Por defecto usa la marca de Color Plus (client/public/brand); la dueña puede reemplazarla en Ajustes.
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting, setSetting } from './db.js';

const HEX = /^#[0-9a-f]{6}$/i;
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Colores tomados del logo oficial (fulllogo.png): morado #613bbb; menú en morado muy oscuro.
export const BRAND_DEFAULTS = {
  logo: '/brand/colorplus-logo.png',
  icon: '/brand/colorplus-mark.png',
  primary: '#613bbb',
  sidebar: '#1c1340',
  gradient: ['#1ec5da', '#613bbb', '#bd68d4', '#f8822b', '#facc59'],
};

const val = (k) => getSetting(`brand_${k}`, null) ?? BRAND_DEFAULTS[k];

export function getBrand() {
  return {
    name: getSetting('business_name', 'Color Plus LLC'),
    logo: val('logo'), icon: val('icon'), primary: val('primary'), sidebar: val('sidebar'),
    gradient: BRAND_DEFAULTS.gradient,
    personalizada: ['logo', 'icon', 'primary', 'sidebar'].some((k) => getSetting(`brand_${k}`, null) != null),
  };
}

export function setBrandColors({ primary, sidebar }) {
  for (const [k, v] of Object.entries({ primary, sidebar })) {
    if (v === undefined) continue;
    if (v !== null && !HEX.test(v)) throw fail(400, `Color inválido (${k}); usa el formato #RRGGBB`);
    setSetting(`brand_${k}`, v); // null = volver al color de Color Plus
  }
}

const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
/** tipo: 'logo' (completo, para login/portal/PDF) o 'icon' (solo el símbolo, para el menú y la pestaña). */
export function saveLogo(dataUrl, uploadDir, tipo = 'logo') {
  if (!['logo', 'icon'].includes(tipo)) throw fail(400, 'Tipo de imagen inválido');
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !TIPOS[m[1]]) throw fail(400, 'Sube la imagen en PNG, JPG, SVG o WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw fail(400, 'La imagen debe pesar menos de 3 MB');
  if (m[1] === 'image/svg+xml' && /<script|on\w+=/i.test(buf.toString('utf8'))) throw fail(400, 'El SVG contiene código no permitido');
  removeLogo(uploadDir, tipo);
  const name = `brand-${tipo}-${Date.now()}.${TIPOS[m[1]]}`;
  writeFileSync(resolve(uploadDir, name), buf);
  setSetting(`brand_${tipo}`, `/uploads/${name}`);
  return `/uploads/${name}`;
}

/** Quita la imagen personalizada y vuelve a la de Color Plus. */
export function removeLogo(uploadDir, tipo = 'logo') {
  const actual = getSetting(`brand_${tipo}`, null);
  if (actual?.startsWith('/uploads/')) {
    const f = resolve(uploadDir, actual.replace('/uploads/', ''));
    if (existsSync(f)) unlinkSync(f);
  }
  setSetting(`brand_${tipo}`, null);
}

/** Ruta en disco del logo para incrustarlo en PDF (solo PNG/JPG). */
export function logoFilePath(uploadDir) {
  const logo = val('logo');
  const file = logo.startsWith('/uploads/') ? resolve(uploadDir, logo.replace('/uploads/', '')) : resolve(root, 'client', 'public', logo.replace(/^\//, ''));
  return /\.(png|jpe?g)$/i.test(file) && existsSync(file) ? file : null;
}
