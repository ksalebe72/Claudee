// Mensajería con Twilio: texto (SMS) y WhatsApp. El email todavía no está conectado (solo se registra).
// Sin las variables de Twilio en el servidor, nada sale: el mensaje solo queda anotado en la ficha del cliente.
// Las claves viven en variables de entorno; aquí nunca se escriben en logs ni el texto del mensaje ni el teléfono.
import { getSetting } from './db.js';

const env = (k) => (process.env[k] || '').trim();
const BASE = () => env('TWILIO_BASE_URL') || 'https://api.twilio.com';

/** Qué canales pueden enviar de verdad con la configuración actual. */
export function canales() {
  const cuenta = !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN'));
  return { sms: cuenta && !!env('TWILIO_FROM'), whatsapp: cuenta && !!env('TWILIO_WHATSAPP_FROM'), email: false };
}

/** Los avisos automáticos (reglas de Automatizaciones) solo envían si el dueño lo prendió en Ajustes. */
export const envioAutomatico = () => getSetting('mensajes_automaticos', false) === true;

/** Teléfono a formato internacional. EE. UU. por defecto: (301) 555-0101 → +13015550101. null si no es válido. */
export function telefonoE164(tel) {
  const s = String(tel || '').trim();
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+') && d.length >= 8 && d.length <= 15) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

const ERRORES = {
  21211: 'el teléfono no es válido', 21614: 'ese número no recibe mensajes de texto', 21610: 'el cliente pidió no recibir mensajes (STOP)',
  21408: 'tu cuenta de Twilio no tiene permiso para enviar a ese país', 21606: 'el número remitente no es válido en Twilio', 21608: 'cuenta de prueba de Twilio: solo envía a números verificados',
  63016: 'WhatsApp: fuera de las 24 horas solo se pueden enviar plantillas aprobadas', 63007: 'WhatsApp: el número remitente no está habilitado en Twilio', 20003: 'las claves de Twilio no son válidas',
  30007: 'el operador lo bloqueó como spam', 30034: 'falta registrar el número para SMS de negocio (A2P 10DLC) en Twilio',
};

/**
 * Envía un mensaje. Devuelve { ok, estado } donde estado es un texto corto para la conversación del cliente:
 * «enviado», «registrado (… sin conectar)» o «no enviado: motivo». Nunca lanza error.
 */
export async function sendMessage(channel, contact, body, _subject = '') {
  const cfg = canales();
  if (channel === 'email') return contact?.email ? { ok: false, estado: 'registrado (el email aún no está conectado)' } : { ok: false, estado: 'sin destino' };
  if (!['sms', 'whatsapp'].includes(channel)) return { ok: false, estado: 'canal no válido' };
  if (!contact?.phone) return { ok: false, estado: 'sin destino' };
  const nombre = channel === 'sms' ? 'texto' : 'WhatsApp';
  if (!cfg[channel]) return { ok: false, estado: `registrado (${nombre} sin conectar)` };
  const to = telefonoE164(contact.phone);
  if (!to) return { ok: false, estado: 'no enviado: el teléfono del cliente no es válido' };
  const texto = String(body || '').trim().slice(0, 1500);
  if (!texto) return { ok: false, estado: 'no enviado: mensaje vacío' };

  const form = new URLSearchParams({ Body: texto, To: channel === 'whatsapp' ? `whatsapp:${to}` : to });
  if (channel === 'whatsapp') form.set('From', `whatsapp:${telefonoE164(env('TWILIO_WHATSAPP_FROM')) || env('TWILIO_WHATSAPP_FROM')}`);
  else if (/^MG[0-9a-f]{32}$/i.test(env('TWILIO_FROM'))) form.set('MessagingServiceSid', env('TWILIO_FROM'));
  else form.set('From', telefonoE164(env('TWILIO_FROM')) || env('TWILIO_FROM'));

  try {
    const sid = env('TWILIO_ACCOUNT_SID');
    const r = await fetch(`${BASE()}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, estado: 'enviado', sid: d.sid || null };
    const codigo = d.code || (r.status === 401 ? 20003 : null);
    console.error(`[Twilio] ${channel} no enviado: HTTP ${r.status} código ${codigo ?? '-'}`); // sin teléfono ni texto
    return { ok: false, estado: `no enviado: ${ERRORES[codigo] || `Twilio respondió con el error ${codigo ?? r.status}`}` };
  } catch (e) {
    console.error(`[Twilio] ${channel} no enviado: ${e.name === 'TimeoutError' ? 'tiempo agotado' : 'sin conexión'}`);
    return { ok: false, estado: 'no enviado: no se pudo conectar con Twilio' };
  }
}
