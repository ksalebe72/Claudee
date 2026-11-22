import express from 'express';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import api, { UPLOAD_DIR } from './api.js';
import { seedIfEmpty } from './seed.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '20mb' }));

if (seedIfEmpty({ demo: process.env.SEED_DEMO !== '0' })) console.log('Base nueva: datos iniciales cargados');

// Autenticación básica opcional: define APP_USER y APP_PASSWORD para proteger el panel (el portal queda público).
const { APP_USER, APP_PASSWORD } = process.env;
if (APP_USER && APP_PASSWORD) {
  const expected = 'Basic ' + Buffer.from(`${APP_USER}:${APP_PASSWORD}`).toString('base64');
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/portal/') || req.path.startsWith('/portal/') || req.path.startsWith('/assets/') || req.path.startsWith('/uploads/')) return next();
    if (req.headers.authorization === expected) return next();
    res.set('WWW-Authenticate', 'Basic realm="Taller"').status(401).send('Autenticación requerida');
  });
}

app.use('/api', api);
app.use('/uploads', express.static(UPLOAD_DIR));

const dist = resolve(root, 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`API lista en http://localhost:${port}`));
