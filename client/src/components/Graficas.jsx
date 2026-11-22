// Gráficas del tablero: barras mensuales (ventas y utilidad bruta) y dona de contribución.
// Una sola escala en dólares (el margen % va en el tooltip y en la tabla, no en un segundo eje).
import React, { useEffect, useRef, useState } from 'react';
import { money } from '../utils.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const nombreMes = (ym) => MESES[Number(ym.slice(5, 7)) - 1];
const corto = (v) => (v >= 1000 ? `$${Math.round(v / 100) / 10}k`.replace('.0k', 'k') : `$${Math.round(v)}`);

function escala(max) {
  if (max <= 0) return { tope: 1000, paso: 250 };
  const crudo = max / 4;
  const p = 10 ** Math.floor(Math.log10(crudo));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= crudo);
  return { tope: paso * Math.ceil(max / paso), paso };
}

function useAncho() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Barra con esquinas de 4px solo arriba (anclada a la base). */
const barra = (x, y, w, h) => {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x} ${y + h} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h} Z`;
};

export function BarrasMensuales({ datos, conUtilidad }) {
  const [ref, ancho] = useAncho();
  const [hover, setHover] = useState(null);
  const alto = 230;
  const m = { izq: 48, der: 8, arriba: 10, abajo: 26 };
  const series = [{ k: 'ventas', nombre: 'Ventas', clase: 'serie-ventas' }, ...(conUtilidad ? [{ k: 'utilidad', nombre: 'Utilidad bruta', clase: 'serie-utilidad' }] : [])];
  const max = Math.max(0, ...datos.flatMap((d) => series.map((s) => d[s.k] || 0)));
  const { tope, paso } = escala(max);
  const anchoPlot = ancho - m.izq - m.der;
  const altoPlot = alto - m.arriba - m.abajo;
  const banda = anchoPlot / datos.length;
  const barW = Math.min(28, (banda * 0.62 - 2 * (series.length - 1)) / series.length);
  const grupoW = barW * series.length + 2 * (series.length - 1);
  const y = (v) => m.arriba + altoPlot - (v / tope) * altoPlot;
  const ticks = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);

  return (
    <div className="grafica" ref={ref}>
      <svg width={ancho} height={alto} role="img" aria-label={`Ventas${conUtilidad ? ' y utilidad bruta' : ''} por mes`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.izq} x2={ancho - m.der} y1={y(t)} y2={y(t)} className="grid-linea" />
            <text x={m.izq - 8} y={y(t) + 4} textAnchor="end" className="eje-txt">{corto(t)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const x0 = m.izq + banda * i + (banda - grupoW) / 2;
          return (
            <g key={d.mes}>
              {series.map((s, j) => {
                const v = d[s.k] || 0;
                return <path key={s.k} d={barra(x0 + j * (barW + 2), y(v), barW, y(0) - y(v))} className={s.clase} opacity={hover == null || hover === i ? 1 : 0.45} />;
              })}
              <text x={m.izq + banda * i + banda / 2} y={alto - 8} textAnchor="middle" className="eje-txt">{nombreMes(d.mes)}</text>
              {/* zona de hover más grande que la barra */}
              <rect x={m.izq + banda * i} y={m.arriba} width={banda} height={altoPlot} fill="transparent"
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {hover != null && (() => {
        const d = datos[hover];
        const izq = Math.min(Math.max(m.izq + banda * hover + banda / 2, 120), ancho - 120);
        return (
          <div className="tooltip-graf" style={{ left: izq }}>
            <strong>{nombreMes(d.mes)} {d.mes.slice(0, 4)}</strong>
            <div><span className="punto serie-ventas-bg" /> Ventas <b>{money(d.ventas)}</b></div>
            {conUtilidad && <div><span className="punto serie-utilidad-bg" /> Utilidad bruta <b>{money(d.utilidad)}</b></div>}
            {conUtilidad && <div className="muted">Margen bruto {d.margenPct == null ? '—' : `${d.margenPct}%`}</div>}
            <div className="muted">{d.n} trabajo(s){d.incompletas ? ` · ${d.incompletas} con costos incompletos` : ''}</div>
          </div>
        );
      })()}
      {series.length > 1 && (
        <div className="leyenda">{series.map((s) => <span key={s.k}><span className={`punto ${s.clase}-bg`} />{s.nombre}</span>)}</div>
      )}
    </div>
  );
}

export function TablaMensual({ datos, conUtilidad }) {
  return (
    <table className="table mini-table">
      <thead><tr><th>Mes</th><th className="num">Ventas</th>{conUtilidad && <><th className="num">Utilidad bruta</th><th className="num">Margen</th></>}<th className="num">Trabajos</th></tr></thead>
      <tbody>{datos.map((d) => (
        <tr key={d.mes}><td>{nombreMes(d.mes)} {d.mes.slice(0, 4)}</td><td className="num">{money(d.ventas)}</td>
          {conUtilidad && <><td className="num">{money(d.utilidad)}</td><td className="num">{d.margenPct == null ? '—' : `${d.margenPct}%`}</td></>}
          <td className="num">{d.n}</td></tr>
      ))}</tbody>
    </table>
  );
}

/** Dona de contribución: estado con color + texto (nunca solo color). */
export function DonaContribucion({ pct, margen }) {
  const objetivo = margen.objetivo * 100, minimo = margen.minimo * 100;
  const estado = pct == null ? 'sin' : pct >= objetivo ? 'ok' : pct >= minimo ? 'medio' : 'bajo';
  const texto = { sin: 'Sin datos completos', ok: 'En meta', medio: 'Entre mínimo y meta', bajo: 'Bajo el mínimo' }[estado];
  const R = 46, C = 2 * Math.PI * R;
  const lleno = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
  return (
    <div className="dona">
      <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={`Contribución ${pct ?? '—'}%: ${texto}`}>
        <circle cx="60" cy="60" r={R} className="dona-pista" />
        <circle cx="60" cy="60" r={R} className={`dona-valor estado-${estado}`} strokeDasharray={`${C * lleno} ${C}`} transform="rotate(-90 60 60)" />
        <text x="60" y="66" textAnchor="middle" className="dona-num">{pct == null ? '—' : `${pct}%`}</text>
      </svg>
      <div className={`dona-estado estado-${estado}-txt`}>{texto}</div>
      <div className="muted small">Meta {Math.round(objetivo)}% · mínimo {Math.round(minimo)}%</div>
    </div>
  );
}
