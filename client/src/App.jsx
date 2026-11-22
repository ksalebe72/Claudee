import React, { useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { useLoad } from './utils.js';
import { MetaContext } from './components/ui.jsx';
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
import Portal from './pages/Portal.jsx';

const NAV = [
  { group: 'General', items: [{ to: '/', label: 'Tablero', icon: '◧', end: true }] },
  { group: 'Ventas y CRM', items: [
    { to: '/contactos', label: 'Contactos', icon: '☺' },
    { to: '/pipeline', label: 'Pipeline', icon: '⇶' },
    { to: '/tareas', label: 'Tareas', icon: '✓' },
    { to: '/automatizaciones', label: 'Automatizaciones', icon: '⚡' },
  ] },
  { group: 'Pedidos y producción', items: [
    { to: '/cotizaciones', label: 'Cotizaciones', icon: '✎' },
    { to: '/ordenes', label: 'Órdenes', icon: '▤' },
    { to: '/produccion', label: 'Producción', icon: '⚙' },
    { to: '/catalogo', label: 'Catálogo y precios', icon: '▦' },
  ] },
  { group: 'Finanzas', items: [
    { to: '/cobranza', label: 'Cobranza', icon: '$' },
    { to: '/ajustes', label: 'Ajustes', icon: '⚙' },
  ] },
];

export default function App() {
  const loc = useLocation();
  const [meta, reloadMeta] = useLoad(() => api.get('/meta'));
  const [menuOpen, setMenuOpen] = useState(false);

  if (loc.pathname.startsWith('/portal/')) {
    return <Routes><Route path="/portal/:token" element={<Portal />} /></Routes>;
  }
  if (!meta) return <div className="loading">Cargando…</div>;

  return (
    <MetaContext.Provider value={{ ...meta, reloadMeta }}>
      <div className="layout">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
          <div className="brand">
            <div className="logo">T</div>
            <div>
              <strong>{meta.settings.business_name}</strong>
              <small>Taller OS</small>
            </div>
          </div>
          {NAV.map((g) => (
            <nav key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className="nav-link">
                  <span className="nav-icon">{i.icon}</span>{i.label}
                </NavLink>
              ))}
            </nav>
          ))}
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
            <Route path="/ajustes" element={<Settings />} />
            <Route path="*" element={<p>Página no encontrada</p>} />
          </Routes>
        </main>
      </div>
    </MetaContext.Provider>
  );
}
