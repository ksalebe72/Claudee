import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { MetaContext } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import { applyBrand, BrandMark } from './brand.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Jobs from './pages/Jobs.jsx';
import JobEditor from './pages/JobEditor.jsx';
import Production from './pages/Production.jsx';
import Tasks from './pages/Tasks.jsx';
import Catalog from './pages/Catalog.jsx';
import Automations from './pages/Automations.jsx';
import Billing from './pages/Billing.jsx';
import Settings from './pages/Settings.jsx';
import Liquidaciones from './pages/Liquidaciones.jsx';
import Reportes from './pages/Reportes.jsx';
import Portal from './pages/Portal.jsx';
import Asistente from './pages/Asistente.jsx';

const GESTION = ['duena', 'finanzas', 'gerencia'];
const SIN_LOGISTICA = ['duena', 'finanzas', 'gerencia', 'coordinacion', 'ventas'];
const NAV = [
  { group: 'General', items: [{ to: '/', label: 'Tablero', icon: '◧', end: true }, { to: '/asistente', label: 'Asistente IA', icon: '✨', roles: GESTION }] },
  { group: 'Ventas y CRM', items: [
    { to: '/contactos', label: 'Contactos', icon: '☺' },
    { to: '/pipeline', label: 'Pipeline', icon: '⇶', roles: SIN_LOGISTICA },
    { to: '/tareas', label: 'Tareas', icon: '✓' },
    { to: '/automatizaciones', label: 'Automatizaciones', icon: '⚡', roles: GESTION },
  ] },
  { group: 'Pedidos y producción', items: [
    { to: '/cotizaciones', label: 'Cotizaciones', icon: '✎', roles: SIN_LOGISTICA },
    { to: '/ordenes', label: 'Órdenes', icon: '▤' },
    { to: '/produccion', label: 'Producción', icon: '⚙' },
    { to: '/catalogo', label: 'Catálogo', icon: '▦', roles: SIN_LOGISTICA },
  ] },
  { group: 'Finanzas', items: [
    { to: '/cobranza', label: 'Cobranza', icon: '$', roles: SIN_LOGISTICA },
    { to: '/liquidaciones', label: 'Liquidación de comisiones', icon: '◎', roles: GESTION },
    { to: '/reportes', label: 'Reportes', icon: '▥', roles: GESTION },
    { to: '/ajustes', label: 'Ajustes', icon: '⚙', roles: SIN_LOGISTICA },
  ] },
];

export default function App() {
  const loc = useLocation();
  const [auth, setAuth] = useState(null); // { necesitaConfiguracion, usuario }
  const [meta, setMeta] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadAuth = useCallback(() => api.get('/auth/estado').then(setAuth).catch(() => setAuth({ necesitaConfiguracion: false, usuario: null })), []);
  const reloadMeta = useCallback(() => api.get('/meta').then(setMeta), []);

  useEffect(() => { if (!loc.pathname.startsWith('/portal/')) loadAuth(); }, []);
  useEffect(() => { if (auth?.usuario) reloadMeta().catch(() => {}); }, [auth?.usuario?.id]);
  useEffect(() => { applyBrand(meta?.brand || auth?.marca); }, [meta?.brand, auth?.marca]);
  useEffect(() => {
    const h = () => { setMeta(null); setAuth((a) => ({ ...(a || {}), usuario: null })); };
    window.addEventListener('cp:sin-sesion', h);
    return () => window.removeEventListener('cp:sin-sesion', h);
  }, []);

  if (loc.pathname.startsWith('/portal/')) {
    return <Routes><Route path="/portal/:token" element={<Portal />} /></Routes>;
  }
  if (!auth) return <div className="loading">Cargando…</div>;
  if (!auth.usuario) return <Login setup={auth.necesitaConfiguracion} requiereCodigo={auth.requiereCodigo} brand={auth.marca} onDone={(u) => setAuth((a) => ({ ...a, necesitaConfiguracion: false, usuario: u }))} />;
  if (!meta) return <div className="loading">Cargando…</div>;

  const user = auth.usuario;
  const salir = async () => { await api.post('/auth/salir').catch(() => {}); setMeta(null); setAuth({ necesitaConfiguracion: false, usuario: null }); };

  return (
    <MetaContext.Provider value={{ ...meta, user, reloadMeta }}>
      <div className="layout">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
          <div className="brand">
            <BrandMark brand={meta.brand} />
            <div>
              <strong>{meta.settings.business_name}</strong>
              <small>ColorPlus OS</small>
            </div>
          </div>
          {NAV.filter((g) => g.items.some((i) => !i.roles || i.roles.includes(user.role))).map((g) => (
            <nav key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.filter((i) => !i.roles || i.roles.includes(user.role)).map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className="nav-link">
                  <span className="nav-icon">{i.icon}</span>{i.label}
                </NavLink>
              ))}
            </nav>
          ))}
          <div className="user-box">
            <div><strong>{user.name}</strong><small>{user.roleName}</small></div>
            <button className="link-btn" onClick={salir}>Salir</button>
          </div>
        </aside>
        <main className="content">
          <button className="menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menú">☰</button>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contactos" element={<Contacts />} />
            <Route path="/contactos/:id" element={<ContactDetail />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/tareas" element={<Tasks />} />
            <Route path="/automatizaciones" element={<Automations />} />
            <Route path="/cotizaciones" element={<Jobs kind="quote" />} />
            <Route path="/ordenes" element={<Jobs kind="order" />} />
            <Route path="/trabajos/nuevo" element={<JobEditor />} />
            <Route path="/trabajos/:id" element={<JobEditor />} />
            <Route path="/produccion" element={<Production />} />
            <Route path="/catalogo" element={<Catalog />} />
            <Route path="/cobranza" element={<Billing />} />
            <Route path="/liquidaciones" element={<Liquidaciones />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/asistente" element={<Asistente />} />
            <Route path="/ajustes" element={<Settings />} />
            <Route path="*" element={<p>Página no encontrada</p>} />
          </Routes>
        </main>
      </div>
    </MetaContext.Provider>
  );
}
