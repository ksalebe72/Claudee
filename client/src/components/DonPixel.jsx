// Avatar de Don Pixel (imagen elegida por el dueño, en client/public/brand).
import React from 'react';

/** Don Pixel. `size` en píxeles de pantalla. */
export default function DonPixel({ size = 32, titulo = 'Don Pixel', className = '' }) {
  const src = size <= 64 ? '/brand/don-pixel-128.webp' : '/brand/don-pixel-512.webp';
  return <img className={`don-pixel ${className}`} src={src} width={size} height={size} alt={titulo} title={titulo} loading="lazy" decoding="async" />;
}

/** Saludo según la hora (Maryland). */
export function saludoDonPixel(nombre) {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const parte = h < 12 ? '¡Ey, ajá! Buenos días' : h < 19 ? '¡Ajá! Buenas tardes' : '¡Ey! Buenas noches';
  return `${parte}${nombre ? `, ${nombre}` : ', mi llave'}. ¿Qué más pues?`;
}

/** Frases mientras Don Pixel piensa. */
export const FRASES_PENSANDO = [
  'Eche, déjame revisar esas órdenes…',
  'Calentando la plancha, ajá…',
  'Contando puntadas, tranquilo que eso sale…',
  'Separando colores, mi llave…',
  'Buscando en el taller, aguanta un momentico…',
  '¡Ombe! Ya casi lo tengo…',
];
