// Datos iniciales: métodos de decoración, catálogo, contactos de ejemplo y automatizaciones base.
// Uso: `npm run seed` (borra y recrea) o se ejecuta solo si la base está vacía.
import { rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes('--reset')) {
  const { DB_PATH } = await import('./db.js').then((m) => { m.db.close(); return m; });
  for (const suf of ['', '-wal', '-shm']) rmSync(DB_PATH + suf, { force: true });
  console.log('Base de datos borrada');
}

const { get, insert, setSetting, run } = await import(`./db.js${isMain ? '?fresh' : ''}`);

export function seedIfEmpty({ demo = true } = {}) {
  if (get('SELECT COUNT(*) AS c FROM decoration_methods').c > 0) return false;

  setSetting('business_name', 'Mi Taller de Impresión');
  setSetting('markup', 0.6);
  setSetting('tax_rate', 0.07);
  setSetting('deposit_pct', 0.5);
  setSetting('seq_quote', 1000);
  setSetting('seq_order', 2000);

  const methods = [
    { code: 'serigrafia', name: 'Serigrafía', setup_fee: 25, setup_per_color: 1, color_price: 0.5,
      tiers: [{ min: 1, price: 6 }, { min: 24, price: 3.5 }, { min: 48, price: 2.5 }, { min: 144, price: 1.75 }, { min: 500, price: 1.2 }] },
    { code: 'bordado', name: 'Bordado', setup_fee: 35, setup_per_color: 0, color_price: 0,
      tiers: [{ min: 1, price: 9 }, { min: 12, price: 7 }, { min: 48, price: 5.5 }, { min: 144, price: 4.5 }] },
    { code: 'dtf', name: 'DTF', setup_fee: 0, setup_per_color: 0, color_price: 0,
      tiers: [{ min: 1, price: 7 }, { min: 12, price: 5.5 }, { min: 50, price: 4.25 }, { min: 100, price: 3.5 }] },
    { code: 'vinil', name: 'Vinil textil (HTV)', setup_fee: 0, setup_per_color: 0, color_price: 1.5,
      tiers: [{ min: 1, price: 6 }, { min: 12, price: 4.5 }, { min: 48, price: 3.5 }] },
    { code: 'sublimacion', name: 'Sublimación', setup_fee: 0, setup_per_color: 0, color_price: 0,
      tiers: [{ min: 1, price: 8 }, { min: 24, price: 6 }, { min: 100, price: 4.5 }] },
  ];
  for (const m of methods) insert('decoration_methods', m);

  const apparel = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
  const products = [
    { sku: 'G5000', name: 'Camiseta algodón pesado', brand: 'Gildan', category: 'Camisetas', base_cost: 3.1, colors: ['Blanco', 'Negro', 'Navy', 'Rojo', 'Gris'], sizes: apparel, supplier: 'S&S Activewear' },
    { sku: 'BC3001', name: 'Camiseta premium Unisex', brand: 'Bella+Canvas', category: 'Camisetas', base_cost: 4.6, colors: ['Blanco', 'Negro', 'Heather', 'Navy'], sizes: apparel, supplier: 'S&S Activewear' },
    { sku: 'K500', name: 'Polo Silk Touch', brand: 'Port Authority', category: 'Polos', base_cost: 11.5, colors: ['Blanco', 'Negro', 'Navy', 'Royal'], sizes: apparel, supplier: 'SanMar' },
    { sku: '18500', name: 'Hoodie con capucha', brand: 'Gildan', category: 'Sudaderas', base_cost: 12.4, colors: ['Negro', 'Gris', 'Navy', 'Maroon'], sizes: apparel, supplier: 'S&S Activewear' },
    { sku: '112', name: 'Gorra trucker', brand: 'Richardson', category: 'Gorras', base_cost: 6.2, colors: ['Negro/Blanco', 'Navy/Blanco', 'Charcoal'], sizes: [], supplier: 'SanMar' },
    { sku: 'TOTE', name: 'Bolsa tote de lona', brand: 'Liberty Bags', category: 'Promocionales', base_cost: 2.4, colors: ['Natural', 'Negro'], sizes: [], supplier: 'alphabroder' },
  ];
  for (const p of products) insert('products', p);

  const autos = [
    { name: 'Seguimiento a nuevo lead', trigger: 'contact.created', action: 'create_task', params: { title: 'Llamar a {{contact.name}} (nuevo lead)', due_in_days: 0 } },
    { name: 'SMS de bienvenida', trigger: 'contact.created', action: 'send_sms', params: { message: 'Hola {{contact.name}}, gracias por contactar a {{business.name}}. En breve te enviamos tu cotización.' } },
    { name: 'Cotización enviada → oportunidad "cotizado"', trigger: 'quote.sent', action: 'move_opportunity', params: { stage: 'cotizado' } },
    { name: 'Email con enlace de cotización', trigger: 'quote.sent', action: 'send_email', params: { subject: 'Tu cotización {{job.number}}', message: 'Hola {{contact.name}}, revisa y aprueba tu cotización aquí: {{job.link}}' } },
    { name: 'Recordatorio si no responde', trigger: 'quote.sent', action: 'create_task', params: { title: 'Dar seguimiento a cotización {{job.number}}', due_in_days: 2 } },
    { name: 'Cotización aprobada → crear orden', trigger: 'quote.approved', action: 'convert_to_order', params: {} },
    { name: 'Cotización aprobada → oportunidad ganada', trigger: 'quote.approved', action: 'move_opportunity', params: { stage: 'ganado' } },
    { name: 'Avisar al cliente que su prueba está lista', trigger: 'proof.uploaded', action: 'send_sms', params: { message: '{{contact.name}}, tu prueba de arte está lista para aprobar: {{job.link}}' } },
    { name: 'Prueba aprobada → pedir blanks', trigger: 'proof.approved', action: 'set_order_status', params: { status: 'compras' } },
    { name: 'Prueba rechazada → regresar a arte', trigger: 'proof.rejected', action: 'set_order_status', params: { status: 'arte' } },
    { name: 'Prueba rechazada → tarea al diseñador', trigger: 'proof.rejected', action: 'create_task', params: { title: 'Corregir arte de {{job.order_number}}: {{proof.customer_comment}}', due_in_days: 1, assignee: 'Arte' } },
    { name: 'Orden lista → SMS para recoger', trigger: 'order.status_changed', condition: { to: 'listo' }, action: 'send_sms', params: { message: '¡{{contact.name}}, tu orden {{job.order_number}} está lista para recoger!' } },
    { name: 'Orden entregada → pedir reseña', trigger: 'order.status_changed', condition: { to: 'entregado' }, action: 'send_email', params: { subject: '¿Cómo te fue con tu pedido?', message: 'Gracias por tu compra, {{contact.name}}. ¿Nos dejas una reseña?' } },
    { name: 'Cliente que paga → etiqueta "cliente"', trigger: 'payment.received', action: 'add_tag', params: { tag: 'cliente' } },
  ];
  for (const a of autos) insert('automations', { condition: {}, ...a });

  if (demo) {
    const c1 = insert('contacts', { name: 'Laura Méndez', company: 'Escuela Los Pinos', email: 'laura@lospinos.edu', phone: '+1 305 555 0101', tags: ['escuela', 'cliente'], source: 'Referido' });
    const c2 = insert('contacts', { name: 'Carlos Rivera', company: 'Rivera Construction', email: 'carlos@riveracon.com', phone: '+1 305 555 0144', tags: ['corporativo'], source: 'Google Ads' });
    const c3 = insert('contacts', { name: 'Ana Torres', company: 'Gym FitZone', email: 'ana@fitzone.com', phone: '+1 786 555 0199', tags: ['gimnasio'], source: 'Instagram' });
    const c4 = insert('contacts', { name: 'Miguel Ángel Ruiz', company: 'Iglesia Vida Nueva', email: 'miguel@vidanueva.org', phone: '+1 954 555 0122', tags: ['iglesia'], source: 'Facebook' });
    insert('opportunities', { contact_id: c1, title: 'Uniformes fin de curso', value: 1850, stage: 'ganado' });
    insert('opportunities', { contact_id: c2, title: 'Polos bordados para cuadrilla', value: 2400, stage: 'cotizado' });
    insert('opportunities', { contact_id: c3, title: 'Merch gimnasio (hoodies + camisetas)', value: 3200, stage: 'negociacion' });
    insert('opportunities', { contact_id: c4, title: 'Camisetas retiro juvenil', value: 900, stage: 'nuevo' });
    insert('activities', { contact_id: c3, type: 'llamada', direction: 'saliente', body: 'Quiere 60 hoodies negros con logo al frente y espalda. Pide muestra.' });
    insert('activities', { contact_id: c2, type: 'email', direction: 'entrante', body: 'Necesitamos 40 polos navy con logo bordado en el pecho izquierdo.' });
    const today = new Date().toISOString().slice(0, 10);
    insert('tasks', { contact_id: c4, title: 'Llamar a Miguel para tallas del retiro', due_date: today });
  }
  return true;
}

if (isMain) {
  seedIfEmpty();
  console.log('Datos iniciales cargados');
  run('SELECT 1');
}
