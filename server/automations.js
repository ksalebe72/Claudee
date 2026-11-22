// Motor de automatizaciones estilo "workflows" de HighLevel:
// un evento (trigger) + condición opcional -> acción.
import { all, get, getSetting, insert, run } from './db.js';
import { sendMessage } from './messaging.js';

export const TRIGGERS = {
  'contact.created': 'Nuevo contacto creado',
  'opportunity.stage_changed': 'Oportunidad cambia de etapa',
  'quote.sent': 'Cotización enviada',
  'quote.approved': 'Cotización aprobada por el cliente',
  'quote.rejected': 'Cotización rechazada',
  'order.created': 'Orden creada',
  'order.status_changed': 'Orden cambia de estado',
  'proof.uploaded': 'Prueba de arte subida',
  'proof.approved': 'Prueba de arte aprobada',
  'proof.rejected': 'Prueba de arte rechazada (pide cambios)',
  'payment.received': 'Pago recibido',
};

export const ACTIONS = {
  create_task: 'Crear tarea',
  send_sms: 'Enviar SMS al cliente',
  send_email: 'Enviar email al cliente',
  set_order_status: 'Cambiar estado de la orden',
  convert_to_order: 'Convertir cotización en orden',
  move_opportunity: 'Mover oportunidad de etapa',
  add_tag: 'Agregar etiqueta al contacto',
};

// Hook para que el servidor ejecute acciones que viven en las rutas (evita imports circulares).
const handlers = {};
export function registerHandler(name, fn) { handlers[name] = fn; }

export function render(tpl = '', ctx = {}) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
    return v == null ? '' : String(v);
  });
}

function matches(condition = {}, payload) {
  return Object.entries(condition).every(([k, v]) => v === '' || v == null || String(payload[k]) === String(v));
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

let depth = 0;

/** Dispara un evento. payload: { contact, job, opportunity, proof, payment, from, to } */
export function fire(trigger, payload = {}) {
  if (depth > 4) return; // evita bucles infinitos entre automatizaciones
  depth++;
  try {
    const rules = all('SELECT * FROM automations WHERE active = 1 AND trigger = ?', trigger);
    for (const rule of rules) {
      if (!matches(rule.condition, payload)) continue;
      try {
        execute(rule, payload);
        run("UPDATE automations SET runs = runs + 1, last_run = datetime('now') WHERE id = ?", rule.id);
      } catch (e) {
        console.error(`[automatización ${rule.id}] ${e.message}`);
      }
    }
  } finally {
    depth--;
  }
}

function execute(rule, payload) {
  const p = rule.params || {};
  const { contact, job } = payload;
  const ctx = { ...payload, business: { name: getSetting('business_name', 'Mi Taller') } };

  switch (rule.action) {
    case 'create_task':
      insert('tasks', {
        title: render(p.title || rule.name, ctx),
        due_date: addDays(p.due_in_days ?? 1),
        assignee: p.assignee || null,
        contact_id: contact?.id ?? null,
        job_id: job?.id ?? null,
      });
      break;
    case 'send_sms':
    case 'send_email': {
      if (!contact) return;
      const channel = rule.action === 'send_sms' ? 'sms' : 'email';
      const body = render(p.message, ctx);
      const status = sendMessage(channel, contact, body, render(p.subject || '', ctx));
      insert('activities', { contact_id: contact.id, job_id: job?.id ?? null, type: channel, direction: 'saliente', body, status: `${status} · auto` });
      break;
    }
    case 'set_order_status':
      if (job && job.kind === 'order') handlers.setOrderStatus?.(job.id, p.status);
      break;
    case 'convert_to_order':
      if (job && job.kind === 'quote') handlers.convertToOrder?.(job.id);
      break;
    case 'move_opportunity': {
      const oppId = payload.opportunity?.id || job?.opportunity_id;
      if (oppId) handlers.moveOpportunity?.(oppId, p.stage);
      break;
    }
    case 'add_tag':
      if (contact) {
        const c = get('SELECT tags FROM contacts WHERE id = ?', contact.id);
        const tags = new Set(c?.tags || []);
        tags.add(p.tag);
        run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify([...tags]), contact.id);
      }
      break;
    default:
      throw new Error(`Acción desconocida: ${rule.action}`);
  }
}
