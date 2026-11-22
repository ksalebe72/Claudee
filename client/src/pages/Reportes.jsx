import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money, fmtDate, useLoad } from '../utils.js';
import { Empty, PageHeader } from '../components/ui.jsx';
import { Semaforo } from '../components/FinancePanels.jsx';
import { PROCESOS } from '../../../shared/pricing.js';

const TABS = { orden: 'Por orden', cliente: 'Por cliente', proceso: 'Por proceso', vendedor: 'Por vendedor', bajo: 'Bajo el mínimo', comisiones: 'Comisiones' };
const NOMBRE_PROCESO = { ...PROCESOS, prendas: 'Prendas', servicios: 'Servicios / Diseño' };
const inicioAnio = `${new Date().getFullYear()}-01-01`;
const hoy = new Date().toISOString().slice(0, 10);

export default function Reportes() {
  const [tab, setTab] = useState('orden');
  const [desde, setDesde] = useState(inicioAnio);
  const [hasta, setHasta] = useState(hoy);
  const q = `desde=${desde}&hasta=${hasta}`;
  const url = tab === 'bajo' ? `/reportes/bajo-margen?${q}` : tab === 'comisiones' ? `/reportes/comisiones?${q}` : `/reportes/rentabilidad?agrupar=${tab}&${q}`;
  const [data] = useLoad(() => api.get(url), [url]);

  return (
    <>
      <PageHeader title="Reportes" subtitle="Rentabilidad por fecha de factura. Las órdenes incompletas se cuentan aparte y no se suman como $0.">
        <label className="inline">Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="inline">Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
      </PageHeader>
      <div className="tabs big">{Object.entries(TABS).map(([k, v]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{v}</button>)}</div>
      {!data && <div className="loading">Cargando…</div>}
      {data && tab === 'comisiones' && <TablaComisiones filas={data} />}
      {data && (tab === 'orden' || tab === 'bajo') && <TablaOrdenes filas={data.filas} minimo={data.minimo} />}
      {data && ['cliente', 'proceso', 'vendedor'].includes(tab) && <TablaGrupos filas={data.filas} proceso={tab === 'proceso'} />}
    </>
  );
}

function TablaOrdenes({ filas, minimo }) {
  if (!filas.length) return <Empty>{minimo != null ? `Ninguna orden bajo el ${minimo}% de contribución en estas fechas.` : 'No hay órdenes en estas fechas.'}</Empty>;
  const completas = filas.filter((f) => !f.incompleta);
  const tot = (k) => completas.reduce((a, f) => a + (f[k] || 0), 0);
  return (
    <div className="card no-pad">
      <table className="table">
        <thead><tr><th>Orden</th><th>Cliente</th><th>Vendedor</th><th>Factura</th><th className="num">Ingreso s/imp.</th><th className="num">Costo</th><th className="num">Ganancia bruta</th><th className="num">Comisión</th><th className="num">Contribución</th><th>%</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td><Link to={`/trabajos/${f.id}`}>{f.orden}</Link></td><td>{f.cliente}</td><td>{f.vendedor}</td><td>{fmtDate(f.fecha)}</td>
              <td className="num">{money(f.ingreso)}</td><td className="num">{f.costo == null ? <span className="warn-txt">incompleto</span> : money(f.costo)}</td>
              <td className="num">{f.gananciaBruta == null ? '—' : money(f.gananciaBruta)}</td><td className="num">{f.comision == null ? '—' : money(f.comision)}</td>
              <td className="num">{f.contribucion == null ? '—' : money(f.contribucion)}</td>
              <td><Semaforo fin={{ semaforo: f.semaforo, contribucionPct: f.contribucionPct }} small /></td>
            </tr>
          ))}
          <tr className="total-row"><td colSpan={4}>Total ({completas.length} completas{filas.length - completas.length ? `, ${filas.length - completas.length} incompletas fuera de la suma` : ''})</td>
            <td className="num">{money(tot('ingreso'))}</td><td className="num">{money(tot('costo'))}</td><td className="num">{money(tot('gananciaBruta'))}</td><td className="num">{money(tot('comision'))}</td><td className="num">{money(tot('contribucion'))}</td>
            <td>{tot('ingreso') ? `${Math.round((tot('contribucion') / tot('ingreso')) * 1000) / 10}%` : ''}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function TablaGrupos({ filas, proceso }) {
  if (!filas.length) return <Empty>No hay datos en estas fechas.</Empty>;
  return (
    <div className="card no-pad">
      <table className="table">
        <thead><tr><th>{proceso ? 'Proceso' : 'Nombre'}</th><th className="num">{proceso ? 'Líneas' : 'Órdenes'}</th><th className="num">Incompletas</th><th className="num">Venta</th><th className="num">Costo</th><th className="num">Ganancia</th>{!proceso && <th className="num">Comisión</th>}{!proceso && <th className="num">Contribución</th>}<th className="num">%</th></tr></thead>
        <tbody>
          {filas.map((g) => (
            <tr key={g.clave}>
              <td><strong>{proceso ? NOMBRE_PROCESO[g.nombre] || g.nombre : g.nombre}</strong></td><td className="num">{g.ordenes}</td><td className="num">{g.incompletas || ''}</td>
              <td className="num">{money(g.ingreso)}</td><td className="num">{money(g.costo)}</td><td className="num">{money(g.gananciaBruta)}</td>
              {!proceso && <td className="num">{money(g.comision)}</td>}{!proceso && <td className="num">{money(g.contribucion)}</td>}
              <td className="num">{g.contribucionPct == null ? '—' : `${g.contribucionPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small pad">Costo y ganancia suman solo lo completo; la venta incluye todo. {proceso ? 'Por proceso, la ganancia no descuenta comisión.' : ''}</p>
    </div>
  );
}

function TablaComisiones({ filas }) {
  return (
    <div className="card no-pad">
      <table className="table">
        <thead><tr><th>Vendedor</th><th className="num">Pendiente de cobro</th><th className="num">Pendiente de costo</th><th className="num">Listas</th><th className="num">Aprobadas</th><th className="num">Pagadas</th><th className="num">Ajustes</th></tr></thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.id}><td><strong>{r.vendedor}</strong></td><td className="num">{money(r.pendienteCobro)}</td><td className="num">{money(r.pendienteCosto)}</td><td className="num">{money(r.listas)}</td><td className="num">{money(r.aprobadas)}</td><td className="num">{money(r.pagadas)}</td><td className={`num ${r.ajustes < 0 ? 'danger' : ''}`}>{money(r.ajustes)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small pad">Los pendientes son estimados (comisiones sobre ganancia con costos faltantes no se suman). Listas/aprobadas/pagadas/ajustes por mes de liquidación.</p>
    </div>
  );
}
