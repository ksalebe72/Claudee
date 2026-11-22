// Siluetas de prendas (viewBox 0 0 400 440) y áreas de impresión por ubicación.
// Cada área: x, y, w, h en unidades SVG + inW = ancho real en pulgadas (para calcular medidas).

const TEE_BODY = 'M150 22 C170 48 230 48 250 22 L330 46 L392 128 L340 160 L318 132 L320 424 C240 432 160 432 80 424 L82 132 L60 160 L8 128 L70 46 Z';
const TEE_SEAMS = 'M82 132 L70 46 M318 132 L330 46 M60 160 L8 128 M340 160 L392 128';
const HOODIE_BODY = 'M140 40 L70 60 L30 200 L22 400 L62 404 L80 230 L82 424 C160 432 240 432 318 424 L320 230 L338 404 L378 400 L370 200 L330 60 L260 40 Z';
const HOODIE_SEAMS = 'M80 230 L70 60 M320 230 L330 60 M22 385 L62 389 M338 389 L378 385 M82 405 C160 413 240 413 318 405';

export const GARMENTS = {
  tshirt: {
    name: 'Camiseta',
    views: {
      front: { label: 'Frente', body: [TEE_BODY], details: [TEE_SEAMS, 'M150 22 C170 58 230 58 250 22'] },
      back: { label: 'Espalda', body: [TEE_BODY.replace('C170 48 230 48 250 22', 'C175 34 225 34 250 22')], details: [TEE_SEAMS, 'M150 22 C175 42 225 42 250 22'] },
    },
  },
  polo: {
    name: 'Polo',
    views: {
      front: {
        label: 'Frente', body: [TEE_BODY], details: [TEE_SEAMS, 'M193 52 L207 52 L207 130 L193 130 Z'],
        top: ['M150 22 L200 62 L250 22 L264 42 L206 84 L194 84 L136 42 Z'], buttons: [[200, 78], [200, 100], [200, 122]],
      },
      back: { label: 'Espalda', body: [TEE_BODY.replace('C170 48 230 48 250 22', 'C175 34 225 34 250 22')], details: [TEE_SEAMS], top: ['M148 24 C175 34 225 34 252 24 L250 10 C225 20 175 20 150 10 Z'] },
    },
  },
  hoodie: {
    name: 'Sudadera con capucha',
    views: {
      front: {
        label: 'Frente', under: ['M140 42 C130 -6 270 -6 260 42 C250 74 150 74 140 42 Z'], body: [HOODIE_BODY],
        details: [HOODIE_SEAMS, 'M130 300 L270 300 L292 392 L108 392 Z', 'M140 42 C160 80 240 80 260 42'],
        strings: ['M180 66 L176 150', 'M220 66 L224 150'],
      },
      back: { label: 'Espalda', body: [HOODIE_BODY], details: [HOODIE_SEAMS], top: ['M132 44 C118 -6 282 -6 268 44 C260 118 140 118 132 44 Z'] },
    },
  },
  cap: {
    name: 'Gorra',
    views: {
      front: {
        label: 'Frente', body: ['M70 300 C70 140 130 90 200 90 C270 90 330 140 330 300 Z'],
        details: ['M200 92 L200 300', 'M200 92 C150 140 128 220 132 300', 'M200 92 C250 140 272 220 268 300'],
        top: ['M48 300 C120 284 280 284 352 300 C334 362 66 362 48 300 Z'], buttons: [[200, 92]],
      },
      side: {
        label: 'Lateral', body: ['M90 300 C90 160 170 108 240 118 C304 128 332 200 332 300 Z'],
        details: ['M240 118 C220 170 214 240 220 300', 'M240 118 C280 160 300 230 300 300'],
        top: ['M92 300 C60 298 22 308 8 326 C42 334 96 322 118 304 Z'], buttons: [[240, 118]],
      },
    },
  },
  tote: {
    name: 'Bolsa',
    views: {
      front: { label: 'Frente', handles: ['M140 130 C140 30 260 30 260 130'], body: ['M70 120 L330 120 L336 424 L64 424 Z'], details: ['M70 140 L330 140'] },
      back: { label: 'Reverso', handles: ['M140 130 C140 30 260 30 260 130'], body: ['M70 120 L330 120 L336 424 L64 424 Z'], details: ['M70 140 L330 140'] },
    },
  },
};

const AREAS = {
  tshirt: {
    Frente: { view: 'front', x: 125, y: 92, w: 150, h: 200, inW: 12 },
    Espalda: { view: 'back', x: 120, y: 70, w: 160, h: 230, inW: 12.5 },
    'Pecho izquierdo': { view: 'front', x: 222, y: 84, w: 60, h: 60, inW: 4 },
    'Pecho derecho': { view: 'front', x: 118, y: 84, w: 60, h: 60, inW: 4 },
    'Manga izquierda': { view: 'front', x: 336, y: 72, w: 36, h: 42, inW: 3 },
    'Manga derecha': { view: 'front', x: 28, y: 72, w: 36, h: 42, inW: 3 },
    Nuca: { view: 'back', x: 168, y: 40, w: 64, h: 26, inW: 3.5 },
  },
  hoodie: {
    Frente: { view: 'front', x: 132, y: 104, w: 136, h: 170, inW: 11 },
    Espalda: { view: 'back', x: 120, y: 120, w: 160, h: 220, inW: 12.5 },
    'Pecho izquierdo': { view: 'front', x: 228, y: 96, w: 58, h: 58, inW: 4 },
    'Pecho derecho': { view: 'front', x: 114, y: 96, w: 58, h: 58, inW: 4 },
    'Manga izquierda': { view: 'front', x: 334, y: 140, w: 30, h: 80, inW: 2.5 },
    'Manga derecha': { view: 'front', x: 36, y: 140, w: 30, h: 80, inW: 2.5 },
    Nuca: { view: 'back', x: 168, y: 112, w: 64, h: 26, inW: 3.5 },
  },
  cap: {
    'Frente gorra': { view: 'front', x: 135, y: 160, w: 130, h: 96, inW: 4.5 },
    'Lateral gorra': { view: 'side', x: 160, y: 196, w: 110, h: 70, inW: 2.5 },
  },
  tote: {
    Frente: { view: 'front', x: 105, y: 165, w: 190, h: 210, inW: 11 },
    Espalda: { view: 'back', x: 105, y: 165, w: 190, h: 210, inW: 11 },
  },
};
AREAS.polo = { ...AREAS.tshirt, Frente: { view: 'front', x: 125, y: 140, w: 150, h: 170, inW: 11 } };
AREAS.cap.Frente = AREAS.cap['Frente gorra'];
AREAS.cap.Espalda = { view: 'side', x: 250, y: 220, w: 60, h: 40, inW: 2.5 };

export const DEFAULT_LOCATION = { tshirt: 'Frente', polo: 'Pecho izquierdo', hoodie: 'Frente', cap: 'Frente gorra', tote: 'Frente' };

export function areaFor(garment, location) {
  const table = AREAS[garment] || AREAS.tshirt;
  return table[location] || table[DEFAULT_LOCATION[garment]] || table.Frente;
}

export const locationsFor = (garment) => Object.keys(AREAS[garment] || AREAS.tshirt);

export function garmentFromCategory(category = '', name = '') {
  const s = `${category} ${name}`.toLowerCase();
  if (/hoodie|sudadera|capucha|sweat/.test(s)) return 'hoodie';
  if (/gorra|\bcaps?\b|\bhats?\b|visera|trucker|snapback/.test(s)) return 'cap';
  if (/polo/.test(s)) return 'polo';
  if (/bolsa|tote|bag/.test(s)) return 'tote';
  return 'tshirt';
}

const COLOR_NAMES = {
  blanco: '#ffffff', white: '#ffffff', negro: '#1d1d1f', black: '#1d1d1f', navy: '#1f2a44', marino: '#1f2a44',
  rojo: '#c62828', red: '#c62828', gris: '#9ea3a8', gray: '#9ea3a8', grey: '#9ea3a8', heather: '#b9bcc0',
  royal: '#1f4fbf', azul: '#1f4fbf', maroon: '#6d1f2b', vino: '#6d1f2b', natural: '#efe6d2', charcoal: '#3d4045',
  verde: '#2e7d32', green: '#2e7d32', amarillo: '#f9d423', gold: '#f2b705', naranja: '#ef6c00', orange: '#ef6c00',
  rosa: '#f48fb1', pink: '#f48fb1', morado: '#6a1b9a', purple: '#6a1b9a', beige: '#d9c7a7', kaki: '#b8a77a', khaki: '#b8a77a',
};
export function colorHex(name = '') {
  const first = String(name).toLowerCase().split(/[/\s]/)[0];
  return COLOR_NAMES[first] || '#ffffff';
}
export const SWATCHES = ['#ffffff', '#1d1d1f', '#9ea3a8', '#3d4045', '#1f2a44', '#1f4fbf', '#c62828', '#6d1f2b', '#2e7d32', '#f9d423', '#ef6c00', '#f48fb1', '#6a1b9a', '#efe6d2'];

/** Oscurece/aclara un color hex para costuras y sombras. */
export function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
export const isDark = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 110;
};

export const FONTS = ['Arial', 'Arial Black', 'Impact', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Brush Script MT'];
