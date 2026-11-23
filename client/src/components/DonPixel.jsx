// Avatar de Don Pixel en pixel art (16×16) con los colores de Color Plus.
import React from 'react';

const PALETA = {
  P: '#613bbb', // gorra morada
  p: '#4b2c96', // sombra de la gorra
  C: '#1ec5da', // franja cian
  O: '#f8822b', // botón naranja
  S: '#f2c39f', // piel
  D: '#d99c75', // sombra de piel
  K: '#1c1340', // ojos
  W: '#ffffff', // brillo de ojos
  M: '#dfe2ea', // bigote canoso
  m: '#aab0c0', // sombra del bigote
  R: '#c0583c', // boca
  N: '#1c1340', // camisa
  A: '#f8822b', // delantal
  a: '#d96a17', // tirante del delantal
};

const DIBUJO = [
  '......OO........',
  '....PPPPPPP.....',
  '...PPPPPPPPP....',
  '..PPPPPPPPPPP...',
  '..CCCCCCCCCCC...',
  '..pppppppppppPPP',
  '...SSSSSSSSS....',
  '...SKWSSSKWS....',
  '...SKKSSSKKS....',
  '..DSSSSDSSSSD...',
  '...SMMMMMMMS....',
  '...MmMSRSMmM....',
  '....SSSSSSS.....',
  '......SSS.......',
  '..NNaAAAAAaNN...',
  '.NNNaAAAAAaNNN..',
];

/** Don Pixel. `size` en píxeles de pantalla. */
export default function DonPixel({ size = 32, titulo = 'Don Pixel', className = '' }) {
  return (
    <svg className={`don-pixel ${className}`} width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" role="img" aria-label={titulo}>
      {DIBUJO.flatMap((fila, y) => [...fila].map((c, x) => (PALETA[c] ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={PALETA[c]} /> : null)))}
    </svg>
  );
}

/** Saludo según la hora (Maryland). */
export function saludoDonPixel(nombre) {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const parte = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
  return `${parte}${nombre ? `, ${nombre}` : ''}!`;
}

/** Frases mientras Don Pixel piensa. */
export const FRASES_PENSANDO = [
  'Don Pixel está revisando las órdenes…',
  'Calentando la plancha…',
  'Contando puntadas…',
  'Separando colores…',
  'Buscando en el taller…',
];
