import express from 'express';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import api, { UPLOAD_DIR } from './api.js';
import financeApi from './finance-api.js';
import iaApi from './ia-api.js';
import opsApi, { healthRouter } from './ops-api.js';
import { programarRespaldos } from './backup.js';
import { authRouter, usersRouter, requireAuth } from './auth.js';
import { ensurePricing, ensureCommissionSetup, aplicarCambioComisionBryan } from './config.js';
import { seedIfEmpty } from './seed.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.disable('x-powered-by');
// Detrás del proxy de Render (u otro): así la app sabe que la conexión es https (cookies seguras y enlaces correctos).
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));

if (seedIfEmpty({ demo: process.env.SEED_DEMO !== '0' })) console.log('Base nueva: datos iniciales cargados');
ensurePricing();
ensureCommissionSetup();
if (process.env.CAMBIO_BRYAN_DISABLED !== '1') aplicarCambioComisionBryan();
programarRespaldos();

// Toda la API exige sesión, salvo el inicio de sesión y el portal público del cliente.
app.use('/api', healthRouter);
app.use('/api', authRouter);
app.use('/api', requireAuth);
app.use('/api', usersRouter);
app.use('/api', financeApi);
app.use('/api', iaApi);
app.use('/api', opsApi);
app.use('/api', api);
app.use('/uploads', express.static(UPLOAD_DIR));

const dist = resolve(root, 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`ColorPlus OS lista en http://localhost:${port}`));
