// Modo de prueba: levanta ColorPlus OS con datos de ejemplo y con simuladores de SanMar y de la IA.
// Uso: npm run demo   → abre http://localhost:3001
// Usa una base separada (data/demo.db): no toca tus datos reales. Ctrl+C para salir.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from '../tests/fixtures/sanmar-mock.js';
import { startAnthropicMock } from '../tests/fixtures/anthropic-mock.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3001;
const DB = resolve(root, 'data', 'demo.db');

if (process.argv.includes('--reset')) for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

if (!existsSync(resolve(root, 'client', 'dist', 'index.html'))) {
  console.log('Preparando la interfaz (solo la primera vez)…');
  const r = spawnSync(process.execPath, [resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'client/vite.config.js'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

const sanmar = await startMock(4555);
const ia = await startAnthropicMock(5555);

const app = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PORT: String(PORT), DB_PATH: DB, SEED_DEMO: '1',
    // Simulador de SanMar (no es SanMar real): estilo PC61 con 3 colores
    SANMAR_BASE_URL: 'http://localhost:4555', SANMAR_CUSTOMER_NUMBER: 'demo', SANMAR_USERNAME: 'test', SANMAR_PASSWORD: 'demo',
    SANMAR_EXTRA_IMAGE_HOSTS: 'localhost:4555',
    // Simulador de la IA (no es Claude real): respuestas fijas para probar las pantallas
    ANTHROPIC_API_KEY: 'sk-ant-simulador', ANTHROPIC_BASE_URL: 'http://localhost:5555',
  },
});
app.stdout.on('data', (d) => {
  const t = String(d);
  if (t.includes('lista en')) {
    console.log(`
  ColorPlus OS · MODO DE PRUEBA
  Abre: http://localhost:${PORT}

  · La primera vez te pide crear la cuenta de la dueña (usa la contraseña que quieras).
  · Datos de ejemplo: clientes y prendas de prueba (no son datos reales).
  · SanMar y la IA están SIMULADOS: responden siempre lo mismo.
      - SanMar: en Catálogo → Importar de SanMar, usa el estilo PC61.
      - IA: «Cotizar desde mensaje», «Redactar mensaje» y «Asistente IA».
  · Para empezar de cero: npm run demo -- --reset
  · Ctrl+C para salir.
`);
  }
});
const salir = () => { app.kill(); sanmar.close(); ia.close(); process.exit(0); };
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
app.on('exit', (code) => { sanmar.close(); ia.close(); process.exit(code ?? 0); });
