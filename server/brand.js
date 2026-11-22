// Identidad visual (logo y colores) configurable por la dueña. Sin valores inventados:
// mientras no se carguen, la app usa su tema neutro.
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSetting, setSetting } from './db.js';

const HEX = /^#[0-9a-f]{6}$/i;
const fail = (status, msg) => Object.assign(new Error(msg), { status });

export function getBrand() {
  return {
    name: getSetting('business_name', 'Color Plus LLC'),
    logo: getSetting('brand_logo', null),
    primary: getSetting('brand_primary', null),
    sidebar: getSetting('brand_sidebar', null),
  };
}

export function setBrandColors({ primary, sidebar }) {
  for (const [k, v] of Object.entries({ primary, sidebar })) {
    if (v === undefined) continue;
    if (v !== null && !HEX.test(v)) throw fail(400, `Color inválido (${k}); usa el formato #RRGGBB`);
    setSetting(`brand_${k}`, v);
  }
}

const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
export function saveLogo(dataUrl, uploadDir) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m || !TIPOS[m[1]]) throw fail(400, 'Sube el logo en PNG, JPG, SVG o WEBP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw fail(400, 'El logo debe pesar menos de 3 MB');
  if (m[1] === 'image/svg+xml' && /<script|on\w+=/i.test(buf.toString('utf8'))) throw fail(400, 'El SVG contiene código no permitido');
  removeLogo(uploadDir);
  const name = `brand-logo-${Date.now()}.${TIPOS[m[1]]}`;
  writeFileSync(resolve(uploadDir, name), buf);
  setSetting('brand_logo', `/uploads/${name}`);
  return `/uploads/${name}`;
}

export function removeLogo(uploadDir) {
  const actual = getSetting('brand_logo', null);
  if (actual) {
    const f = resolve(uploadDir, actual.replace('/uploads/', ''));
    if (existsSync(f)) unlinkSync(f);
  }
  setSetting('brand_logo', null);
}
