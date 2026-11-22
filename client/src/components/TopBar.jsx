// Barra superior: búsqueda global (Ctrl+K), avisos y usuario.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { label } from '../utils.js';

const Icono = {
  buscar: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  campana: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>,
  flecha: <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>,
};

function useFuera(ref, cerrar) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) cerrar(); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [ref, cerrar]);
}

export default function TopBar({ user, onSalir }) {
  return (
    <div className="topbar">
      <Busqueda />
      <div className="topbar-der">
        <Avisos />
        <Usuario user={user} onSalir={onSalir} />
      </div>
    </div>
  );
}

function Busqueda() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const input = useRef(null);
  const caja = useRef(null);
  useFuera(caja, () => setAbierto(false));

  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setAbierto(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api.get(`/buscar?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const ir = (to) => { setAbierto(false); setQ(''); nav(to); };
  const vacio = res && !res.contactos.length && !res.trabajos.length;
  return (
    <div className="buscador" ref={caja}>
      <span className="buscador-icono">{Icono.buscar}</span>
      <input ref={input} value={q} placeholder="Buscar cotizaciones, órdenes, clientes…" aria-label="Buscar"
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setAbierto(false); e.currentTarget.blur(); } }} />
      <kbd>Ctrl K</kbd>
      {abierto && res && (
        <div className="buscador-res">
          {vacio && <div className="muted small pad">Sin resultados para «{q}».</div>}
          {res.trabajos.length > 0 && <div className="res-grupo">Cotizaciones y órdenes</div>}
          {res.trabajos.map((j) => (
            <button key={`j${j.id}`} type="button" onClick={() => ir(`/trabajos/${j.id}`)}>
              <strong>{j.kind === 'order' ? j.order_number : j.number}</strong> {j.title}
              <span className="muted"> · {j.contact_name || 'sin cliente'} · {label(j.status)}</span>
            </button>
          ))}
          {res.contactos.length > 0 && <div className="res-grupo">Clientes</div>}
          {res.contactos.map((c) => (
            <button key={`c${c.id}`} type="button" onClick={() => ir(`/contactos/${c.id}`)}>
              <strong>{c.name}</strong>{c.company && <span className="muted"> · {c.company}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avisos() {
  const loc = useLocation();
  const [lista, setLista] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  useFuera(caja, () => setAbierto(false));
  useEffect(() => { api.get('/avisos').then(setLista).catch(() => {}); }, [loc.pathname]);
  const activos = lista.filter((a) => a.n > 0);
  const total = activos.reduce((a, x) => a + x.n, 0);
  return (
    <div className="avisos" ref={caja}>
      <button type="button" className="icon-cuadro" aria-label={`Avisos: ${total}`} onClick={() => setAbierto(!abierto)}>
        {Icono.campana}
        {total > 0 && <span className="contador">{total > 99 ? '99+' : total}</span>}
      </button>
      {abierto && (
        <div className="menu-flotante avisos-menu">
          <div className="menu-titulo">Requieren atención</div>
          {activos.length === 0 && <div className="muted small pad">Todo al día.</div>}
          {activos.map((a) => (
            <Link key={a.clave} to={a.to} className="aviso-fila" onClick={() => setAbierto(false)}>
              <span><strong>{a.titulo}</strong><small className="muted">{a.detalle}</small></span>
              <span className="aviso-n">{a.n}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Usuario({ user, onSalir }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  useFuera(caja, () => setAbierto(false));
  const iniciales = String(user.name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="usuario" ref={caja}>
      <button type="button" className="usuario-btn" onClick={() => setAbierto(!abierto)}>
        <span className="avatar">{iniciales}</span>
        <span className="usuario-txt"><strong>{user.name}</strong><small>{user.roleName}</small></span>
        {Icono.flecha}
      </button>
      {abierto && (
        <div className="menu-flotante usuario-menu">
          <div className="pad small muted">Conectado como <strong>{user.username}</strong></div>
          <button type="button" className="menu-item" onClick={onSalir}>Cerrar sesión</button>
        </div>
      )}
    </div>
  );
}
