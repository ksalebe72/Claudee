// Transporte SOAP hacia SanMar: arma el sobre, envía, reintenta con espera y clasifica errores.
// Nunca registra el cuerpo de la petición (lleva la contraseña) ni la respuesta completa.
import { escapeXml, parseXml, textOf } from './xml.js';
import { SanmarError, CODIGOS, clasificarMensaje } from './errors.js';

export const BASE_URL_PRODUCCION = 'https://ws.sanmar.com:8080';

// Servicios estándar de SanMar Web Services (no PromoStandards).
export const SERVICIOS = {
  producto: { ruta: '/SanMarWebService/SanMarProductInfoServicePort', ns: 'http://impl.webservice.integration.sanmar.com/' },
  precios: { ruta: '/SanMarWebService/SanMarPricingServicePort', ns: 'http://impl.webservice.integration.sanmar.com/' },
  inventario: { ruta: '/SanMarWebService/SanMarWebServicePort', ns: 'http://webservice.integration.sanmar.com/' },
};

export function sobre(ns, operacion, cuerpo) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="${ns}">`
    + `<soapenv:Header/><soapenv:Body><web:${operacion}>${cuerpo}</web:${operacion}></soapenv:Body></soapenv:Envelope>`;
}

export const campos = (obj) => Object.entries(obj).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('');

/** Oculta cualquier aparición de las credenciales en un texto (por si SanMar las repite en un mensaje). */
export function ocultar(texto, creds) {
  let t = String(texto ?? '');
  for (const v of [creds?.password, creds?.username, creds?.customerNumber]) {
    if (v && String(v).length >= 3) t = t.split(String(v)).join('***');
  }
  return t;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ESPERAS_MS = [800, 2000, 5000, 10000];

function normalizarError(e, timeoutMs) {
  if (e instanceof SanmarError) return e;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new SanmarError(CODIGOS.TIEMPO_AGOTADO, `SanMar no respondió en ${Math.round(timeoutMs / 1000)} s.`, { retryable: true });
  }
  const causa = e?.cause?.code || e?.code || e?.message || 'desconocido';
  return new SanmarError(CODIGOS.RED, `No se pudo conectar con SanMar (${causa}).`, { retryable: true });
}

/**
 * Hace una llamada SOAP y devuelve el árbol XML de la respuesta.
 * @param {object} o
 * @param {string} o.baseUrl
 * @param {{ruta:string, ns:string}} o.servicio
 * @param {string} o.operacion
 * @param {string} o.cuerpo        XML interno de la operación (ya escapado)
 * @param {object} o.creds         para ocultarlas en mensajes de error
 */
export async function llamarSoap({ baseUrl, servicio, operacion, cuerpo, creds, timeoutMs = 20000, reintentos = 3, fetchImpl = fetch, sleep = esperar, onRespuesta }) {
  const url = baseUrl.replace(/\/$/, '') + servicio.ruta;
  const body = sobre(servicio.ns, operacion, cuerpo);
  let ultimo;
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', Accept: 'text/xml' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const texto = await res.text();

      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        throw new SanmarError(CODIGOS.LIMITE, 'SanMar indicó que se superó el límite de consultas.', { retryable: true, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null });
      }
      if (res.status === 401 || res.status === 403) throw new SanmarError(CODIGOS.CREDENCIALES, 'SanMar rechazó el acceso (HTTP ' + res.status + ').');
      if (!/Envelope/i.test(texto)) {
        if (res.status >= 500) throw new SanmarError(CODIGOS.RED, `SanMar no está disponible (HTTP ${res.status}).`, { retryable: true });
        throw new SanmarError(CODIGOS.RESPUESTA_INVALIDA, `Respuesta inesperada de SanMar (HTTP ${res.status}).`);
      }

      const doc = parseXml(texto);
      onRespuesta?.(operacion, doc);
      const fault = textOf(doc, 'faultstring');
      if (fault) throw clasificarMensaje(ocultar(fault, creds));
      const conError = textOf(doc, 'errorOccured', 'errorOccurred');
      if (conError && conError.toLowerCase() === 'true') throw clasificarMensaje(ocultar(textOf(doc, 'message') || 'error sin mensaje', creds));
      return doc;
    } catch (e) {
      ultimo = normalizarError(e, timeoutMs);
      if (!ultimo.retryable || intento === reintentos) throw ultimo;
      const base = ultimo.retryAfterMs ?? ESPERAS_MS[Math.min(intento, ESPERAS_MS.length - 1)];
      await sleep(base + Math.floor(Math.random() * 250));
    }
  }
  throw ultimo;
}
