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
  // Cliente C: otro Customer ID con el mismo email que A → se une a A
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
  assert.equal(v.clientes, 2, 'A y C comparten email → un cliente');
  assert.equal(v.clientesUnidos, 1);
  assert.equal(v.ordenes, 4);
  assert.equal(v.lineas, 5);
  assert.equal(v.ventas, 240 + 25 + 120 + 120 + 60, 'el total de la línea con dos tallas cuenta una vez');
  assert.equal(v.total, Math.round((304.4 + 127.2 + 120 + 63.6) * 100) / 100);
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
  assert.deepEqual(r, { clientesCreados: 2, clientesActualizados: 0, ordenesImportadas: 4, ordenesOmitidas: 0, lineas: 5 });
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
  assert.equal(r2.ordenesOmitidas, 4);
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
  assert.equal(t.kpis.historicas, 4);
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
