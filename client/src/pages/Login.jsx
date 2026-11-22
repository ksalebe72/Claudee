import React, { useState } from 'react';
import { api } from '../api.js';

/** Inicio de sesión. Si no existe ningún usuario, crea la cuenta de la dueña. */
export default function Login({ setup, onDone }) {
  const [f, setF] = useState({ name: '', username: '', password: '', password2: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

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
      <form className="login-card" onSubmit={submit}>
        <div className="brand dark"><div className="logo">CP</div><div><strong>ColorPlus OS</strong><small>Color Plus LLC</small></div></div>
        <h2>{setup ? 'Crear la cuenta de la dueña' : 'Iniciar sesión'}</h2>
        {setup && <p className="muted">Es la primera vez que se abre el sistema. Esta cuenta tendrá acceso a Ajustes, tarifas y aprobaciones.</p>}
        {setup && <label className="field"><span>Nombre</span><input required value={f.name} onChange={set('name')} autoFocus /></label>}
        <label className="field"><span>Usuario</span><input required value={f.username} onChange={set('username')} autoFocus={!setup} autoComplete="username" /></label>
        <label className="field"><span>Contraseña</span><input required type="password" minLength={setup ? 8 : undefined} value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} /></label>
        {setup && <label className="field"><span>Repite la contraseña</span><input required type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" /></label>}
        {err && <p className="danger">{err}</p>}
        <button className="btn primary big" disabled={busy}>{busy ? '…' : setup ? 'Crear cuenta' : 'Entrar'}</button>
      </form>
    </div>
  );
}
