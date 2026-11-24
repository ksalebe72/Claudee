import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BrandMark } from '../brand.jsx';

const SERVICIOS = ['Serigrafía', 'Bordado', 'DTF', 'Rótulos', 'Wraps', 'Promocionales'];

/** Inicio de sesión. Si no existe ningún usuario, crea la cuenta del dueño. */
export default function Login({ setup, onDone, brand, requiereCodigo }) {
  const [f, setF] = useState({ name: '', username: '', password: '', password2: '', codigo: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [videoListo, setVideoListo] = useState(false);
  const videoRef = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Sin video si la persona pidió menos movimiento en su equipo.
  useEffect(() => {
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (quieto) videoRef.current?.pause();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (setup && f.password !== f.password2) { setErr('Las contraseñas no coinciden.'); return; }
    setBusy(true);
    try {
      const r = setup ? await api.post('/auth/configurar', f) : await api.post('/auth/entrar', { username: f.username, password: f.password });
      onDone(r.usuario);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="login-bg" aria-hidden="true">
        <video
          ref={videoRef}
          className={`login-video ${videoListo ? 'on' : ''}`}
          src="/brand/login-hero.mp4"
          poster="/brand/login-hero.jpg"
          autoPlay muted loop playsInline preload="auto"
          onCanPlay={() => setVideoListo(true)}
        />
        <div className="login-veil" />
        <div className="login-grain" />
      </div>

      <section className="login-hero">
        <div className="login-kicker anim" style={{ '--d': '0ms' }}>
          <span className="tinta c" /><span className="tinta m" /><span className="tinta y" /><span className="tinta k" />
          ColorPlus OS
        </div>
        <h1 className="login-title">
          <span className="anim" style={{ '--d': '120ms' }}>Cada pieza,</span>
          <span className="anim" style={{ '--d': '240ms' }}>cada orden,</span>
          <span className="anim grad" style={{ '--d': '360ms' }}>en un solo lugar.</span>
        </h1>
        <p className="login-sub anim" style={{ '--d': '520ms' }}>
          Cotizaciones, arte, producción y cobranza del taller. Entra para seguir donde lo dejaste.
        </p>
        <ul className="login-chips anim" style={{ '--d': '660ms' }}>
          {SERVICIOS.map((s, i) => <li key={s} style={{ '--i': i }}>{s}</li>)}
        </ul>
      </section>

      <form className="login-card anim-card" onSubmit={submit}>
        <div className="login-brand"><BrandMark brand={brand} /><strong>{brand?.name || 'Color Plus'}</strong><small>Sistema interno</small></div>
        <h2>{setup ? 'Crear la cuenta del dueño' : 'Iniciar sesión'}</h2>
        {setup && <p className="muted">Es la primera vez que se abre el sistema. Esta cuenta tendrá acceso a Ajustes, tarifas y aprobaciones.</p>}
        {setup && requiereCodigo && <label className="field"><span>Código de instalación</span><input required value={f.codigo} onChange={set('codigo')} autoComplete="off" placeholder="Está en Render → Environment → SETUP_CODE" /></label>}
        {setup && <label className="field"><span>Nombre</span><input required value={f.name} onChange={set('name')} autoFocus /></label>}
        <label className="field"><span>Usuario</span><input required value={f.username} onChange={set('username')} autoFocus={!setup} autoComplete="username" /></label>
        <label className="field"><span>Contraseña</span><input required type="password" minLength={setup ? 8 : undefined} value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} /></label>
        {setup && <label className="field"><span>Repite la contraseña</span><input required type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" /></label>}
        {err && <p className="danger login-err">{err}</p>}
        <button className="btn primary big login-btn" disabled={busy}>
          <span>{busy ? 'Entrando…' : setup ? 'Crear cuenta' : 'Entrar'}</span>
        </button>
      </form>
    </div>
  );
}
