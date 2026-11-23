// Importar clientes y su historial de compras desde DecoNetwork.
// Acepta el Excel (.xlsx; usa la hoja con «Order Number» y «Customer ID», p. ej. «Datos originales Deco»)
// o la exportación CSV de órdenes de Deco con esas mismas columnas.
// 1) analizar(): vista previa, no guarda nada.  2) importar(): crea/actualiza clientes y guarda el historial.
// No duplica: un cliente por Customer ID (o el que ya exista con ese email o empresa) y cada orden una sola vez.
import ExcelJS from 'exceljs';
import { all, get, insert, run, transaction } from './db.js';
import { audit } from './config.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const num = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
const norm = (v) => txt(v).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

const MESES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** «24-Mar-26 12:19» → «2026-03-24 12:19:00». También acepta fechas de Excel y formatos ISO. */
export function fechaDeco(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 19).replace('T', ' ');
  const s = txt(v);
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m && MESES[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const p = (x) => String(x).padStart(2, '0');
    return `${y}-${p(MESES[m[2].toLowerCase()])}-${p(m[1])} ${p(m[4] || 0)}:${p(m[5] || 0)}:00`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

const TALLAS = { small: 'S', medium: 'M', large: 'L', 'x large': 'XL', 'x-large': 'XL', xlarge: 'XL', '2x large': '2XL', '2x-large': '2XL', xxl: '2XL', '3x large': '3XL', '3x-large': '3XL', xxxl: '3XL', '4x large': '4XL', '5x large': '5XL', 'x small': 'XS', xsmall: 'XS', 'xx small': 'XXS', 'one size': 'OSFA' };
export const tallaDeco = (v) => { const t = norm(v); return t ? TALLAS[t] || txt(v).toUpperCase() : null; };

// ---------- lectura del archivo ----------
function parseCsv(texto) {
  const filas = []; let fila = []; let campo = ''; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = ''; if (fila.some((x) => x !== '')) filas.push(fila); fila = [];
    } else campo += c;
  }
  fila.push(campo); if (fila.some((x) => x !== '')) filas.push(fila);
  return filas;
}
const aObjetos = (filas) => { const [h, ...resto] = filas; const H = h.map((x) => txt(x)); return resto.map((f) => Object.fromEntries(H.map((k, i) => [k, f[i] ?? null]))); };

/** Lee el archivo (data URL o base64) y devuelve las filas de órdenes de Deco. */
export async function leerArchivo(archivo, nombre = '') {
  const b64 = String(archivo || '').replace(/^data:[^,]*,/, '');
  if (!b64) throw fail(400, 'Sube el archivo exportado de DecoNetwork.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 25 * 1024 * 1024) throw fail(400, 'El archivo es muy grande (máximo 25 MB).');
  let filas;
  if (/\.csv$/i.test(nombre) || buf.subarray(0, 2).toString() !== 'PK') {
    filas = aObjetos(parseCsv(buf.toString('utf8').replace(/^﻿/, '')));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const hojas = wb.worksheets.map((ws) => {
      const valores = [];
      ws.eachRow({ includeEmpty: false }, (row) => valores.push(row.values.slice(1).map((v) => (v && typeof v === 'object' && !(v instanceof Date) ? v.text ?? v.result ?? v.richText?.map((t) => t.text).join('') ?? '' : v))));
      return { nombre: ws.name, valores };
    });
    const hoja = hojas.find((h) => /datos originales/i.test(h.nombre) && h.valores[0]?.includes('Order Number'))
      || hojas.find((h) => h.valores[0]?.includes('Order Number') && h.valores[0]?.includes('Customer ID'));
    if (!hoja) throw fail(400, 'No encontré la hoja con los datos de DecoNetwork (columnas «Order Number» y «Customer ID»).');
    filas = aObjetos(hoja.valores);
  }
  const faltan = ['Order Number', 'Customer ID'].filter((c) => !(filas[0] && c in filas[0]));
  if (faltan.length) throw fail(400, `Al archivo le faltan columnas de DecoNetwork: ${faltan.join(', ')}.`);
  return filas.filter((f) => txt(f['Order Number']));
}

// ---------- armado de clientes y órdenes ----------
function masFrecuente(valores) {
  const c = new Map();
  for (const v of valores.map(txt).filter(Boolean)) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

export function armar(filas) {
  const clientes = new Map();
  const ordenes = new Map();
  for (const f of filas) {
    const cid = txt(f['Customer ID']) || `email:${norm(f['Billing Email Address'])}`;
    if (!clientes.has(cid)) clientes.set(cid, { cid, filas: [] });
    clientes.get(cid).filas.push(f);
    const num_ = txt(f['Order Number']);
    if (!ordenes.has(num_)) ordenes.set(num_, { numero: num_, cid, filas: [] });
    ordenes.get(num_).filas.push(f);
  }
  const listaClientes = [...clientes.values()].map(({ cid, filas: fs }) => {
    const nombre = masFrecuente(fs.map((f) => `${txt(f['Billing First Name'])} ${txt(f['Billing Last Name'])}`.trim()));
    const empresa = masFrecuente(fs.map((f) => f.Company || f['Shipping Company']));
    const dir = masFrecuente(fs.map((f) => [txt(f['Billing Address']), txt(f['Billing City']), [txt(f['Billing State']), txt(f['Billing Postcode/zip'])].filter(Boolean).join(' ')].filter(Boolean).join(', ')));
    const variantes = [...new Set(fs.map((f) => txt(f.Company)).filter(Boolean))].filter((v) => v !== empresa);
    return {
      cid: cid.startsWith('email:') ? null : cid, name: nombre || empresa || 'Cliente DecoNetwork', company: empresa || null,
      email: masFrecuente(fs.map((f) => f['Billing Email Address'])).toLowerCase() || null,
      phone: masFrecuente(fs.map((f) => f['Billing Phone No.'])) || null, address: dir || null,
      tiendas: [...new Set(fs.map((f) => txt(f['Store Name'])).filter(Boolean))],
      notas: variantes.length ? `En DecoNetwork también aparece como: ${variantes.join(' · ')}` : '',
    };
  });
  const listaOrdenes = [...ordenes.values()].map(({ numero, cid, filas: fs }) => {
    const f0 = fs[0];
    // Deco trae una fila por talla; el total, el impuesto y la cantidad de la línea se repiten en cada fila
    // de la misma «Order Line Id». Se cuentan una vez y la cantidad de cada talla sale de «SKU Qty».
    const grupos = new Map();
    for (const f of fs) {
      const clave = txt(f['Order Line Id']) || [txt(f['Product Name']), txt(f['Product Code']), txt(f.Color), num(f['Unit Price']), txt(f['Decoration Process'])].join('|');
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          producto: txt(f['Product Name']), codigo: txt(f['Product Code']) || null, color: txt(f.Color) || null, tallas: {},
          cantidad: num(f['Line Qty']) || 0, precio_unitario: r2(num(f['Unit Price'])), descuento: r2(num(f.Discount)),
          total: r2(num(f['Line Total'])), impuesto: r2(num(f.Tax)),
          decoracion: [txt(f['Decoration Process']), txt(f.Options)].filter(Boolean).join(' · ') || null,
          proveedor: txt(f.Supplier) || null, costo_proveedor: num(f['Supplier Base Cost']) || null, _sumaTallas: 0,
        });
      }
      const g = grupos.get(clave);
      const q = num(f['SKU Qty']) || (txt(f['Order Line Id']) ? 0 : num(f['Line Qty']));
      const t = tallaDeco(f.Size);
      if (t) g.tallas[t] = (g.tallas[t] || 0) + q;
      g._sumaTallas += q;
      if (!txt(f['Order Line Id'])) { g.cantidad = g._sumaTallas; }
    }
    for (const g of grupos.values()) { if (!g.cantidad) g.cantidad = g._sumaTallas; delete g._sumaTallas; }
    const lineas = [...grupos.values()];
    const ventas = r2(lineas.reduce((a, l) => a + l.total, 0));
    const impuesto = r2(lineas.reduce((a, l) => a + l.impuesto, 0));
    return {
      numero, cid, fecha: fechaDeco(f0['Date Ordered']), tienda: txt(f0['Store Name']) || null,
      po: [txt(f0['Supplier PO Number']), txt(f0['PO Number'])].filter(Boolean).join(' · ') || null, trabajo: txt(f0['Order Job Name']) || txt(f0['PO Number']) || null,
      ventas, envio: r2(num(f0['Order Shipping Total'])), impuesto, total: r2(num(f0['Order Total']) || ventas + impuesto + num(f0['Order Shipping Total'])),
      unidades: lineas.reduce((a, l) => a + l.cantidad, 0), lineas,
    };
  });
  return { clientes: listaClientes, ordenes: listaOrdenes };
}

const claveCliente = (c) => c.cid || `email:${c.email || ''}`;

/** Empresa normalizada para comparar («Guapo’s of Bethesda» = «guapos of bethesda»). */
const empresaNorm = (v) => norm(v).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Busca si el cliente ya existe en la app. Cada Customer ID de Deco es un cliente distinto:
 * un email compartido NO basta (la misma persona puede manejar varios restaurantes).
 * 1) mismo Customer ID · 2) misma empresa (y mismo email si ambos lo tienen), siempre que ese contacto
 *    no pertenezca ya a otro Customer ID de Deco.
 */
function clienteExistente(c) {
  if (c.cid) { const porId = get('SELECT * FROM contacts WHERE deco_customer_id = ?', c.cid); if (porId) return porId; }
  const emp = empresaNorm(c.company);
  if (!emp) return null;
  const candidatos = all('SELECT * FROM contacts WHERE company IS NOT NULL');
  return candidatos.find((x) => empresaNorm(x.company) === emp
    && (!x.email || !c.email || x.email.toLowerCase() === c.email)
    // si ese contacto ya es de otro Customer ID, solo se une si además comparten email (misma empresa y mismo contacto)
    && (!x.deco_customer_id || x.deco_customer_id === c.cid || (x.email && c.email && x.email.toLowerCase() === c.email))) || null;
}

/** Vista previa: no guarda nada. */
export async function analizar(archivo, nombre) {
  const filas = await leerArchivo(archivo, nombre);
  const { clientes, ordenes } = armar(filas);
  const existentes = clientes.filter(clienteExistente);
  // Clientes del archivo que son el mismo: solo si es la misma empresa (un email compartido no basta)
  const vistos = new Map(); let unidos = 0;
  for (const c of clientes) {
    const emp = empresaNorm(c.company);
    if (!emp) continue;
    const previo = vistos.get(emp);
    if (previo !== undefined && (!previo || !c.email || previo === c.email)) unidos++;
    else vistos.set(emp, c.email || null);
  }
  const ya = ordenes.filter((o) => get("SELECT id FROM historial_ordenes WHERE origen = 'DecoNetwork' AND numero = ?", o.numero));
  // Órdenes ya importadas que quedaron en el cliente equivocado (p. ej. unidas antes por email): se corrigen al importar
  const porClave = new Map(clientes.map((c) => [claveCliente(c), c]));
  const aReasignar = ya.filter((o) => {
    const h = get("SELECT o.contact_id, c.deco_customer_id FROM historial_ordenes o LEFT JOIN contacts c ON c.id = o.contact_id WHERE o.origen = 'DecoNetwork' AND o.numero = ?", o.numero);
    const cli = porClave.get(o.cid);
    if (!h || !cli) return false;
    const destino = clienteExistente(cli);
    return destino ? destino.id !== h.contact_id : true; // si el cliente correcto no existe aún, se crea y se mueve
  }).length;
  const fechas = ordenes.map((o) => o.fecha).filter(Boolean).sort();
  return {
    filas: filas.length,
    clientes: clientes.length - unidos, clientesUnidos: unidos, clientesNuevos: Math.max(0, clientes.length - unidos - existentes.length), clientesExistentes: existentes.length,
    ordenes: ordenes.length, ordenesNuevas: ordenes.length - ya.length, ordenesYaImportadas: ya.length, ordenesAReasignar: aReasignar,
    lineas: ordenes.reduce((a, o) => a + o.lineas.length, 0),
    ventas: r2(ordenes.reduce((a, o) => a + o.ventas, 0)), total: r2(ordenes.reduce((a, o) => a + o.total, 0)),
    desde: fechas[0]?.slice(0, 10) || null, hasta: fechas.at(-1)?.slice(0, 10) || null,
    tiendas: [...new Set(ordenes.map((o) => o.tienda).filter(Boolean))],
    muestra: clientes.slice(0, 12).map((c) => ({ nombre: c.name, empresa: c.company, email: c.email, existe: !!clienteExistente(c), ordenes: ordenes.filter((o) => o.cid === claveCliente(c)).length })),
  };
}

/** Importa: crea clientes que no existen (sin pisar datos de los que ya existen) y guarda el historial. */
export async function importar(archivo, nombre, { salesperson_id } = {}, user) {
  const filas = await leerArchivo(archivo, nombre);
  const { clientes, ordenes } = armar(filas);
  const sp = salesperson_id ? Number(salesperson_id) : null;
  const res = { clientesCreados: 0, clientesActualizados: 0, ordenesImportadas: 0, ordenesOmitidas: 0, ordenesReasignadas: 0, lineas: 0 };
  transaction(() => {
    const idPorCid = new Map();
    for (const c of clientes) {
      const ex = clienteExistente(c);
      if (ex) {
        // Solo completa lo que esté vacío: nunca pisa lo que ya se editó en la app
        const cambios = {};
        for (const k of ['email', 'phone', 'company', 'address']) if (!ex[k] && c[k]) cambios[k] = c[k];
        if (c.cid && !ex.deco_customer_id) cambios.deco_customer_id = c.cid;
        if (Object.keys(cambios).length) { const sets = Object.keys(cambios).map((k) => `${k} = ?`).join(', '); run(`UPDATE contacts SET ${sets} WHERE id = ?`, ...Object.values(cambios), ex.id); res.clientesActualizados++; }
        idPorCid.set(claveCliente(c), ex.id);
      } else {
        const id = insert('contacts', {
          name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address,
          tags: ['DecoNetwork', ...c.tiendas.filter((t) => norm(t) !== 'color plus')], source: 'DecoNetwork', notes: c.notas,
          deco_customer_id: c.cid, salesperson_id: sp, idioma: 'es',
        });
        idPorCid.set(claveCliente(c), id);
        res.clientesCreados++;
      }
    }
    for (const o of ordenes) {
      const contactId = idPorCid.get(o.cid);
      const yaEsta = get("SELECT id, contact_id FROM historial_ordenes WHERE origen = 'DecoNetwork' AND numero = ?", o.numero);
      if (yaEsta) {
        // Ya estaba: si quedó en otro cliente (error anterior), se pasa al cliente correcto
        if (contactId && yaEsta.contact_id !== contactId) { run('UPDATE historial_ordenes SET contact_id = ? WHERE id = ?', contactId, yaEsta.id); res.ordenesReasignadas++; }
        else res.ordenesOmitidas++;
        continue;
      }
      const id = insert('historial_ordenes', {
        contact_id: contactId ?? null, origen: 'DecoNetwork', numero: o.numero, fecha: o.fecha, tienda: o.tienda, po: o.po, trabajo: o.trabajo,
        ventas: o.ventas, envio: o.envio, impuesto: o.impuesto, total: o.total, unidades: o.unidades, importado_por: user?.name || null,
      });
      for (const l of o.lineas) { insert('historial_lineas', { orden_id: id, ...l }); res.lineas++; }
      res.ordenesImportadas++;
    }
  });
  audit(user, 'clientes', 'importación DecoNetwork', null, res, nombre || null);
  return res;
}

/** Historial de un cliente (para su ficha). */
export function historialCliente(contactId, { conMontos = true } = {}) {
  const ordenes = all('SELECT * FROM historial_ordenes WHERE contact_id = ? ORDER BY fecha DESC', contactId);
  return ordenes.map((o) => {
    const lineas = all('SELECT producto, codigo, color, tallas, cantidad, precio_unitario, total, decoracion FROM historial_lineas WHERE orden_id = ? ORDER BY id', o.id);
    const base = { id: o.id, origen: o.origen, numero: o.numero, fecha: o.fecha, tienda: o.tienda, trabajo: o.trabajo, unidades: o.unidades };
    return conMontos ? { ...base, ventas: o.ventas, envio: o.envio, impuesto: o.impuesto, total: o.total, lineas } : { ...base, lineas: lineas.map(({ precio_unitario: _p, total: _t, ...l }) => l) };
  });
}
