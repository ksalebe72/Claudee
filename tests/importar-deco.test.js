// Importar clientes e historial de DecoNetwork (con un archivo inventado que imita el formato de Deco).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startServer } from './helpers.js';
import { fechaDeco, tallaDeco } from '../server/importar-deco.js';

const COLS = ['Order Number', 'Order Line Id', 'Date Ordered', 'Product Name', 'Product Code', 'Size', 'Color', 'SKU Qty', 'Line Qty', 'Unit Price', 'Line Total',
  'Discount', 'Tax', 'Order Total', 'Order Shipping Total', 'Decoration Process', 'Options', 'Supplier', 'Supplier Base Cost', 'Store Name', 'Company',
  'Billing First Name', 'Billing Last Name', 'Billing Email Address', 'Billing Address', 'Billing City', 'Billing State', 'Billing Postcode/zip', 'Billing Phone No.', 'Customer ID', 'Order Job Name', 'PO Number'];
const fila = (o) => COLS.map((c) => o[c] ?? null);
const base = { 'Store Name': 'Color Plus', 'Billing City': 'Rockville', 'Billing State': 'Maryland', 'Billing Postcode/zip': '20850' };
const FILAS = [
  // Orden 1001 · cliente A · una línea con dos tallas (Deco repite total, impuesto y cantidad de la línea en cada fila)
  { ...base, 'Order Number': 1001, 'Order Line Id': 11, 'Date Ordered': '24-Mar-26 12:19', 'Product Name': 'Polo bordado', 'Product Code': 'K500', Size: 'Medium', Color: 'Navy', 'SKU Qty': 5, 'Line Qty': 8, 'Unit Price': 30, 'Line Total': 240, Tax: 14.4, 'Order Total': 304.4, 'Order Shipping Total': 25, 'Decoration Process': 'EMB', Options: 'Logo Embroidery Left chest', Supplier: 'SanMar', 'Supplier Base Cost': 11.5, Company: 'Acme Gym', 'Billing First Name': 'Ana', 'Billing Last Name': 'Ruiz', 'Billing Email Address': 'ana@acme.com', 'Billing Address': '1 Main St', 'Billing Phone No.': '(301) 555-0101', 'Customer ID': 555, 'Order Job Name': 'Staff' },
  { ...base, 'Order Number': 1001, 'Order Line Id': 11, 'Date Ordered': '24-Mar-26 12:19', 'Product Name': 'Polo bordado', 'Product Code': 'K500', Size: 'Large', Color: 'Navy', 'SKU Qty': 3, 'Line Qty': 8, 'Unit Price': 30, 'Line Total': 240, Tax: 14.4, 'Order Total': 304.4, 'Order Shipping Total': 25, 'Decoration Process': 'EMB', Options: 'Logo Embroidery Left chest', Supplier: 'SanMar', 'Supplier Base Cost': 11.5, Company: 'Acme Gym', 'Billing First Name': 'Ana', 'Billing Last Name': 'Ruiz', 'Billing Email Address': 'ana@acme.com', 'Billing Address': '1 Main St', 'Billing Phone No.': '(301) 555-0101', 'Customer ID': 555 },
  { ...base, 'Order Number': 1001, 'Order Line Id': 12, 'Date Ordered': '24-Mar-26 12:19', 'Product Name': 'Digitizing Fee', 'SKU Qty': 1, 'Line Qty': 1, 'Unit Price': 25, 'Line Total': 25, Tax: 0, 'Order Total': 304.4, 'Order Shipping Total': 25, Company: 'Acme Gym', 'Billing First Name': 'Ana', 'Billing Last Name': 'Ruiz', 'Billing Email Address': 'ana@acme.com', 'Customer ID': 555 },
  // Orden 1002 · mismo cliente con la empresa escrita distinto
  { ...base, 'Order Number': 1002, 'Order Line Id': 21, 'Date Ordered': '10-Oct-26 09:00', 'Product Name': 'Tee DTF', 'Product Code': 'PC61', Size: 'X Large', Color: 'Black', 'SKU Qty': 10, 'Line Qty': 10, 'Unit Price': 12, 'Line Total': 120, Tax: 7.2, 'Order Total': 127.2, 'Order Shipping Total': 0, 'Decoration Process': 'TRF', Company: 'ACME GYM', 'Billing First Name': 'Ana', 'Billing Last Name': 'Ruiz', 'Billing Email Address': 'ana@acme.com', 'Customer ID': 555 },
  // Orden 2001 · cliente B (tienda guapos)
  { ...base, 'Store Name': 'guapos', 'Order Number': 2001, 'Order Line Id': 31, 'Date Ordered': '05-Nov-26 15:30', 'Product Name': 'Apron', Size: 'ONE SIZE', 'SKU Qty': 6, 'Line Qty': 6, 'Unit Price': 20, 'Line Total': 120, Tax: 0, 'Order Total': 120, 'Order Shipping Total': 0, Company: "Guapo's of Bethesda", 'Billing First Name': 'Luis', 'Billing Last Name': 'Paz', 'Billing Email Address': 'luis@guapos.com', 'Customer ID': 777 },
  // Guapo's Herndon: OTRO restaurante con el mismo email que Bethesda (lo maneja la misma persona) → cliente aparte
  { ...base, 'Store Name': 'guapos', 'Order Number': 2002, 'Order Line Id': 32, 'Date Ordered': '06-Nov-26 10:00', 'Product Name': 'Apron', Size: 'ONE SIZE', 'SKU Qty': 4, 'Line Qty': 4, 'Unit Price': 20, 'Line Total': 80, Tax: 0, 'Order Total': 80, 'Order Shipping Total': 0, Company: "Guapo's Charcoal & Taqueria Herndon", 'Billing First Name': 'Luis', 'Billing Last Name': 'Paz', 'Billing Email Address': 'luis@guapos.com', 'Customer ID': 888 },
  // Cliente C: otro Customer ID con el mismo email Y la misma empresa que A → es el mismo cliente
  { ...base, 'Order Number': 3001, 'Order Line Id': 41, 'Date Ordered': '01-Jun-26 10:00', 'Product Name': 'Gorra', 'SKU Qty': 4, 'Line Qty': 4, 'Unit Price': 15, 'Line Total': 60, Tax: 3.6, 'Order Total': 63.6, 'Order Shipping Total': 0, Company: 'Acme Gym', 'Billing First Name': 'Ana', 'Billing Last Name': 'Ruiz', 'Billing Email Address': 'ana@acme.com', 'Customer ID': 556 },
];

async function excel() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Resumen por cliente').addRow(['Cliente', 'Ventas']);
  const ws = wb.addWorksheet('Datos originales Deco');
  ws.addRow(COLS);
  for (const f of FILAS) ws.addRow(fila(f));
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')}`;
}
const csv = () => {
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return Buffer.from([COLS.join(','), ...FILAS.map((f) => fila(f).map(q).join(','))].join('\r\n')).toString('base64');
};

let s, archivo;
before(async () => { s = await startServer({ env: { SEED_DEMO: '0' } }); archivo = await excel(); });
after(() => s.stop());

test('lectura de fechas y tallas de Deco', () => {
  assert.equal(fechaDeco('24-Mar-26 12:19'), '2026-03-24 12:19:00');
  assert.equal(fechaDeco('01-Apr-26'), '2026-04-01 00:00:00');
  assert.equal(tallaDeco('X Large'), 'XL');
  assert.equal(tallaDeco('2X Large'), '2XL');
  assert.equal(tallaDeco('ONE SIZE'), 'OSFA');
  assert.equal(tallaDeco('24 x 18'), '24 X 18');
});

test('vista previa: cuenta bien (líneas una vez, clientes unidos) y no guarda nada', async () => {
  const v = await s.duena.post('/importar/deco/analizar', { archivo, nombre: 'deco.xlsx' });
  assert.equal(v.clientes, 3, 'A y C (misma empresa y email) → uno; Bethesda y Herndon (mismo email, distinto restaurante) → dos');
  assert.equal(v.clientesUnidos, 1);
  assert.equal(v.ordenes, 5);
  assert.equal(v.lineas, 6);
  assert.equal(v.ventas, 240 + 25 + 120 + 120 + 80 + 60, 'el total de la línea con dos tallas cuenta una vez');
  assert.equal(v.total, Math.round((304.4 + 127.2 + 120 + 80 + 63.6) * 100) / 100);
  assert.equal(v.desde, '2026-03-24');
  assert.equal((await s.duena.get('/contacts')).length, 0, 'la vista previa no guarda');
  const ventas = await s.userWithRole('ventas');
  assert.equal((await ventas.call('POST', '/importar/deco/analizar', { archivo, nombre: 'deco.xlsx' })).status, 403, 'solo el dueño');
  assert.equal((await s.duena.call('POST', '/importar/deco/analizar', { archivo: 'data:,' + Buffer.from('a,b\n1,2').toString('base64'), nombre: 'x.csv' })).status, 400, 'archivo que no es de Deco');
});

test('importar: crea clientes sin duplicar, guarda el historial y no se repite', async () => {
  const vend = await s.duena.get('/vendedores');
  const isabel = vend.find((v) => v.name === 'Isabel').id;
  const r = await s.duena.post('/importar/deco/confirmar', { archivo, nombre: 'deco.xlsx', salesperson_id: isabel });
  assert.deepEqual(r, { clientesCreados: 3, clientesActualizados: 0, ordenesImportadas: 5, ordenesOmitidas: 0, ordenesReasignadas: 0, lineas: 6 });
  const contactosTodos = await s.duena.get('/contacts');
  assert.ok(contactosTodos.find((c) => c.company === "Guapo's Charcoal & Taqueria Herndon"), 'Herndon es cliente aparte');
  const contactos = await s.duena.get('/contacts');
  const acme = contactos.find((c) => c.company === 'Acme Gym');
  assert.ok(acme, 'usa el nombre de empresa más frecuente');
  assert.equal(acme.email, 'ana@acme.com');
  assert.equal(acme.salesperson_id, isabel);
  assert.ok(acme.tags.includes('DecoNetwork'));
  assert.ok(contactos.find((c) => c.company === "Guapo's of Bethesda").tags.includes('guapos'), 'la tienda queda como etiqueta');

  const ficha = await s.duena.get(`/contacts/${acme.id}`);
  assert.equal(ficha.historial.length, 3);
  const o1001 = ficha.historial.find((o) => o.numero === '1001');
  const polo = o1001.lineas.find((l) => l.producto === 'Polo bordado');
  assert.deepEqual(polo.tallas, { M: 5, L: 3 });
  assert.equal(polo.cantidad, 8);
  assert.equal(o1001.total, 304.4);
  assert.equal(o1001.ventas, 265);

  // Volver a subir el mismo archivo (ahora en CSV) no duplica nada
  const r2 = await s.duena.post('/importar/deco/confirmar', { archivo: csv(), nombre: 'deco.csv' });
  assert.equal(r2.clientesCreados, 0);
  assert.equal(r2.ordenesImportadas, 0);
  assert.equal(r2.ordenesOmitidas, 5);
  const hist = await s.duena.get('/auditoria?area=clientes');
  assert.ok(hist.some((h) => h.field === 'importación DecoNetwork'));
});

test('el historial cuenta: cliente existente, bordado previo, tablero y permisos', async () => {
  const contactos = await s.duena.get('/contacts');
  const acme = contactos.find((c) => c.company === 'Acme Gym');
  const guapos = contactos.find((c) => c.company === "Guapo's of Bethesda");
  const prod = await s.duena.post('/products', { sku: 'T1', name: 'Tee', base_cost: 4, sizes: ['M'], colors: ['Black'] });
  const q = await s.duena.post('/jobs', { title: 'Nueva', contact_id: acme.id, items: [{ product_id: prod.id, sizes: { M: 10 } }] });
  assert.equal(q.client_status, 'existente', 'ya compró en Deco → existente (comisión de Isabel 5%)');
  const qg = await s.duena.post('/jobs', { title: 'Nueva', contact_id: guapos.id, items: [] });
  assert.equal(qg.client_status, 'existente');
  assert.equal((await s.duena.get(`/contacts/${acme.id}/bordado-previo`)).yaBordo, true, 'ya bordó en Deco');

  const t = await s.duena.get('/tablero?meses=12');
  assert.equal(t.kpis.historicas, 5);
  assert.equal(t.kpis.historicasTotal, 5);
  const res = await s.duena.get('/importar/deco/resumen');
  assert.equal(res.ordenes, 5);
  assert.ok(t.kpis.ventas >= 565);
  assert.ok(t.serie.ordenes.some((m) => m.historicas > 0));

  // Logística ve el historial sin montos; un vendedor solo el de sus clientes
  const logi = await s.userWithRole('logistica');
  const fichaL = await logi.get(`/contacts/${acme.id}`);
  assert.equal(fichaL.historial[0].total, undefined);
  const bryan = await s.userWithRole('ventas', (await s.duena.get('/vendedores')).find((v) => v.name === 'Bryan').id);
  assert.equal((await bryan.call('GET', `/contacts/${acme.id}`)).status, 404);
  assert.equal((await bryan.get('/tablero')).kpis.historicas, 0);
});

test('si una importación anterior unió dos restaurantes, volver a subir el archivo los separa', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { join } = await import('node:path');
  const db = new DatabaseSync(join(s.dir, 't.db'));
  // Simula el error anterior: la orden de Herndon quedó en el cliente Bethesda y Herndon no existe
  const beth = db.prepare("SELECT id FROM contacts WHERE deco_customer_id = '777'").get().id;
  const hern = db.prepare("SELECT id FROM contacts WHERE deco_customer_id = '888'").get().id;
  db.prepare("UPDATE historial_ordenes SET contact_id = ? WHERE numero = '2002'").run(beth);
  db.prepare('DELETE FROM contacts WHERE id = ?').run(hern);
  db.close();
  const v = await s.duena.post('/importar/deco/analizar', { archivo, nombre: 'deco.xlsx' });
  assert.equal(v.ordenesAReasignar, 1);
  const r = await s.duena.post('/importar/deco/confirmar', { archivo, nombre: 'deco.xlsx' });
  assert.equal(r.clientesCreados, 1, 'vuelve a crear Herndon');
  assert.equal(r.ordenesReasignadas, 1, 'y le devuelve su orden');
  const herndon = (await s.duena.get('/contacts')).find((c) => c.company === "Guapo's Charcoal & Taqueria Herndon");
  const ficha = await s.duena.get(`/contacts/${herndon.id}`);
  assert.deepEqual(ficha.historial.map((o) => o.numero), ['2002']);
  const fichaB = await s.duena.get(`/contacts/${beth}`);
  assert.deepEqual(fichaB.historial.map((o) => o.numero), ['2001'], 'Bethesda queda solo con lo suyo');
});

test('vendedor por empresa: los Guapo\'s son de Karol, con sus órdenes de Deco, y el reporte histórico es solo informativo', async () => {
  const vend = await s.duena.get('/vendedores');
  const karol = vend.find((v) => v.name === 'Karol');
  assert.ok(karol, 'Karol se crea al arrancar');
  const reglas = await s.duena.get('/importar/deco/reglas');
  assert.deepEqual(reglas.map((r) => [r.texto, r.vendedor]), [['guapo', 'Karol']]);
  const contactos = await s.duena.get('/contacts');
  const guapos = contactos.filter((c) => /guapo/i.test(c.company || ''));
  assert.equal(guapos.length, 2);
  assert.ok(guapos.every((c) => c.salesperson_id === karol.id), 'los Guapo\'s importados quedan con Karol');

  const rep = await s.duena.get('/reportes/comisiones-deco?desde=2026-01-01&hasta=2026-12-31');
  assert.equal(rep.informativo, true);
  const deKarol = rep.filas.filter((f) => f.vendedor === 'Karol');
  assert.equal(deKarol.reduce((a, f) => a + f.ordenes, 0), 2);
  assert.equal(karol.es_dueno, 1, 'Karol es el dueño');
  assert.equal(deKarol.reduce((a, f) => a + f.comision, 0), 0, 'el dueño no cobra comisión');
  assert.ok(deKarol.every((f) => f.pendientes === 0 && f.reglas.includes('Dueño · sin comisión')), 'cuentas de la casa: nada queda pendiente');
  const liq = await s.duena.get('/liquidaciones');
  assert.ok(!liq.vendedores.some((x) => x.vendedor?.name === 'Karol' || x.nombre === 'Karol' || x.name === 'Karol'), 'el dueño no aparece en liquidaciones');

  // Asignar Acme a Bryan: sus órdenes de Deco pasan a Bryan y usan la regla que tenía en esa fecha (25% de la venta,
  // antes del cambio a 40% de la utilidad)
  const bryan = vend.find((v) => v.name === 'Bryan');
  const r = await s.duena.post('/importar/deco/asignar-vendedor', { texto: 'acme', salesperson_id: bryan.id });
  assert.equal(r.clientes, 1);
  assert.equal(r.ordenesDeco, 3);
  const rep2 = await s.duena.get('/reportes/comisiones-deco');
  const deBryan = rep2.filas.filter((f) => f.vendedor === 'Bryan');
  assert.equal(deBryan.reduce((a, f) => a + f.ordenes, 0), 3);
  assert.equal(Math.round(deBryan.reduce((a, f) => a + f.comision, 0) * 100) / 100, Math.round((240 + 25 + 120 + 60) * 0.25 * 100) / 100);
  assert.ok(deBryan.every((f) => f.reglas.includes('Bryan · Ventas 25%')));

  // No entra a liquidaciones, y un vendedor no ve este reporte
  const v = await s.userWithRole('ventas', bryan.id);
  assert.equal((await v.call('GET', '/reportes/comisiones-deco')).status, 403);
  assert.equal((await v.call('POST', '/importar/deco/asignar-vendedor', { texto: 'acme', salesperson_id: karol.id })).status, 403);
});

test('alerta de clientes sin comprar: cuenta las compras de Deco, respeta los días de Ajustes y el alcance de cada rol', async () => {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const dias = (f) => Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000);
  // Últimas compras del archivo de prueba: Acme 2026-10-10, Bethesda 2026-11-05, Herndon 2026-11-06
  const ultimas = { 'Acme Gym': '2026-10-10', "Guapo's of Bethesda": '2026-11-05', "Guapo's Charcoal & Taqueria Herndon": '2026-11-06' };
  await s.duena.put('/settings', { dias_cliente_inactivo: 15 });
  const esperados = Object.entries(ultimas).filter(([, f]) => dias(f) > 15).map(([c]) => c).sort();
  const r = await s.duena.get('/clientes-inactivos');
  assert.equal(r.dias, 15);
  assert.deepEqual(r.lista.map((c) => c.cliente).sort(), esperados);
  const t = await s.duena.get('/tablero');
  assert.equal(t.avisos.find((a) => a.clave === 'inactivos').n, esperados.length);
  assert.equal(t.inactivos.total, esperados.length);

  await s.duena.put('/settings', { dias_cliente_inactivo: 730 });
  assert.equal((await s.duena.get('/clientes-inactivos')).lista.length, 0);
  assert.equal((await s.duena.call('PUT', '/settings', { dias_cliente_inactivo: 3 })).status, 400);

  // Logística no ve montos ni la tarjeta; un vendedor solo sus clientes
  await s.duena.put('/settings', { dias_cliente_inactivo: 15 });
  const logi = await s.userWithRole('logistica');
  assert.equal((await logi.get('/tablero')).inactivos, null);
  assert.equal((await logi.call('GET', '/clientes-inactivos')).status, 403, 'Logística no maneja clientes');
  const karol = (await s.duena.get('/vendedores')).find((v) => v.name === 'Karol');
  const v = await s.userWithRole('ventas', karol.id);
  assert.ok((await v.get('/clientes-inactivos')).lista.every((c) => /guapo/i.test(c.cliente)));
  await s.duena.put('/settings', { dias_cliente_inactivo: 90 });
});
