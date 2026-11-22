// Cliente de solo lectura para SanMar Web Services.
// No crea órdenes ni envía datos a SanMar: solo consulta producto, precios e inventario.
//
// Uso:
//   import { createSanmarClient } from './services/sanmar/index.js';
//   const sanmar = createSanmarClient();            // lee SANMAR_* del entorno
//   await sanmar.buscarEstilo('PC61');
//
// La caché es intercambiable: cualquier objeto con get(key) y set(key, value, ttlSegundos)
// (pueden ser async). Por defecto se guarda en memoria.
import { find, findAll, findRecords, childNames, textOf, numberOf, structure } from './xml.js';
import { llamarSoap, campos, SERVICIOS, BASE_URL_PRODUCCION } from './soap.js';
import { SanmarError, CODIGOS } from './errors.js';

export { SanmarError, CODIGOS } from './errors.js';

export const TTL_SEGUNDOS = {
  producto: 24 * 3600,
  fotos: 24 * 3600,
  precios: 12 * 3600,
  inventario: 15 * 60,
};

export class MemoryCache {
  constructor() { this.map = new Map(); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expira < Date.now()) { this.map.delete(key); return undefined; }
    return e.valor;
  }
  set(key, valor, ttl) { this.map.set(key, { valor, expira: Date.now() + ttl * 1000 }); }
}

// ---------- normalización ----------
const ORDEN_TALLAS = ['NB', '06M', '12M', '18M', '24M', '2T', '3T', '4T', '5T', '5/6', '6T', '7', 'XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL', 'XL', '2XL', 'XXL', '3XL', '4XL', '5XL', '6XL', 'LT', 'XLT', '2XLT', '3XLT', '4XLT', 'OSFA'];
const rangoTalla = (t) => { const i = ORDEN_TALLAS.indexOf(String(t).toUpperCase()); return i < 0 ? 500 : i; };
export const ordenarTallas = (tallas) => [...new Set(tallas)].sort((a, b) => rangoTalla(a) - rangoTalla(b) || String(a).localeCompare(String(b)));

const limpiarHtml = (s) => (s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);
const url = (v) => (v && /^https?:\/\//i.test(v) ? v : null);
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** getProductInfoByStyleColorSize → { estilo, marca, descripcion, colores:[...], tallas:[...] } */
export function normalizarProducto(estilo, doc) {
  const filas = findAll(doc, 'listResponse');
  if (!filas.length) throw new SanmarError(CODIGOS.NO_ENCONTRADO, `SanMar no tiene el estilo ${estilo}.`);

  const primero = find(filas[0], 'productBasicInfo') || filas[0];
  const colores = new Map();
  const tallasEstilo = [];

  for (const fila of filas) {
    const b = find(fila, 'productBasicInfo') || fila;
    const img = find(fila, 'productImageInfo') || fila;
    const nombre = textOf(b, 'catalogColor', 'colorName', 'color');
    const codigo = textOf(b, 'color') || nombre;
    const talla = textOf(b, 'size');
    if (talla) tallasEstilo.push(talla);
    if (!nombre) continue;
    const clave = norm(codigo);
    if (!colores.has(clave)) {
      const modelo = { frente: url(textOf(img, 'frontModel')), espalda: url(textOf(img, 'backModel')), lado: url(textOf(img, 'sideModel')), tresCuartos: url(textOf(img, 'threeQModel')) };
      const plana = { frente: url(textOf(img, 'frontFlat')), espalda: url(textOf(img, 'backFlat')) };
      const producto = url(textOf(img, 'colorProductImage', 'productImage'));
      colores.set(clave, {
        nombre,
        codigo,
        swatch: url(textOf(img, 'colorSwatchImage', 'colorSquareImage')),
        fotos: {
          frente: plana.frente || modelo.frente || producto,
          espalda: plana.espalda || modelo.espalda,
          lado: modelo.lado || modelo.tresCuartos,
          plana,
          modelo,
          producto,
        },
        tallas: [],
      });
    }
    if (talla) colores.get(clave).tallas.push(talla);
  }

  for (const c of colores.values()) c.tallas = ordenarTallas(c.tallas);
  return {
    estilo: textOf(primero, 'style') || estilo,
    marca: textOf(primero, 'brandName'),
    titulo: textOf(primero, 'productTitle'),
    descripcion: limpiarHtml(textOf(primero, 'productDescription')),
    peso: numberOf(primero, 'pieceWeight'),
    estado: textOf(primero, 'productStatus'),
    colores: [...colores.values()],
    tallas: ordenarTallas(tallasEstilo),
  };
}

/** getPricing → [{ talla, codigoColor, costo, fuenteCosto, precioLista, precioCaja, ... }] */
export function normalizarPrecios(doc) {
  const PRECIOS = ['myPrice', 'piecePrice', 'casePrice', 'dozenPrice', 'pieceSalePrice', 'caseSalePrice'];
  const registros = findRecords(doc, (n) => {
    const h = childNames(n);
    return h.has('size') && PRECIOS.some((p) => h.has(p));
  });
  return registros.map((r) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const ini = textOf(r, 'saleStartDate');
    const fin = textOf(r, 'saleEndDate');
    const enOferta = ini && fin && ini.slice(0, 10) <= hoy && hoy <= fin.slice(0, 10);
    // Costo de la cuenta: myPrice (precio del cliente). Si no viene, se usa el mejor precio disponible y se indica cuál.
    const candidatos = [['myPrice', numberOf(r, 'myPrice')], ...(enOferta ? [['caseSalePrice', numberOf(r, 'caseSalePrice')]] : []), ['casePrice', numberOf(r, 'casePrice')], ['piecePrice', numberOf(r, 'piecePrice')]];
    const [fuenteCosto, costo] = candidatos.find(([, v]) => v != null && v > 0) || [null, null];
    return {
      talla: textOf(r, 'size'),
      codigoColor: textOf(r, 'color'),
      costo,
      fuenteCosto,
      precioLista: numberOf(r, 'piecePrice'),
      precioDocena: numberOf(r, 'dozenPrice'),
      precioCaja: numberOf(r, 'casePrice'),
      oferta: enOferta ? { precio: numberOf(r, 'pieceSalePrice', 'caseSalePrice'), hasta: fin } : null,
    };
  });
}

/** getInventoryQtyForStyleColorSize → { total, almacenes: [{ id, nombre, cantidad }] } */
export function normalizarInventario(doc) {
  // Forma 1: registros por almacén con nombre/id y cantidad.
  const porAlmacen = findRecords(doc, (n) => {
    const h = childNames(n);
    return (h.has('whseName') || h.has('whseID') || h.has('warehouseName') || h.has('warehouseId')) && (h.has('qty') || h.has('quantity') || h.has('qtyAvailable'));
  });
  if (porAlmacen.length) {
    const almacenes = porAlmacen.map((w) => ({
      id: textOf(w, 'whseID', 'warehouseId'),
      nombre: textOf(w, 'whseName', 'warehouseName') || `Almacén ${textOf(w, 'whseID', 'warehouseId')}`,
      cantidad: numberOf(w, 'qty', 'quantity', 'qtyAvailable') ?? 0,
    }));
    const totalExplicito = numberOf(doc, 'totalQty', 'totalQuantity');
    return { total: totalExplicito ?? almacenes.reduce((a, w) => a + w.cantidad, 0), almacenes };
  }
  // Forma 2: lista de cantidades numéricas (una por almacén, en el orden de SanMar).
  const numeros = findAll(doc, 'listResponse').map((n) => (n.children.length ? null : Number(n.text.trim()))).filter((n) => Number.isFinite(n));
  if (numeros.length) {
    return { total: numeros.reduce((a, b) => a + b, 0), almacenes: numeros.map((cantidad, i) => ({ id: String(i + 1), nombre: `Almacén ${i + 1}`, cantidad })) };
  }
  // Forma 3: solo un total.
  const total = numberOf(doc, 'totalQty', 'totalQuantity', 'qty', 'quantity');
  if (total != null) return { total, almacenes: [] };
  throw new SanmarError(CODIGOS.RESPUESTA_INVALIDA, 'No se reconoció el formato de inventario de SanMar. Usa el diagnóstico para ver la estructura.', { detalle: structure(doc).slice(0, 60).join('\n') });
}

// ---------- cliente ----------
export function createSanmarClient(opciones = {}) {
  const env = opciones.env || process.env;
  const creds = {
    customerNumber: opciones.customerNumber ?? env.SANMAR_CUSTOMER_NUMBER,
    username: opciones.username ?? env.SANMAR_USERNAME,
    password: opciones.password ?? env.SANMAR_PASSWORD,
  };
  const baseUrl = opciones.baseUrl || env.SANMAR_BASE_URL || BASE_URL_PRODUCCION;
  const cache = opciones.cache || new MemoryCache();
  const ttl = { ...TTL_SEGUNDOS, ...(opciones.ttl || {}) };
  const enCurso = new Map(); // evita llamadas duplicadas simultáneas

  const configurado = () => !!(creds.customerNumber && creds.username && creds.password);

  async function llamar(servicio, operacion, cuerpo) {
    if (!configurado()) throw new SanmarError(CODIGOS.NO_CONFIGURADO, 'Faltan SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME o SANMAR_PASSWORD en el entorno.');
    return llamarSoap({
      baseUrl, servicio: SERVICIOS[servicio], operacion, cuerpo, creds,
      timeoutMs: opciones.timeoutMs ?? 20000, reintentos: opciones.reintentos ?? 3,
      fetchImpl: opciones.fetchImpl, sleep: opciones.sleep, onRespuesta: opciones.onRespuesta,
    });
  }

  async function conCache(clave, segundos, fn) {
    const hit = await cache.get(clave);
    if (hit !== undefined && hit !== null) return hit;
    if (enCurso.has(clave)) return enCurso.get(clave);
    const p = (async () => {
      try {
        const v = await fn();
        await cache.set(clave, v, segundos);
        return v;
      } finally { enCurso.delete(clave); }
    })();
    enCurso.set(clave, p);
    return p;
  }

  // Bloque de credenciales de los servicios de producto y precios (arg1).
  const credsArg1 = () => `<arg1>${campos({ sanMarCustomerNumber: creds.customerNumber, sanMarUserName: creds.username, sanMarUserPassword: creds.password })}</arg1>`;
  const E = (s) => String(s ?? '').trim().toUpperCase();

  async function buscarEstilo(estilo) {
    const est = E(estilo);
    if (!est) throw new SanmarError(CODIGOS.NO_ENCONTRADO, 'Indica un estilo (ej. PC61).');
    return conCache(`sanmar:producto:${est}`, ttl.producto, async () => {
      const doc = await llamar('producto', 'getProductInfoByStyleColorSize', `<arg0>${campos({ color: '', size: '', style: est })}</arg0>${credsArg1()}`);
      return normalizarProducto(est, doc);
    });
  }

  async function obtenerColores(estilo) {
    return (await buscarEstilo(estilo)).colores;
  }

  async function resolverColor(estilo, color) {
    const producto = await buscarEstilo(estilo);
    const c = norm(color);
    const encontrado = producto.colores.find((x) => norm(x.nombre) === c || norm(x.codigo) === c);
    if (!encontrado) throw new SanmarError(CODIGOS.NO_ENCONTRADO, `El estilo ${producto.estilo} no tiene el color «${color}».`);
    return { producto, color: encontrado };
  }

  async function obtenerFotos(estilo, color) {
    const { producto, color: c } = await resolverColor(estilo, color);
    return conCache(`sanmar:fotos:${producto.estilo}:${norm(c.codigo)}`, ttl.fotos, async () => ({ swatch: c.swatch, ...c.fotos }));
  }

  /** Precios de un estilo (y opcionalmente un color). Prueba primero con el código de color y luego con el nombre. */
  async function obtenerPrecios(estilo, color = '') {
    const est = E(estilo);
    const variantes = color ? [...new Set([color.codigo, color.nombre].filter(Boolean))] : [''];
    return conCache(`sanmar:precios:${est}:${norm(variantes[0])}`, ttl.precios, async () => {
      let ultimo;
      for (const v of variantes) {
        try {
          const doc = await llamar('precios', 'getPricing', `<arg0>${campos({ style: est, color: v, size: '', inventoryKey: '', sizeIndex: '' })}</arg0>${credsArg1()}`);
          const filas = normalizarPrecios(doc);
          if (filas.length) return filas;
          ultimo = new SanmarError(CODIGOS.NO_ENCONTRADO, `SanMar no devolvió precios para ${est}${v ? ` ${v}` : ''}.`);
        } catch (e) {
          if (e.codigo !== CODIGOS.NO_ENCONTRADO) throw e;
          ultimo = e;
        }
      }
      throw ultimo;
    });
  }

  async function obtenerTallasYPrecios(estilo, color) {
    const { producto, color: c } = await resolverColor(estilo, color);
    const filas = await obtenerPrecios(producto.estilo, c);
    const delColor = filas.filter((f) => !f.codigoColor || norm(f.codigoColor) === norm(c.codigo) || norm(f.codigoColor) === norm(c.nombre));
    const porTalla = new Map(delColor.map((f) => [f.talla, f]));
    const tallas = ordenarTallas([...c.tallas, ...porTalla.keys()]);
    return tallas.map((talla) => {
      const f = porTalla.get(talla);
      return { talla, costo: f?.costo ?? null, fuenteCosto: f?.fuenteCosto ?? null, precioLista: f?.precioLista ?? null, oferta: f?.oferta ?? null };
    });
  }

  async function obtenerInventario(estilo, color, talla) {
    const { producto, color: c } = await resolverColor(estilo, color);
    const t = String(talla).trim().toUpperCase();
    return conCache(`sanmar:inventario:${producto.estilo}:${norm(c.codigo)}:${t}`, ttl.inventario, async () => {
      let ultimo;
      for (const v of [...new Set([c.codigo, c.nombre])]) {
        try {
          // Este servicio recibe las credenciales como argumentos posicionales arg0..arg2.
          const doc = await llamar('inventario', 'getInventoryQtyForStyleColorSize',
            campos({ arg0: creds.customerNumber, arg1: creds.username, arg2: creds.password, arg3: producto.estilo, arg4: v, arg5: t }));
          return { estilo: producto.estilo, color: c.nombre, talla: t, ...normalizarInventario(doc), consultado: new Date().toISOString() };
        } catch (e) {
          if (e.codigo !== CODIGOS.NO_ENCONTRADO) throw e;
          ultimo = e;
        }
      }
      throw ultimo;
    });
  }

  /** Todo lo de un color: tallas, costo e inventario (inventario consultado de a 3 tallas a la vez). */
  async function obtenerDetalleColor(estilo, color) {
    const { producto, color: c } = await resolverColor(estilo, color);
    const tallas = await obtenerTallasYPrecios(producto.estilo, c.codigo);
    const inventarios = [];
    for (let i = 0; i < tallas.length; i += 3) {
      const lote = await Promise.all(tallas.slice(i, i + 3).map((t) =>
        obtenerInventario(producto.estilo, c.codigo, t.talla).catch((e) => ({ error: e.codigo, total: null, almacenes: [] }))));
      inventarios.push(...lote);
    }
    const filas = tallas.map((t, i) => ({ ...t, inventario: inventarios[i].error ? null : inventarios[i].total, almacenes: inventarios[i].almacenes, errorInventario: inventarios[i].error || undefined }));
    return {
      estilo: producto.estilo,
      marca: producto.marca,
      descripcion: producto.descripcion,
      color: { nombre: c.nombre, codigo: c.codigo, swatch: c.swatch, fotos: c.fotos },
      tallas: filas,
      inventarioTotal: filas.reduce((a, t) => a + (t.inventario || 0), 0),
      consultado: new Date().toISOString(),
    };
  }

  return { configurado, buscarEstilo, obtenerColores, obtenerFotos, obtenerPrecios, obtenerTallasYPrecios, obtenerInventario, obtenerDetalleColor };
}
