// Usuarios, roles y sesiones.
// Roles: duena (dueña: ajustes, aprobaciones finales), finanzas (costos, revisión de liquidaciones),
// gerencia (aprueba márgenes bajos), ventas.
// La primera vez que se abre la app se crea la cuenta de la dueña (no hay contraseñas por defecto).
import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, get, run, insert } from './db.js';
import { getBrand } from './brand.js';

export const ROLES = { duena: 'Dueña', finanzas: 'Finanzas', gerencia: 'Gerencia', ventas: 'Ventas' };
const COOKIE = 'cp_session';
const SESSION_DAYS = 14;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(String(pw), salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const a = scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const b = Buffer.from(hashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const publicUser = (u) => u && { id: u.id, name: u.name, username: u.username, role: u.role, roleName: ROLES[u.role], salesperson_id: u.salesperson_id, active: !!u.active };
const fail = (status, msg) => Object.assign(new Error(msg), { status });

function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function startSession(res, req, userId) {
  const token = randomBytes(32).toString('hex');
  run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`, token, userId);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
}

export function userFromRequest(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const u = get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`, token);
  return u ? publicUser(u) : null;
}

/** Exige sesión en toda la API salvo autenticación y portal del cliente. */
export function requireAuth(req, res, next) {
  if (req.path.startsWith('/auth/') || req.path.startsWith('/portal/')) return next();
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.', codigo: 'SIN_SESION' });
  req.user = user;
  next();
}

/** Lanza 403 si el usuario no tiene alguno de los roles. */
export function requireRole(req, ...roles) {
  if (!req.user || !roles.includes(req.user.role)) {
    throw fail(403, `Esta acción es solo para: ${roles.map((r) => ROLES[r]).join(', ')}.`);
  }
}

// Protección básica contra fuerza bruta: 8 intentos fallidos → espera 5 minutos.
const intentos = new Map();

export const authRouter = express.Router();
const wrap = (fn) => (req, res) => {
  try { const out = fn(req, res); if (out !== undefined) res.json(out); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};

authRouter.get('/auth/estado', wrap((req) => ({
  necesitaConfiguracion: get('SELECT COUNT(*) AS c FROM users').c === 0,
  requiereCodigo: !!process.env.SETUP_CODE,
  marca: getBrand(),
  usuario: userFromRequest(req),
})));

authRouter.post('/auth/configurar', wrap((req, res) => {
  if (get('SELECT COUNT(*) AS c FROM users').c > 0) throw fail(400, 'La cuenta de la dueña ya existe.');
  // En un servidor público, solo quien tenga el código de instalación (SETUP_CODE) puede crear la cuenta de la dueña.
  if (process.env.SETUP_CODE) {
    const a = Buffer.from(String(req.body.codigo || ''));
    const b = Buffer.from(process.env.SETUP_CODE);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw fail(403, 'Código de instalación incorrecto.');
  }
  const { name, username, password } = req.body;
  if (!name || !username || String(password || '').length < 8) throw fail(400, 'Nombre, usuario y contraseña de al menos 8 caracteres.');
  const id = insert('users', { name, username: String(username).trim().toLowerCase(), password_hash: hashPassword(password), role: 'duena' });
  startSession(res, req, id);
  return { usuario: publicUser(get('SELECT * FROM users WHERE id = ?', id)) };
}));

authRouter.post('/auth/entrar', wrap((req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const reg = intentos.get(username);
  if (reg && reg.n >= 8 && Date.now() - reg.t < 5 * 60000) throw fail(429, 'Demasiados intentos. Espera 5 minutos.');
  const u = get('SELECT * FROM users WHERE username = ? AND active = 1', username);
  if (!u || !verifyPassword(req.body.password || '', u.password_hash)) {
    intentos.set(username, { n: (reg?.n || 0) + 1, t: Date.now() });
    throw fail(401, 'Usuario o contraseña incorrectos.');
  }
  intentos.delete(username);
  startSession(res, req, u.id);
  return { usuario: publicUser(u) };
}));

authRouter.post('/auth/salir', wrap((req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return { ok: true };
}));

// ---------- administración de usuarios (solo dueña) ----------
export const usersRouter = express.Router();
usersRouter.get('/usuarios', wrap((req) => { requireRole(req, 'duena'); return all('SELECT * FROM users ORDER BY id').map(publicUser); }));
usersRouter.post('/usuarios', wrap((req) => {
  requireRole(req, 'duena');
  const { name, username, password, role, salesperson_id } = req.body;
  if (!name || !username || String(password || '').length < 8) throw fail(400, 'Nombre, usuario y contraseña de al menos 8 caracteres.');
  if (!ROLES[role]) throw fail(400, 'Rol inválido');
  const id = insert('users', { name, username: String(username).trim().toLowerCase(), password_hash: hashPassword(password), role, salesperson_id: salesperson_id || null });
  return publicUser(get('SELECT * FROM users WHERE id = ?', id));
}));
usersRouter.put('/usuarios/:id', wrap((req) => {
  requireRole(req, 'duena');
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw fail(404, 'No encontrado');
  const { name, role, active, password, salesperson_id } = req.body;
  if (role && !ROLES[role]) throw fail(400, 'Rol inválido');
  if (u.id === req.user.id && (role && role !== 'duena' || active === false)) throw fail(400, 'No puedes quitarte el rol de dueña ni desactivarte.');
  run('UPDATE users SET name = ?, role = ?, active = ?, salesperson_id = ? WHERE id = ?',
    name ?? u.name, role ?? u.role, active === undefined ? u.active : active ? 1 : 0, salesperson_id === undefined ? u.salesperson_id : salesperson_id || null, u.id);
  if (password) {
    if (String(password).length < 8) throw fail(400, 'La contraseña debe tener al menos 8 caracteres.');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
  }
  return publicUser(get('SELECT * FROM users WHERE id = ?', u.id));
}));
