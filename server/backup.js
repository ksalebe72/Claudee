// Respaldos diarios de la base de datos (copia consistente con VACUUM INTO).
// Se guardan en BACKUP_DIR (en Render, el disco permanente) y se conservan los últimos 14.
// Protegen contra errores y archivos dañados; para protegerte de perder el disco, descarga uno cada semana.
import { mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { db, DB_PATH } from './db.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || resolve(dirname(DB_PATH), 'respaldos');
const CONSERVAR = Number(process.env.BACKUP_KEEP) || 14;
const NOMBRE = /^colorplus-\d{4}-\d{2}-\d{2}(-\d{6})?\.db$/;

export function listarRespaldos() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter((f) => NOMBRE.test(f)).map((f) => {
    const st = statSync(resolve(BACKUP_DIR, f));
    return { nombre: f, bytes: st.size, fecha: st.mtime.toISOString() };
  }).sort((a, b) => b.nombre.localeCompare(a.nombre));
}

export function crearRespaldo({ manual = false } = {}) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ahora = new Date();
  const dia = ahora.toISOString().slice(0, 10);
  const nombre = manual ? `colorplus-${dia}-${ahora.toISOString().slice(11, 19).replace(/:/g, '')}.db` : `colorplus-${dia}.db`;
  const destino = resolve(BACKUP_DIR, nombre);
  if (existsSync(destino)) rmSync(destino);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  // Conserva solo los más recientes
  for (const r of listarRespaldos().slice(CONSERVAR)) rmSync(resolve(BACKUP_DIR, r.nombre), { force: true });
  return { nombre, bytes: statSync(destino).size };
}

export function rutaRespaldo(nombre) {
  const n = basename(String(nombre));
  if (!NOMBRE.test(n)) return null;
  const f = resolve(BACKUP_DIR, n);
  return existsSync(f) ? f : null;
}

/** Respaldo al arrancar si hoy no hay uno, y luego cada 24 horas. */
export function programarRespaldos() {
  if (process.env.BACKUP_DISABLED === '1') return;
  const hoy = `colorplus-${new Date().toISOString().slice(0, 10)}.db`;
  try {
    if (!listarRespaldos().some((r) => r.nombre === hoy)) {
      const r = crearRespaldo();
      console.log(`Respaldo creado: ${r.nombre}`);
    }
  } catch (e) { console.error(`No se pudo crear el respaldo: ${e.message}`); }
  setInterval(() => {
    try { crearRespaldo(); } catch (e) { console.error(`No se pudo crear el respaldo: ${e.message}`); }
  }, 24 * 3600 * 1000).unref();
}
