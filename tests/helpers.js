// Utilidades de prueba: levanta el servidor con una base temporal y entra con distintos roles.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startServer({ env = {}, port, skipSetup = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'colorplus-'));
  const PORT = port || 4100 + Math.floor(Math.random() * 800);
  const B = `http://localhost:${PORT}/api`;
  let salida = '';
  const proc = spawn(process.execPath, ['server/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT, DB_PATH: join(dir, 't.db'), SANMAR_CUSTOMER_NUMBER: '', SANMAR_USERNAME: '', SANMAR_PASSWORD: '', SETUP_CODE: '', BACKUP_DISABLED: '1', ...env },
  });
  proc.stdout.on('data', (d) => (salida += d));
  proc.stderr.on('data', (d) => (salida += d));
  for (let i = 0; i < 80; i++) {
    try { await fetch(B + '/auth/estado'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const client = (cookie) => {
    const call = async (method, url, body) => {
      const r = await fetch(B + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer(), headers: r.headers };
    };
    const ok = async (method, url, body) => {
      const res = await call(method, url, body);
      if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body;
    };
    return { call, get: (u) => ok('GET', u), post: (u, b = {}) => ok('POST', u, b), put: (u, b) => ok('PUT', u, b), del: (u) => ok('DELETE', u) };
  };

  const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];
  let duena = null;
  if (!skipSetup) {
    const setup = await fetch(B + '/auth/configurar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dueña', username: 'duena', password: 'ClaveDuena123', codigo: env.SETUP_CODE }) });
    duena = client(cookieOf(setup));
  }

  async function userWithRole(role, salesperson_id = null) {
    const username = `${role}${Math.floor(Math.random() * 1e6)}`;
    await duena.post('/usuarios', { name: `Usuario ${role}`, username, password: 'ClaveSegura123', role, salesperson_id });
    const r = await fetch(B + '/auth/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'ClaveSegura123' }) });
    return client(cookieOf(r));
  }

  return {
    B, dir, duena, anon: client(null), userWithRole, salida: () => salida,
    stop() { proc.kill(); rmSync(dir, { recursive: true, force: true }); },
  };
}
