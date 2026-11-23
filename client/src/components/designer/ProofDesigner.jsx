import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { textos, procesoCliente, ubicacionCliente, fechaCliente } from '../../../../shared/idiomas.js';
import { api, fileToDataUrl } from '../../api.js';
import { fmtDate } from '../../utils.js';
import {
  GARMENTS, areaFor, locationsFor, garmentFromCategory, colorHex, SWATCHES, shade, isDark, FONTS, DEFAULT_LOCATION, guiaPara,
} from './garments.js';

const uid = () => Math.random().toString(36).slice(2, 9);
const BASE_FONT = 40;
const VB_W = 400;
const VB_H = 440;

// ---------- utilidades ----------
let measureCtx;
function measureText(text, font, weight) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight || 'normal'} ${BASE_FONT}px "${font}"`;
  return Math.max(12, measureCtx.measureText(text || ' ').width);
}

const loadImage = (src) => new Promise((ok, ko) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => ko(new Error('No se pudo cargar la imagen'));
  i.src = src;
});

/** Reduce imágenes grandes para que la prueba no pese demasiado. */
async function normalizeImage(dataUrl) {
  if (dataUrl.startsWith('data:image/svg')) {
    const img = await loadImage(dataUrl);
    return { src: dataUrl, w: img.naturalWidth || 300, h: img.naturalHeight || 300 };
  }
  const img = await loadImage(dataUrl);
  const max = 1400;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && dataUrl.startsWith('data:image/png')) return { src: dataUrl, w: img.naturalWidth, h: img.naturalHeight };
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/png'), w: c.width, h: c.height };
}

/** Convierte a transparente los pixeles casi blancos (logos en JPG con fondo blanco). */
async function removeWhite(src, tol = 232) {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const [r, g, b] = [d.data[i], d.data[i + 1], d.data[i + 2]];
    const m = Math.min(r, g, b);
    if (m >= tol) d.data[i + 3] = 0;
    else if (m > tol - 25) d.data[i + 3] = Math.round(d.data[i + 3] * ((tol - m) / 25)); // borde suave
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

function layerBox(l) {
  const w = l.baseW * l.scale;
  const h = l.baseH * l.scale;
  const r = (l.rot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: l.cx - bw / 2, y: l.cy - bh / 2, w: bw, h: bh };
}
function unionBox(layers) {
  if (!layers.length) return null;
  const bs = layers.map(layerBox);
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}
const outside = (b, a) => b.x < a.x - 1 || b.y < a.y - 1 || b.x + b.w > a.x + a.w + 1 || b.y + b.h > a.y + a.h + 1;
const inches = (units, area) => (units / area.w) * area.inW;
const areaOf = (design, loc) => design.areas?.[loc] || areaFor(design.garment, loc);
/** Rectángulo de la guía estándar dentro del área: centrado a lo ancho y arriba (en unidades SVG). */
function guiaRect(design, loc, guias) {
  const g = guiaPara(guias, loc);
  if (!g) return null;
  const a = areaOf(design, loc);
  const k = a.w / a.inW; // unidades por pulgada
  const w = g.ancho * k, h = g.alto * k;
  return { ...g, x: a.x + (a.w - w) / 2, y: a.y, w, h };
}
/** Si el diseño de una ubicación mide más que su guía estándar: { ubicacion, ancho, alto, guia } */
function excesoGuia(design, loc, guias) {
  const g = guiaPara(guias, loc);
  const u = unionBox(design.layers.filter((l) => l.location === loc));
  if (!g || !u) return null;
  const a = areaOf(design, loc);
  const ancho = inches(u.w, a), alto = inches(u.h, a);
  return ancho > g.ancho + 0.05 || alto > g.alto + 0.05 ? { ubicacion: loc, ancho, alto, guia: g } : null;
}

// Fotos de SanMar por vista
const proxied = (u) => `/api/sanmar/image?u=${encodeURIComponent(u)}`;
/** Fotos del color (formato services/sanmar) → vistas del decorador. */
function viewsFromColor(color, kind) {
  const f = color.fotos || {};
  const src = kind === 'model'
    ? { front: f.modelo?.frente || f.frente, back: f.modelo?.espalda || f.espalda, side: f.lado }
    : { front: f.plana?.frente || f.frente, back: f.plana?.espalda || f.espalda, side: f.lado };
  return Object.fromEntries(Object.entries(src).filter(([, u]) => u).map(([v, u]) => [v, proxied(u)]));
}
const blobToDataUrl = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); });
const photoCache = new Map();
async function toDataUrl(url) {
  if (!url || url.startsWith('data:')) return url;
  if (!photoCache.has(url)) {
    photoCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error('No se pudo cargar la foto de la prenda'); return r.blob(); }).then(blobToDataUrl)
      .catch((e) => { photoCache.delete(url); throw e; }));
  }
  return photoCache.get(url);
}

export function designFromItem(item) {
  const garment = garmentFromCategory(item?.product_category, item?.product_name || item?.description);
  const placements = {};
  for (const d of item?.decorations || []) placements[d.location || DEFAULT_LOCATION[garment]] = { method: d.process || d.method || '', inks: '' };
  if (!Object.keys(placements).length) placements[DEFAULT_LOCATION[garment]] = { method: '', inks: '' };
  return { garment, color: colorHex(item?.color), colorName: item?.color || '', placements, layers: [], note: '' };
}

// ---------- vista de prenda (SVG) ----------
function GarmentView({ garment, color, view, design, activeLoc, selectedId, interactive, showDims, svgRef, onLayerDown, onBackground, photo, editArea, onAreaDown, guias }) {
  const rid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = GARMENTS[garment] || GARMENTS.tshirt;
  const v = g.views[view] || Object.values(g.views)[0];
  const line = isDark(color) ? shade(color, 0.2) : shade(color, -0.28);
  const layers = design.layers.filter((l) => areaOf(design, l.location).view === view);
  const locsHere = Object.keys(design.placements).filter((loc) => areaOf(design, loc).view === view);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} xmlns="http://www.w3.org/2000/svg" className="garment-svg"
      onPointerDown={interactive ? onBackground : undefined}>
      <defs>
        <linearGradient id={`sh${rid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.12" />
          <stop offset="0.22" stopColor="#000" stopOpacity="0" />
          <stop offset="0.78" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {photo && <image href={photo} x="0" y="0" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid meet" />}
      {!photo && <>
      {v.handles?.map((d, i) => <path key={`h${i}`} d={d} fill="none" stroke={shade(color, -0.12)} strokeWidth="12" strokeLinecap="round" />)}
      {v.under?.map((d, i) => <path key={`u${i}`} d={d} fill={shade(color, -0.1)} stroke={line} strokeWidth="1.5" />)}
      {v.body.map((d, i) => <path key={`b${i}`} d={d} fill={color} stroke={line} strokeWidth="1.8" strokeLinejoin="round" />)}
      {v.body.map((d, i) => <path key={`s${i}`} d={d} fill={`url(#sh${rid})`} />)}
      {v.details?.map((d, i) => <path key={`d${i}`} d={d} fill="none" stroke={line} strokeWidth="1.2" strokeDasharray={i === 0 ? '3 3' : undefined} opacity="0.8" />)}
      {v.top?.map((d, i) => <path key={`t${i}`} d={d} fill={shade(color, isDark(color) ? 0.05 : -0.05)} stroke={line} strokeWidth="1.5" />)}
      {v.strings?.map((d, i) => <path key={`r${i}`} d={d} stroke={shade(color, -0.2)} strokeWidth="3" strokeLinecap="round" />)}
      {v.buttons?.map(([x, y], i) => <circle key={`c${i}`} cx={x} cy={y} r="3.5" fill={shade(color, -0.15)} stroke={line} />)}
      </>}

      {interactive && locsHere.map((loc) => {
        const a = areaOf(design, loc);
        const active = loc === activeLoc;
        const editing = active && editArea;
        return (
          <g key={loc} pointerEvents={editing ? 'all' : 'none'}>
            <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={editing ? 'rgba(99,102,241,0.12)' : 'none'} stroke={active ? '#6366f1' : '#94a3b8'}
              strokeDasharray="4 3" strokeWidth={active ? 1.4 : 0.8} opacity={active ? 0.9 : 0.5}
              onPointerDown={editing ? (e) => onAreaDown(e, loc, 'move') : undefined} style={editing ? { cursor: 'move' } : undefined} />
            {active && <text x={a.x + 2} y={a.y - 4} fontSize="8" fill="#6366f1" fontFamily="Arial" stroke="#fff" strokeWidth="2" paintOrder="stroke">{loc} · {a.inW}" ancho máx.</text>}
            {editing && <rect x={a.x + a.w - 6} y={a.y + a.h - 6} width="12" height="12" rx="2" fill="#6366f1" stroke="#fff"
              onPointerDown={(e) => onAreaDown(e, loc, 'resize')} style={{ cursor: 'nwse-resize' }} />}
          </g>
        );
      })}

      {layers.map((l) => {
        const sel = interactive && l.id === selectedId;
        const w = l.baseW * l.scale;
        const h = l.baseH * l.scale;
        const warn = interactive && outside(layerBox(l), areaOf(design, l.location));
        return (
          <g key={l.id} transform={`translate(${l.cx} ${l.cy}) rotate(${l.rot})`}
            onPointerDown={interactive && !editArea ? (e) => onLayerDown(e, l, 'move') : undefined}
            pointerEvents={editArea ? 'none' : undefined}
            style={interactive ? { cursor: 'move' } : undefined}>
            <g transform={`scale(${l.scale})`}>
              {l.type === 'image' ? (
                <image href={l.src} x={-l.baseW / 2} y={-l.baseH / 2} width={l.baseW} height={l.baseH} preserveAspectRatio="none" />
              ) : (
                <text x="0" y="0" fontFamily={l.font} fontSize={BASE_FONT} fontWeight={l.weight} fill={l.fill}
                  textAnchor="middle" dominantBaseline="central"
                  stroke={l.strokeW ? l.stroke : 'none'} strokeWidth={l.strokeW || 0} paintOrder="stroke" strokeLinejoin="round">{l.text}</text>
              )}
            </g>
            {(sel || warn) && (
              <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke={warn ? '#ef4444' : '#6366f1'} strokeWidth="1" strokeDasharray={sel ? undefined : '3 2'} pointerEvents="none" />
            )}
            {sel && (
              <>
                <line x1="0" y1={-h / 2} x2="0" y2={-h / 2 - 16} stroke="#6366f1" strokeWidth="1" />
                <circle className="handle" cx="0" cy={-h / 2 - 18} r="5.5" fill="#fff" stroke="#6366f1" strokeWidth="1.5"
                  onPointerDown={(e) => onLayerDown(e, l, 'rotate')} style={{ cursor: 'grab' }} />
                <rect className="handle" x={w / 2 - 5} y={h / 2 - 5} width="10" height="10" rx="2" fill="#6366f1" stroke="#fff"
                  onPointerDown={(e) => onLayerDown(e, l, 'resize')} style={{ cursor: 'nwse-resize' }} />
              </>
            )}
          </g>
        );
      })}

      {/* Guías de medida estándar de todas las ubicaciones de esta vista (bolsillos 3.5×3.5", centro y espalda 9.5×12"):
          verdes si el diseño cabe, rojas si se pasa; más marcadas en las ubicaciones que llevan diseño */}
      {interactive && locationsFor(garment).filter((loc) => areaOf(design, loc).view === view).map((loc) => {
        const gr = guiaRect(design, loc, guias);
        if (!gr) return null;
        const usada = loc in design.placements;
        const mal = !!excesoGuia(design, loc, guias);
        const col = mal ? '#ef4444' : '#16a34a';
        return (
          <g key={`guia-${loc}`} pointerEvents="none" opacity={usada ? 1 : 0.55}>
            <rect x={gr.x} y={gr.y} width={gr.w} height={gr.h} fill={mal ? 'rgba(239,68,68,0.07)' : 'rgba(22,163,74,0.05)'} stroke={col} strokeWidth={loc === activeLoc ? 1.3 : 0.9} strokeDasharray="2 2" />
            <text x={gr.x + gr.w / 2} y={gr.y + gr.h + (gr.w < 70 ? 8 : 10)} textAnchor="middle" fontSize={gr.w < 70 ? 6 : 8} fill={col} fontFamily="Arial" fontWeight="bold" stroke="#fff" strokeWidth="2" paintOrder="stroke">{gr.ancho}×{gr.alto}"</text>
          </g>
        );
      })}
      {showDims && locsHere.map((loc) => {
        const ls = layers.filter((l) => l.location === loc);
        const u = unionBox(ls);
        if (!u) return null;
        const a = areaOf(design, loc);
        const y = u.y + u.h + 9;
        const x = u.x + u.w + 9;
        const dim = { fontSize: 9, fontFamily: 'Arial', fontWeight: 'bold', fill: '#e11d48', stroke: '#fff', strokeWidth: 2.5, paintOrder: 'stroke' };
        return (
          <g key={`dim${loc}`}>
            <path d={`M${u.x} ${y - 3} v6 M${u.x} ${y} H${u.x + u.w} M${u.x + u.w} ${y - 3} v6`} stroke="#e11d48" strokeWidth="1" fill="none" />
            <text x={u.x + u.w / 2} y={y + 11} textAnchor="middle" {...dim}>{inches(u.w, a).toFixed(1)}"</text>
            <path d={`M${x - 3} ${u.y} h6 M${x} ${u.y} V${u.y + u.h} M${x - 3} ${u.y + u.h} h6`} stroke="#e11d48" strokeWidth="1" fill="none" />
            <text x={x + 4} y={u.y + u.h / 2 + 3} {...dim}>{inches(u.h, a).toFixed(1)}"</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- hoja de prueba (canvas) ----------
async function svgToImage(svgEl) {
  const clone = svgEl.cloneNode(true);
  for (const img of clone.querySelectorAll('image')) {
    const h = img.getAttribute('href');
    if (h && !h.startsWith('data:')) img.setAttribute('href', await toDataUrl(h));
  }
  clone.setAttribute('width', VB_W * 2);
  clone.setAttribute('height', VB_H * 2);
  const s = new XMLSerializer().serializeToString(clone);
  return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s));
}

function wrapText(ctx, text, x, y, maxW, lh) {
  for (const para of String(text).split('\n')) {
    let lineTxt = '';
    for (const word of para.split(' ')) {
      const test = lineTxt ? `${lineTxt} ${word}` : word;
      if (ctx.measureText(test).width > maxW && lineTxt) { ctx.fillText(lineTxt, x, y); y += lh; lineTxt = word; } else lineTxt = test;
    }
    ctx.fillText(lineTxt, x, y);
    y += lh;
  }
  return y;
}

async function buildSheet({ design, job, item, methodName, business, brand, version, svgs }) {
  // Textos en el idioma del cliente (el de la orden o el del cliente)
  const idioma = job.idioma || job.contact?.idioma || 'es';
  const t = textos(idioma);
  const g = GARMENTS[design.garment];
  const views = Object.keys(g.views).filter((v) => design.layers.some((l) => areaOf(design, l.location).view === v));
  const imgs = await Promise.all(views.map((v) => svgToImage(svgs[v])));

  const W = 1800, H = 1200, PAD = 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // encabezado con la marca: logo a la izquierda, datos de la prueba a la derecha, franja con el degradado del logo
  const HEAD = 124;
  const principal = brand?.primary || '#613bbb';
  let textoX = PAD;
  if (brand?.logo) {
    try {
      const logo = await loadImage(brand.logo);
      const k = Math.min(100 / logo.naturalHeight, 260 / logo.naturalWidth);
      ctx.drawImage(logo, PAD, (HEAD - logo.naturalHeight * k) / 2, logo.naturalWidth * k, logo.naturalHeight * k);
      textoX = PAD + logo.naturalWidth * k + 28;
    } catch { /* sin logo si no carga */ }
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1c2033'; ctx.font = 'bold 34px Arial'; ctx.fillText(business, textoX, 62);
  if (design.photo?.style) { ctx.font = '20px Arial'; ctx.fillStyle = '#6b7189'; ctx.fillText(`${t.prenda}: SanMar ${design.photo.style} · ${design.photo.color}`, textoX, 94); }
  ctx.textAlign = 'right'; ctx.fillStyle = principal; ctx.font = 'bold 34px Arial'; ctx.fillText(t.pruebaDeArte, W - PAD, 56);
  ctx.font = '22px Arial'; ctx.fillStyle = '#6b7189';
  ctx.fillText(`${job.order_number || job.number} · ${t.version} ${version} · ${fechaCliente(new Date().toISOString().slice(0, 10), idioma)}`, W - PAD, 92);
  const colores = brand?.gradient?.length ? brand.gradient : [principal, principal];
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  colores.forEach((col, i) => grad.addColorStop(i / (colores.length - 1), col));
  ctx.fillStyle = grad; ctx.fillRect(0, HEAD, W, 8);

  // vistas
  const areaW = 1200, top = 156, viewH = 944;
  ctx.fillStyle = '#f3f4f6';
  ctx.beginPath(); ctx.roundRect(PAD - 10, top - 10, areaW, viewH + 20, 18); ctx.fill();
  const slot = areaW / views.length;
  views.forEach((v, i) => {
    const maxW = slot - 40, maxH = viewH - 60;
    const k = Math.min(maxW / VB_W, maxH / VB_H);
    const w = VB_W * k, h = VB_H * k;
    const x = PAD - 10 + i * slot + (slot - w) / 2;
    ctx.drawImage(imgs[i], x, top, w, h);
    ctx.fillStyle = '#4b5068'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center';
    ctx.fillText((t.vista[v] || g.views[v].label).toUpperCase(), PAD - 10 + i * slot + slot / 2, top + viewH - 4);
  });

  // panel de datos
  let x = 1260, y = 170;
  const maxW = W - x - PAD;
  ctx.textAlign = 'left';
  const block = (title, lines) => {
    ctx.fillStyle = '#8a90a8'; ctx.font = 'bold 17px Arial'; ctx.fillText(title, x, y); y += 30;
    lines.forEach(([txt, bold]) => {
      ctx.fillStyle = '#1c2033'; ctx.font = `${bold ? 'bold ' : ''}23px Arial`;
      y = wrapText(ctx, txt, x, y, maxW, 30);
    });
    y += 16;
  };
  block(t.cliente, [[job.contact?.name || '—', true], ...(job.contact?.company ? [[job.contact.company]] : [])]);
  block(t.trabajo, [[job.title || '—']]);
  block(t.prendaT, [[item?.description || item?.product_name || g.name, true], [`${t.color}: ${design.colorName || '—'}`]]);
  if (item) {
    const sizes = Object.entries(item.sizes || {}).filter(([, n]) => n).map(([s, n]) => `${s}: ${n}`).join('   ');
    block(t.cantidades, [[sizes || `${item.qty} ${t.pzs}`], [`${t.total}: ${item.qty} ${t.piezas}`, true]]);
  }
  const decoLines = [];
  for (const [loc, p] of Object.entries(design.placements)) {
    const ls = design.layers.filter((l) => l.location === loc);
    if (!ls.length) continue;
    const u = unionBox(ls);
    const a = areaOf(design, loc);
    decoLines.push([`${ubicacionCliente(loc, idioma)}`, true]);
    decoLines.push([`${p.method ? procesoCliente(p.method, idioma) : t.decoracionGen} · ${inches(u.w, a).toFixed(1)}" × ${inches(u.h, a).toFixed(1)}"`]);
    if (p.inks) decoLines.push([`${t.colores}: ${p.inks}`]);
  }
  block(t.decoracion, decoLines);
  if (design.note) block(t.notas, [[design.note]]);

  // pie
  ctx.fillStyle = '#6b7189'; ctx.font = '17px Arial';
  wrapText(ctx, t.avisoProof, PAD, H - 50, W - PAD * 2, 24);

  return c.toDataURL('image/png');
}

// ---------- componente principal ----------
export default function ProofDesigner({ job, methods, business, brand, initialDesign, onClose, onSent, notify, sanmarEnabled, guias = [] }) {
  const items = job.items || [];
  const [itemIdx, setItemIdx] = useState(initialDesign?.itemIdx ?? 0);
  const [design, setDesign] = useState(() => initialDesign || designFromItem(items[0]));
  const [activeLoc, setActiveLoc] = useState(() => Object.keys((initialDesign || designFromItem(items[0])).placements)[0]);
  const [view, setView] = useState(() => areaOf(design, activeLoc).view);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const history = useRef([]);
  const drag = useRef(null);
  const svgRef = useRef(null);
  const exportSvgs = useRef({});
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const [sm, setSm] = useState(null); // estilo de SanMar cargado
  const [smState, setSmState] = useState({ loading: false, error: null });
  const [styleInput, setStyleInput] = useState(() => initialDesign?.photo?.style || items[initialDesign?.itemIdx ?? 0]?.product_sku || '');
  const [editArea, setEditArea] = useState(false);

  const item = items[itemIdx];
  const area = areaOf(design, activeLoc);
  const selected = design.layers.find((l) => l.id === selectedId);
  const methodName = useCallback((code) => methods.find((m) => m.code === code)?.name || code, [methods]);
  const views = Object.entries(GARMENTS[design.garment].views);

  // historial para deshacer
  const commit = useCallback((updater) => {
    setDesign((d) => {
      history.current.push(d);
      if (history.current.length > 60) history.current.shift();
      return typeof updater === 'function' ? updater(d) : updater;
    });
  }, []);
  const undo = () => { const prev = history.current.pop(); if (prev) setDesign(prev); };
  const patchLayer = (id, patch, record = true) => {
    const fn = (d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
    record ? commit(fn) : setDesign(fn);
  };

  function selectLoc(loc) {
    setActiveLoc(loc);
    setView(areaOf(design, loc).view);
  }
  function switchView(v) {
    setView(v);
    const here = Object.keys(design.placements).find((loc) => areaOf(design, loc).view === v);
    if (here) { setActiveLoc(here); return; }
    const loc = locationsFor(design.garment).find((l) => areaOf(design, l).view === v);
    if (loc) {
      commit((d) => ({ ...d, placements: { ...d.placements, [loc]: { method: Object.values(d.placements)[0]?.method || '', inks: '' } } }));
      setActiveLoc(loc);
    }
  }
  function addPlacement(loc) {
    if (!loc) return;
    commit((d) => ({ ...d, placements: { ...d.placements, [loc]: { method: Object.values(d.placements)[0]?.method || methods[0]?.code || '', inks: '' } } }));
    selectLoc(loc);
  }
  function removePlacement(loc) {
    if (Object.keys(design.placements).length === 1) return;
    commit((d) => {
      const placements = { ...d.placements };
      delete placements[loc];
      return { ...d, placements, layers: d.layers.filter((l) => l.location !== loc) };
    });
    const next = Object.keys(design.placements).find((l) => l !== loc);
    selectLoc(next);
  }
  function changeItem(idx) {
    if (design.layers.length && !confirm('Cambiar de producto reinicia el diseño. ¿Continuar?')) return;
    const d = designFromItem(items[idx]);
    setItemIdx(idx);
    commit(d);
    const loc = Object.keys(d.placements)[0];
    setActiveLoc(loc);
    setView(areaFor(d.garment, loc).view);
    setSelectedId(null);
  }

  // capas
  async function addImage(file) {
    if (!file) return;
    try {
      const { src, w, h } = await normalizeImage(await fileToDataUrl(file));
      const k = 100 / Math.max(w, h);
      const baseW = w * k, baseH = h * k;
      const scale = Math.min((area.w * 0.85) / baseW, (area.h * 0.85) / baseH);
      const layer = { id: uid(), type: 'image', location: activeLoc, src, orig: src, baseW, baseH, scale, rot: 0, cx: area.x + area.w / 2, cy: area.y + area.h / 2 };
      commit((d) => ({ ...d, layers: [...d.layers, layer] }));
      setSelectedId(layer.id);
    } catch (e) { notify(e.message, true); }
  }
  function addText() {
    const text = 'TU TEXTO';
    const font = 'Arial Black';
    const baseW = measureText(text, font, 'normal');
    const layer = {
      id: uid(), type: 'text', location: activeLoc, text, font, weight: 'normal', fill: isDark(design.color) ? '#ffffff' : '#111111',
      stroke: '#000000', strokeW: 0, baseW, baseH: BASE_FONT * 1.2, scale: Math.min((area.w * 0.8) / baseW, 1.2), rot: 0,
      cx: area.x + area.w / 2, cy: area.y + area.h * 0.35,
    };
    commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelectedId(layer.id);
  }
  function updateText(patch) {
    const next = { ...selected, ...patch };
    patchLayer(selected.id, { ...patch, baseW: measureText(next.text, next.font, next.weight) });
  }
  const removeLayer = (id) => { commit((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) })); setSelectedId(null); };
  const duplicateLayer = (l) => {
    const copy = { ...l, id: uid(), cx: l.cx + 8, cy: l.cy + 8 };
    commit((d) => ({ ...d, layers: [...d.layers, copy] }));
    setSelectedId(copy.id);
  };
  const reorder = (id, dir) => commit((d) => {
    const ls = [...d.layers];
    const i = ls.findIndex((l) => l.id === id);
    const j = dir > 0 ? ls.length - 1 : 0;
    const [l] = ls.splice(i, 1);
    ls.splice(j, 0, l);
    return { ...d, layers: ls };
  });

  // ---------- fotos de la prenda (SanMar o propias) ----------
  const photoFor = (v) => design.photo?.views?.[v] || null;

  async function loadSanmar(style, preferColor, { apply = true, refresh = false } = {}) {
    if (!style) return;
    setSmState({ loading: true, error: null });
    try {
      const data = await api.get(`/sanmar/style/${encodeURIComponent(style.trim())}${refresh ? '?refresh=1' : ''}`);
      setSm(data);
      setStyleInput(data.estilo);
      setSmState({ loading: false, error: null });
      if (apply) {
        const want = String(preferColor || '').toLowerCase().trim();
        const color = data.colores.find((c) => c.nombre.toLowerCase() === want || String(c.codigo).toLowerCase() === want)
          || data.colores.find((c) => want && (c.nombre.toLowerCase().includes(want) || want.includes(c.nombre.toLowerCase())))
          || data.colores[0];
        if (color) applyColor(color, design.photo?.kind || 'flat', data);
      }
    } catch (e) {
      setSmState({ loading: false, error: e.message });
    }
  }
  function applyColor(color, kind, data = sm) {
    const views = viewsFromColor(color, kind);
    if (!Object.keys(views).length) { notify(`SanMar no tiene fotos para ${color.nombre}`, true); return; }
    const calibrated = data?.areas?.[kind];
    commit((d) => ({
      ...d, colorName: color.nombre, color: colorHex(color.nombre),
      photo: { source: 'sanmar', style: data.estilo, color: color.nombre, kind, views },
      areas: calibrated || (d.photo?.style === data.estilo && d.photo?.kind === kind ? d.areas : undefined),
    }));
  }
  function setPhotoKind(kind) {
    const c = sm?.colores.find((x) => x.nombre === design.photo?.color);
    if (c) applyColor(c, kind);
  }
  async function uploadOwnPhoto(file) {
    if (!file) return;
    const { src } = await normalizeImage(await fileToDataUrl(file));
    commit((d) => ({ ...d, photo: { source: d.photo?.source || 'propia', style: d.photo?.style, color: d.photo?.color || d.colorName, kind: d.photo?.kind || 'flat', views: { ...(d.photo?.views || {}), [view]: src } } }));
  }
  function togglePhotoMode(on) {
    if (!on) { commit((d) => ({ ...d, photo: null, areas: undefined })); setEditArea(false); return; }
    if (sm) { const c = sm.colores.find((x) => x.nombre === design.colorName) || sm.colores[0]; applyColor(c, 'flat'); }
    else if (styleInput) loadSanmar(styleInput, design.colorName);
  }
  async function saveAreas() {
    const all = Object.fromEntries(Object.keys(design.placements).map((loc) => [loc, areaOf(design, loc)]));
    const merged = { ...(sm?.areas?.[design.photo.kind] || {}), ...design.areas, ...all };
    try {
      await api.put(`/sanmar/areas/${encodeURIComponent(design.photo.style)}/${design.photo.kind}`, merged);
      setSm((x) => x && { ...x, areas: { ...x.areas, [design.photo.kind]: merged } });
      notify(`Áreas guardadas para ${design.photo.style}: se usarán en las próximas pruebas`);
    } catch (e) { notify(e.message, true); }
  }
  const setArea = (loc, patch, record = true) => {
    const fn = (d) => ({ ...d, areas: { ...(d.areas || {}), [loc]: { ...areaOf(d, loc), ...patch } } });
    record ? commit(fn) : setDesign(fn);
  };
  function resetArea(loc) {
    commit((d) => { const areas = { ...(d.areas || {}) }; delete areas[loc]; return { ...d, areas }; });
  }

  // al abrir: si el producto es de SanMar, carga la foto real automáticamente
  useEffect(() => {
    if (!sanmarEnabled) return;
    if (design.photo?.source === 'sanmar' && design.photo.style) { loadSanmar(design.photo.style, design.photo.color, { apply: false }); return; }
    if (!design.photo && item?.product_sku && /sanmar/i.test(item.product_supplier || '')) loadSanmar(item.product_sku, item.color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIdx]);

  // arrastre
  const toSvg = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  function onLayerDown(e, layer, mode) {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(layer.id);
    if (layer.location !== activeLoc) setActiveLoc(layer.location);
    history.current.push(design);
    drag.current = { id: layer.id, mode, p0: toSvg(e), l0: { ...layer } };
  }
  function onAreaDown(e, loc, mode) {
    e.stopPropagation();
    e.preventDefault();
    history.current.push(design);
    drag.current = { area: true, loc, mode, p0: toSvg(e), a0: { ...areaOf(design, loc) } };
  }
  useEffect(() => {
    const move = (e) => {
      const dr = drag.current;
      if (!dr) return;
      const p = toSvg(e);
      if (dr.area) {
        const { a0, p0: q } = dr;
        const dx = p.x - q.x, dy = p.y - q.y;
        setArea(dr.loc, dr.mode === 'move' ? { x: a0.x + dx, y: a0.y + dy } : { w: Math.max(12, a0.w + dx), h: Math.max(12, a0.h + dy) }, false);
        return;
      }
      const { l0, p0 } = dr;
      const a = areaOf(design, l0.location);
      if (dr.mode === 'move') {
        let cx = l0.cx + p.x - p0.x;
        const cy = l0.cy + p.y - p0.y;
        if (Math.abs(cx - (a.x + a.w / 2)) < 3) cx = a.x + a.w / 2; // imán al centro
        patchLayer(dr.id, { cx, cy }, false);
      } else if (dr.mode === 'resize') {
        const d0 = Math.hypot(p0.x - l0.cx, p0.y - l0.cy);
        const d1 = Math.hypot(p.x - l0.cx, p.y - l0.cy);
        patchLayer(dr.id, { scale: Math.max(0.03, (l0.scale * d1) / Math.max(d0, 1)) }, false);
      } else if (dr.mode === 'rotate') {
        let rot = (Math.atan2(p.y - l0.cy, p.x - l0.cx) * 180) / Math.PI + 90;
        if (rot > 180) rot -= 360;
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        else for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(rot - s) < 4) rot = s;
        patchLayer(dr.id, { rot: Math.round(rot) }, false);
      }
    };
    const up = () => { drag.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  });

  // teclado
  useEffect(() => {
    const key = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'Escape') { if (preview) setPreview(null); else if (selectedId) setSelectedId(null); else onClose(); return; }
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(selected.id); }
      const step = e.shiftKey ? 10 : 1;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key]) { e.preventDefault(); patchLayer(selected.id, { cx: selected.cx + arrows[e.key][0], cy: selected.cy + arrows[e.key][1] }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // exportar
  const version = (job.proofs?.reduce((m, p) => Math.max(m, p.version), 0) || 0) + 1;
  async function makeSheet() {
    if (!design.layers.length) { notify('Agrega al menos un logo o texto', true); return null; }
    setSelectedId(null);
    return buildSheet({ design, job, item, methodName, business, brand, version, svgs: exportSvgs.current });
  }
  async function openPreview() {
    const pasados = Object.keys(design.placements).map((loc) => excesoGuia(design, loc, guias)).filter(Boolean);
    if (pasados.length && !confirm(`El diseño se sale de la medida estándar:\n${pasados.map((p) => `· ${p.ubicacion}: ${p.ancho.toFixed(1)}" × ${p.alto.toFixed(1)}" (máximo ${p.guia.ancho}" × ${p.guia.alto}")`).join('\n')}\n\n¿Continuar de todos modos?`)) return;
    setBusy(true);
    try { const png = await makeSheet(); if (png) setPreview(png); } catch (e) { notify(e.message, true); }
    setBusy(false);
  }
  async function send() {
    setBusy(true);
    try {
      const j = await api.post(`/jobs/${job.id}/proofs`, {
        file: preview, filename: `prueba-${job.order_number || job.number}-v${version}.png`, note: design.note, design: { ...design, itemIdx },
      });
      notify(`Prueba v${version} enviada al cliente`);
      onSent(j);
    } catch (e) { notify(e.message, true); }
    setBusy(false);
  }

  const outOfArea = design.layers.filter((l) => outside(layerBox(l), areaOf(design, l.location)));
  const fueraDeMedida = Object.keys(design.placements).map((loc) => excesoGuia(design, loc, guias)).filter(Boolean);
  const usedLocs = Object.keys(design.placements);
  const freeLocs = locationsFor(design.garment).filter((l) => !usedLocs.includes(l));
  const pxPerIn = area.w / area.inW;

  return (
    <div className="designer" role="dialog" aria-label="Decorador de pruebas">
      <header className="designer-head">
        <div>
          <strong>Decorador · {job.order_number || job.number}</strong>
          <span className="muted"> · Prueba v{version}</span>
        </div>
        <div className="row gap">
          <button className="btn" onClick={undo} disabled={!history.current.length} title="Ctrl+Z">↶ Deshacer</button>
          <button className="btn" onClick={onClose}>Cerrar</button>
          <button className="btn primary" onClick={openPreview} disabled={busy}>{busy ? 'Generando…' : 'Revisar y enviar →'}</button>
        </div>
      </header>

      <aside className="designer-left">
        {items.length > 1 && (
          <label className="field"><span>Producto de la orden</span>
            <select value={itemIdx} onChange={(e) => changeItem(Number(e.target.value))}>
              {items.map((it, i) => <option key={it.id ?? i} value={i}>{i + 1}. {it.description || it.product_name} {it.color && `· ${it.color}`}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Tipo de prenda</span>
          <select value={design.garment} onChange={(e) => {
            const garment = e.target.value;
            const loc = DEFAULT_LOCATION[garment];
            commit((d) => ({ ...d, garment, areas: undefined, placements: { [loc]: Object.values(d.placements)[0] || { method: '', inks: '' } }, layers: d.layers.map((l) => ({ ...l, location: loc })) }));
            setActiveLoc(loc); setView(areaFor(garment, loc).view);
          }}>
            {Object.entries(GARMENTS).map(([k, g]) => <option key={k} value={k}>{g.name}</option>)}
          </select>
        </label>
        <div className="field"><span>Imagen de la prenda</span>
          <div className="seg">
            <button className={!design.photo ? 'on' : ''} onClick={() => togglePhotoMode(false)}>Silueta</button>
            <button className={design.photo ? 'on' : ''} onClick={() => togglePhotoMode(true)}>Foto real</button>
          </div>
        </div>
        {(design.photo || smState.loading || smState.error) && (
          <div className="loc-settings">
            <label className="field"><span>Estilo SanMar</span>
              <form className="row gap" onSubmit={(e) => { e.preventDefault(); loadSanmar(styleInput, design.colorName); }}>
                <input value={styleInput} onChange={(e) => setStyleInput(e.target.value.toUpperCase())} placeholder="Ej. PC54, K500" />
                <button className="btn" disabled={!sanmarEnabled || smState.loading}>{smState.loading ? '…' : 'Cargar'}</button>
              </form>
            </label>
            {!sanmarEnabled && <p className="muted small">SanMar no está conectado en el servidor (ver README). Puedes subir tu propia foto abajo.</p>}
            {smState.error && <p className="danger small">{smState.error}</p>}
            {sm && (
              <>
                <div className="muted small">{sm.marca} {sm.estilo} · {sm.titulo}</div>
                <div className="sm-colors">
                  {sm.colores.map((c) => (
                    <button key={c.codigo || c.nombre} title={c.nombre} className={`sm-color ${design.photo?.color === c.nombre ? 'on' : ''}`} onClick={() => applyColor(c, design.photo?.kind || 'flat')}>
                      {c.swatch ? <img src={proxied(c.swatch)} alt="" /> : <span style={{ background: colorHex(c.nombre) }} />}
                    </button>
                  ))}
                </div>
                <div className="muted small">Color: <strong>{design.photo?.color || '—'}</strong></div>
                <div className="seg">
                  <button className={design.photo?.kind !== 'model' ? 'on' : ''} onClick={() => setPhotoKind('flat')}>Plana</button>
                  <button className={design.photo?.kind === 'model' ? 'on' : ''} onClick={() => setPhotoKind('model')}>Con modelo</button>
                </div>
                <button className="link-btn small" onClick={() => loadSanmar(sm.estilo, design.photo?.color, { refresh: true })}>↻ Actualizar desde SanMar</button>
              </>
            )}
            <button className="link-btn small" onClick={() => photoRef.current.click()}>Usar mi propia foto para «{GARMENTS[design.garment].views[view]?.label}»</button>
            <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { uploadOwnPhoto(e.target.files[0]); e.target.value = ''; }} />
          </div>
        )}
        {!design.photo && <div className="field"><span>Color de la prenda</span>
          <div className="swatches">
            {SWATCHES.map((c) => <button key={c} className={`swatch ${design.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => commit((d) => ({ ...d, color: c }))} aria-label={c} />)}
            <input type="color" value={design.color} onChange={(e) => setDesign((d) => ({ ...d, color: e.target.value }))} title="Otro color" />
          </div>
          <input value={design.colorName} placeholder="Nombre del color (ej. Navy)" onChange={(e) => setDesign((d) => ({ ...d, colorName: e.target.value }))} />
        </div>}

        <div className="field"><span>Ubicaciones</span>
          <div className="loc-list">
            {usedLocs.map((loc) => {
              const n = design.layers.filter((l) => l.location === loc).length;
              return (
                <div key={loc} className={`loc ${loc === activeLoc ? 'on' : ''}`} onClick={() => selectLoc(loc)}>
                  <div className="row between"><strong>{loc}</strong><span className="muted small">{n} elem.</span></div>
                  <div className="muted small">{methodName(design.placements[loc].method) || 'Sin método'}</div>
                </div>
              );
            })}
          </div>
          {freeLocs.length > 0 && (
            <select value="" onChange={(e) => addPlacement(e.target.value)}>
              <option value="">+ Agregar ubicación…</option>
              {freeLocs.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>

        <div className="loc-settings">
          <label className="field"><span>Método en «{activeLoc}»</span>
            <select value={design.placements[activeLoc]?.method || ''} onChange={(e) => commit((d) => ({ ...d, placements: { ...d.placements, [activeLoc]: { ...d.placements[activeLoc], method: e.target.value } } }))}>
              <option value="">—</option>
              {methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Colores de tinta / hilo</span>
            <input value={design.placements[activeLoc]?.inks || ''} placeholder="Ej. Blanco, Rojo PMS 186"
              onChange={(e) => setDesign((d) => ({ ...d, placements: { ...d.placements, [activeLoc]: { ...d.placements[activeLoc], inks: e.target.value } } }))} />
          </label>
          {usedLocs.length > 1 && <button className="link-btn danger" onClick={() => removePlacement(activeLoc)}>Quitar ubicación</button>}
        </div>

        <div className="field"><span>Elementos en «{activeLoc}»</span>
          <ul className="layer-list">
            {design.layers.filter((l) => l.location === activeLoc).slice().reverse().map((l) => (
              <li key={l.id} className={l.id === selectedId ? 'on' : ''} onClick={() => setSelectedId(l.id)}>
                {l.type === 'image' ? <img src={l.src} alt="" /> : <span className="t-icon">T</span>}
                <span className="grow ellipsis">{l.type === 'image' ? 'Logo / imagen' : l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="designer-canvas">
        <div className="row between wrap gap">
          <div className="tabs">
            {views.map(([k, v]) => <button key={k} className={view === k ? 'active' : ''} onClick={() => switchView(k)}>{v.label}</button>)}
          </div>
          <div className="row gap">
            <button className="btn" onClick={() => fileRef.current.click()}>⬆ Subir logo</button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden onChange={(e) => { addImage(e.target.files[0]); e.target.value = ''; }} />
            <button className="btn" onClick={addText}>T Agregar texto</button>
            <button className={`btn ${editArea ? 'primary' : ''}`} onClick={() => { setEditArea(!editArea); setSelectedId(null); }} title="Mover y ajustar el área de impresión sobre la foto">📐 {editArea ? 'Listo' : 'Ajustar área'}</button>
          </div>
        </div>
        <div className="stage"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addImage(e.dataTransfer.files[0]); }}>
          <GarmentView garment={design.garment} color={design.color} view={view} design={design} activeLoc={activeLoc}
            selectedId={selectedId} interactive showDims svgRef={svgRef} onLayerDown={onLayerDown} onBackground={() => setSelectedId(null)}
            photo={photoFor(view)} editArea={editArea} onAreaDown={onAreaDown} guias={guias} />
          {smState.loading && <div className="stage-hint">Cargando foto de SanMar…</div>}
          {!design.layers.length && <div className="stage-hint">Arrastra aquí el logo del cliente o usa «Subir logo»</div>}
        </div>
        {fueraDeMedida.map((p) => (
          <p key={p.ubicacion} className="alerta-medida">⚠ <strong>{p.ubicacion}:</strong> el diseño mide {p.ancho.toFixed(1)}" × {p.alto.toFixed(1)}" y la medida estándar es {p.guia.ancho}" × {p.guia.alto}". Reduce el diseño para que quepa en la guía.</p>
        ))}
        {outOfArea.length > 0 && <p className="danger small">⚠ {outOfArea.length} elemento(s) se salen del área de impresión (contorno rojo).</p>}
        <p className="muted small">Arrastra para mover · cuadro azul para cambiar tamaño · círculo para girar (Shift = pasos de 15°) · flechas para ajustar · Supr para borrar · Ctrl+Z deshacer</p>
      </main>

      <aside className="designer-right">
        {editArea && (
          <div className="stack-sm area-editor">
            <h3>Área de impresión · {activeLoc}</h3>
            <p className="muted small">Arrastra el recuadro morado para colocarlo sobre la prenda y usa la esquina para cambiar su tamaño. El recuadro debe representar el ancho real indicado.</p>
            <label className="field"><span>Ancho real del área (pulg.)</span>
              <input type="number" step="0.5" min="1" value={area.inW} onChange={(e) => setArea(activeLoc, { inW: Number(e.target.value) || area.inW })} />
            </label>
            <div className="row gap wrap">
              <button className="btn" onClick={() => resetArea(activeLoc)}>Restablecer</button>
              {design.photo?.style && <button className="btn primary" onClick={saveAreas}>Guardar para {design.photo.style}</button>}
            </div>
            {design.photo?.style && <p className="muted small">Al guardar, todas las pruebas futuras de {design.photo.style} ({design.photo.kind === 'model' ? 'con modelo' : 'plana'}) usarán estas áreas.</p>}
            <hr />
          </div>
        )}
        {!selected && !editArea && <p className="muted">Selecciona un elemento para editarlo, o agrega un logo o texto.</p>}
        {selected && (
          <div className="stack-sm">
            <h3>{selected.type === 'image' ? 'Logo / imagen' : 'Texto'}</h3>
            {selected.type === 'text' && (
              <>
                <label className="field"><span>Texto</span><input value={selected.text} onChange={(e) => updateText({ text: e.target.value })} /></label>
                <label className="field"><span>Fuente</span>
                  <select value={selected.font} onChange={(e) => updateText({ font: e.target.value })}>
                    {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                  </select>
                </label>
                <label className="inline"><input type="checkbox" checked={selected.weight === 'bold'} onChange={(e) => updateText({ weight: e.target.checked ? 'bold' : 'normal' })} /> Negrita</label>
                <div className="row gap">
                  <label className="field"><span>Color</span><input type="color" value={selected.fill} onChange={(e) => patchLayer(selected.id, { fill: e.target.value }, false)} /></label>
                  <label className="field"><span>Contorno</span><input type="color" value={selected.stroke} onChange={(e) => patchLayer(selected.id, { stroke: e.target.value }, false)} /></label>
                  <label className="field"><span>Grosor</span><input type="number" min="0" max="8" className="mini" value={selected.strokeW} onChange={(e) => patchLayer(selected.id, { strokeW: Number(e.target.value) })} /></label>
                </div>
              </>
            )}
            {selected.type === 'image' && (
              <div className="row gap wrap">
                <button className="btn" onClick={async () => patchLayer(selected.id, { src: await removeWhite(selected.src) })}>Quitar fondo blanco</button>
                {selected.src !== selected.orig && <button className="link-btn" onClick={() => patchLayer(selected.id, { src: selected.orig })}>Restaurar</button>}
              </div>
            )}
            <div className="row gap">
              <label className="field"><span>Ancho (pulg.)</span>
                <input type="number" step="0.1" min="0.2" className="mini" value={((selected.baseW * selected.scale) / pxPerIn).toFixed(1)}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) patchLayer(selected.id, { scale: (v * pxPerIn) / selected.baseW }); }} />
              </label>
              <label className="field"><span>Alto (pulg.)</span>
                <input type="number" step="0.1" min="0.2" className="mini" value={((selected.baseH * selected.scale) / pxPerIn).toFixed(1)}
                  onChange={(e) => { const v = Number(e.target.value); if (v > 0) patchLayer(selected.id, { scale: (v * pxPerIn) / selected.baseH }); }} />
              </label>
            </div>
            <label className="field"><span>Rotación: {selected.rot}°</span>
              <input type="range" min="-180" max="180" value={selected.rot} onChange={(e) => patchLayer(selected.id, { rot: Number(e.target.value) }, false)} />
            </label>
            <div className="btn-grid">
              <button className="btn" onClick={() => patchLayer(selected.id, { cx: area.x + area.w / 2 })}>↔ Centrar</button>
              <button className="btn" onClick={() => patchLayer(selected.id, { cx: area.x + area.w / 2, cy: area.y + area.h / 2 })}>⊕ Centrar en área</button>
              <button className="btn" onClick={() => patchLayer(selected.id, { cy: area.y + (selected.baseH * selected.scale) / 2 + 2 })}>⤒ Arriba del área</button>
              <button className="btn" onClick={() => patchLayer(selected.id, { scale: Math.min((area.w * 0.98) / selected.baseW, (area.h * 0.98) / selected.baseH), cx: area.x + area.w / 2, cy: area.y + area.h / 2, rot: 0 })}>⤢ Ajustar al área</button>
              <button className="btn" onClick={() => reorder(selected.id, 1)}>Traer al frente</button>
              <button className="btn" onClick={() => reorder(selected.id, -1)}>Enviar atrás</button>
              <button className="btn" onClick={() => duplicateLayer(selected)}>⧉ Duplicar</button>
              <button className="btn danger-ghost" onClick={() => removeLayer(selected.id)}>🗑 Eliminar</button>
            </div>
          </div>
        )}
        <hr />
        <label className="field"><span>Nota para el cliente</span>
          <textarea rows={3} value={design.note} onChange={(e) => setDesign((d) => ({ ...d, note: e.target.value }))} placeholder="Ej. Ajustamos el logo a 1 color para serigrafía." />
        </label>
      </aside>

      {/* vistas ocultas para exportar la hoja de prueba */}
      <div className="export-hidden" aria-hidden="true">
        {views.map(([k]) => (
          <GarmentView key={k} garment={design.garment} color={design.color} view={k} design={design} showDims
            svgRef={(el) => { exportSvgs.current[k] = el; }} photo={photoFor(k)} />
        ))}
      </div>

      {preview && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal wide preview-modal">
            <div className="modal-head"><h2>Vista previa · Prueba v{version}</h2><button className="icon-btn" onClick={() => setPreview(null)}>×</button></div>
            <img src={preview} alt="Hoja de prueba" className="sheet-preview" />
            <p className="muted small">Al enviar, la prueba se guarda en la orden, la orden pasa a «Esperando aprobación» y el cliente recibe el enlace para aprobarla o pedir cambios.</p>
            <div className="row between">
              <a className="btn" href={preview} download={`prueba-${job.order_number || job.number}-v${version}.png`}>⬇ Descargar PNG</a>
              <div className="row gap">
                <button className="btn" onClick={() => setPreview(null)}>Seguir editando</button>
                <button className="btn primary" onClick={send} disabled={busy}>{busy ? 'Enviando…' : 'Enviar prueba al cliente'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
