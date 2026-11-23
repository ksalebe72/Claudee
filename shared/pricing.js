// Motor de precios, costos y rentabilidad de ColorPlus OS.
// Lo usan el servidor (cálculo oficial) y el navegador (vista previa en el cotizador).
//
// Regla de oro: un costo desconocido es `null`, NUNCA 0. Cualquier cálculo que dependa de un costo
// desconocido devuelve null y agrega un aviso en `faltantes`.

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
export const PROCESOS = { bordado: 'Bordado', dtf: 'DTF', heat_transfer: 'Heat Transfer' };
export const CATEGORIAS_COSTO = {
  prendas: 'Prendas', bordado: 'Bordado', dtf: 'DTF', heat_transfer: 'Heat Transfer',
  servicios: 'Servicios / Diseño', otros: 'Setup y otros directos', envio: 'Envío',
};

// Valores iniciales de la matriz. Todo es editable desde Ajustes (dueño) y queda versionado.
export const DEFAULT_PRICING = {
  prendas: {
    modo: 'escalonado', // 'escalonado' | 'fijo'
    escalonado: [{ menorQue: 5, factor: 2.2 }, { menorQue: null, factor: 2.0 }],
    fijo: { factor: 2.0 },
  },
  bordado: {
    // puntadasHasta null = cualquier cantidad de puntadas; cantidadDesde = desde N piezas.
    filas: [{ puntadasHasta: null, cantidadDesde: 1, costo: 4.5, precio: 7.5 }], // costo $4.50 · precio al cliente $7.50 (dueño)
    // Digitalizado del logo para bordar: se cobra una vez, la primera vez que se borda ese logo (dueño: cuesta $25, se vende en $50)
    digitalizado: { costo: 25, precio: 50 },
  },
  dtf: {
    // Costo del material: 'hoja' = hojas de 12×12 (se cuentan las hojas que necesita la línea completa) · 'area' = por pie² del diseño
    costoModo: 'hoja',
    hoja: { ancho: 12, alto: 12, costo: 4.0, aprovechamiento: 1 }, // aprovechamiento 1 = 100% de la hoja usable
    // Tamaños estándar por ubicación: se llenan solos en la orden (se pueden cambiar en cada línea)
    tamanos: [
      { ubicacion: 'Pecho izquierdo', ancho: 3.5, alto: 3.5 }, { ubicacion: 'Pecho derecho', ancho: 3.5, alto: 3.5 },
      { ubicacion: 'Frente', ancho: 9.5, alto: 12 }, { ubicacion: 'Espalda', ancho: 9.5, alto: 12 },
    ],
    costoPieCuadrado: 4.0, // material por pie² (144 in²), solo en modo 'area'
    costoAplicacion: 1.6, // costo de aplicar el DTF
    aplicacionPor: 'prenda', // 'prenda' = una vez por prenda aunque lleve varias ubicaciones · 'ubicacion' = por cada ubicación
    // Sin el salto a $25 (pedido del dueño): tramo hasta 144 in² (cabe en la hoja 12×12) y tramo final para diseños más grandes
    primera: [{ hasta: 15, precio: 6.0 }, { hasta: 95, precio: 10.5 }, { hasta: 105, precio: 11.5 }, { hasta: 144, precio: 13.0 }, { hasta: null, precio: 18.5 }],
    adicional: [{ hasta: 15, precio: 1.0 }, { hasta: 95, precio: 5.5 }, { hasta: 144, precio: 8.5 }, { hasta: null, precio: 13.5 }],
    minimo: null, // piezas mínimas; null = sin mínimo
  },
  heatTransfer: {
    hojas: [{ cantidadDesde: 1, costo: null, precio: null }], // tramos por cantidad total de hojas
    aplicacion: { costo: null, precio: null }, // por ubicación y prenda
    minimo: null,
  },
  impuesto: { tasa: 0.06, nombre: 'Maryland' },
  margen: { objetivo: 0.35, minimo: 0.3 },
  liquidacion: { diaPago: 15 },
};

export const round2 = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100 + Number.EPSILON * 100) / 100);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
/** Suma que se vuelve null si algún valor es null. */
const sumOrNull = (arr) => (arr.some((v) => v == null) ? null : round2(sum(arr)));

// ---------- A) Prendas ----------
export function factorPrenda(costo, cfg) {
  const p = cfg.prendas;
  if (p.modo === 'fijo') return Number(p.fijo.factor);
  const tramos = [...p.escalonado].sort((a, b) => (a.menorQue ?? Infinity) - (b.menorQue ?? Infinity));
  const t = tramos.find((x) => x.menorQue == null || costo < Number(x.menorQue));
  return Number(t?.factor ?? tramos[tramos.length - 1].factor);
}

/**
 * Precio unitario de una prenda. override = { tipo: 'porcentaje' | 'precio_fijo', valor } (excepción del producto).
 * Devuelve { precio, factor, fuente } o { precio: null } si no hay costo.
 */
export function precioPrenda(costo, cfg, override = null) {
  if (override?.tipo === 'precio_fijo' && num(override.valor) != null) return { precio: round2(override.valor), factor: null, fuente: 'precio fijo del producto' };
  const c = num(costo);
  if (c == null) return { precio: null, factor: null, fuente: null };
  if (override?.tipo === 'porcentaje' && num(override.valor) != null) {
    const f = 1 + Number(override.valor) / 100;
    return { precio: round2(c * f), factor: f, fuente: `markup del producto ${override.valor}%` };
  }
  const f = factorPrenda(c, cfg);
  return { precio: round2(c * f), factor: f, fuente: cfg.prendas.modo === 'fijo' ? 'modo fijo' : 'modo escalonado' };
}

// ---------- B) Bordado ----------
/** Tarifa por logo y ubicación: { costo, precio, falta } según puntadas y cantidad. */
export function tarifaBordado(cfg, cantidad, puntadas) {
  const filas = cfg.bordado.filas || [];
  const conRango = filas.some((f) => f.puntadasHasta != null);
  const p = num(puntadas);
  let candidatas;
  if (p != null && conRango) {
    const topes = [...new Set(filas.filter((f) => f.puntadasHasta == null || p <= Number(f.puntadasHasta)).map((f) => f.puntadasHasta))];
    topes.sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    candidatas = filas.filter((f) => f.puntadasHasta === topes[0]);
  } else if (conRango) {
    candidatas = filas.filter((f) => f.puntadasHasta == null);
    if (!candidatas.length) return { costo: null, precio: null, falta: 'puntadas del logo' };
  } else candidatas = filas;
  const fila = candidatas.filter((f) => cantidad >= Number(f.cantidadDesde ?? 1)).sort((a, b) => Number(b.cantidadDesde ?? 1) - Number(a.cantidadDesde ?? 1))[0];
  if (!fila) return { costo: null, precio: null, falta: 'tarifa de bordado para esa cantidad' };
  return { costo: num(fila.costo), precio: num(fila.precio), falta: null };
}

// ---------- C) DTF ----------
export const areaDtf = (ancho, alto) => (num(ancho) && num(alto) ? Number(ancho) * Number(alto) : null);
export function precioTabla(tabla, area) {
  const ordenada = [...tabla].sort((a, b) => (a.hasta ?? Infinity) - (b.hasta ?? Infinity));
  const fila = ordenada.find((f) => f.hasta == null || area <= Number(f.hasta));
  return fila ? num(fila.precio) : null;
}
/** Costo interno por ubicación: ancho × alto ÷ 144 × costo pie² + aplicación. */
/** Costo por pieza de una ubicación DTF. conAplicacion=false cuando la aplicación ya se cobró en otra ubicación de la misma prenda. */
export function costoDtf(ancho, alto, cfg, conAplicacion = true) {
  const area = areaDtf(ancho, alto);
  if (area == null) return null;
  return round2((area / 144) * Number(cfg.dtf.costoPieCuadrado) + (conAplicacion ? Number(cfg.dtf.costoAplicacion) : 0));
}
/**
 * Precio por pieza de todas las ubicaciones DTF de una prenda.
 * La ubicación más cara se cobra como primera; las demás con la tabla de ubicación adicional.
 */
export function preciosDtf(ubicaciones, cfg) {
  const conArea = ubicaciones.map((u, i) => ({ i, area: areaDtf(u.ancho, u.alto) }));
  const validas = conArea.filter((u) => u.area != null).map((u) => ({ ...u, primera: precioTabla(cfg.dtf.primera, u.area) }));
  const principal = validas.slice().sort((a, b) => (b.primera ?? -1) - (a.primera ?? -1) || a.i - b.i)[0];
  return conArea.map((u) => {
    if (u.area == null) return { area: null, precio: null, esPrimera: false };
    const esPrimera = principal && u.i === principal.i;
    return { area: round2(u.area), precio: esPrimera ? precioTabla(cfg.dtf.primera, u.area) : precioTabla(cfg.dtf.adicional, u.area), esPrimera };
  });
}

/** Hojas necesarias para una línea: área total de todos los diseños de todas las piezas ÷ área útil de la hoja. */
export function hojasDtf(qty, areas, cfg) {
  const h = cfg.dtf.hoja || {};
  const util = Number(h.ancho) * Number(h.alto) * (Number(h.aprovechamiento) || 1);
  if (!(util > 0) || !qty) return 0;
  const total = qty * areas.reduce((a, b) => a + b, 0);
  return Math.ceil(Math.round((total / util) * 1e6) / 1e6);
}
/** ¿El diseño cabe en la hoja (girándolo si hace falta)? */
export function cabeEnHoja(ancho, alto, cfg) {
  const h = cfg.dtf.hoja || {};
  const [w, a, H, W] = [Number(ancho), Number(alto), Number(h.alto), Number(h.ancho)];
  return (w <= W && a <= H) || (a <= W && w <= H);
}

// ---------- D) Heat transfer ----------
export function tarifaHeatTransfer(cfg, totalHojas) {
  const filas = (cfg.heatTransfer.hojas || []).filter((f) => totalHojas >= Number(f.cantidadDesde ?? 1));
  const fila = filas.sort((a, b) => Number(b.cantidadDesde ?? 1) - Number(a.cantidadDesde ?? 1))[0];
  return { costoHoja: num(fila?.costo), precioHoja: num(fila?.precio), costoAplicacion: num(cfg.heatTransfer.aplicacion?.costo), precioAplicacion: num(cfg.heatTransfer.aplicacion?.precio) };
}

// ---------- Líneas ----------
export function cantidadLinea(linea) {
  const tallas = Object.values(linea.sizes || {}).map(Number).filter((n) => n > 0);
  return tallas.length ? sum(tallas) : Number(linea.qty) || 0;
}

/**
 * Calcula una línea de la orden.
 * linea: {
 *   line_type: 'prenda' | 'servicio' | 'diseno',
 *   description, sizes: { S: 10 }, qty, unit_cost, size_costs: { '2XL': 5.1 },
 *   price_mode: 'auto' | 'manual', manual_price, override: { tipo, valor }, unit_price (servicio/diseño),
 *   decorations: [{ process, location, width, height, stitches, sheets, manual_price }],
 *   line_discount, commissionable
 * }
 */
export function calcularLinea(linea, cfg) {
  const tipo = linea.line_type || 'prenda';
  const nombre = linea.description || 'Línea';
  const faltantesCosto = [];
  const faltantesPrecio = [];
  const avisos = [];
  const qty = cantidadLinea(linea);
  const descuento = round2(num(linea.line_discount) || 0);
  const porProceso = {};
  let prenda = null;
  let decoraciones = [];

  if (tipo === 'servicio' || tipo === 'diseno') {
    const cant = tipo === 'diseno' ? Math.max(1, qty || 1) : qty;
    const precioU = num(linea.unit_price);
    const costoU = num(linea.unit_cost);
    if (precioU == null) faltantesPrecio.push(`${nombre}: precio`);
    if (costoU == null) faltantesCosto.push(`${nombre}: costo ${tipo === 'diseno' ? 'de diseño/digitalizado' : 'del servicio'}`);
    const venta = precioU == null ? null : round2(precioU * cant);
    const costo = costoU == null ? null : round2(costoU * cant);
    porProceso.servicios = { venta, costo };
    return {
      tipo, qty: cant, prenda: null, decoraciones: [], porProceso, costosPorCategoria: { servicios: costo },
      ventaBruta: venta, descuento, venta: venta == null ? null : round2(venta - descuento), costo,
      unitPrice: precioU, manual: false, faltantesCosto, faltantesPrecio, avisos,
      comisionable: tipo === 'diseno' ? false : linea.commissionable !== false && linea.commissionable !== 0,
    };
  }

  // --- prenda ---
  const tallas = Object.entries(linea.sizes || {}).filter(([, n]) => Number(n) > 0);
  const filas = tallas.length ? tallas.map(([talla, n]) => ({ talla, cant: Number(n) })) : [{ talla: null, cant: qty }];
  const manual = linea.price_mode === 'manual' && num(linea.manual_price) != null;
  // «Ajustar a meta»: sube por igual el precio automático de la prenda y de sus decoraciones (no toca precios manuales)
  const ajuste = Math.min(5, Math.max(0, num(linea.ajuste_pct) || 0));
  const conAjuste = (precio) => (precio == null || !ajuste ? precio : round2(precio * (1 + ajuste)));
  const detalleTallas = filas.map(({ talla, cant }) => {
    const costo = num(talla != null ? linea.size_costs?.[talla] : null) ?? num(linea.unit_cost);
    const auto = precioPrenda(costo, cfg, linea.override);
    const precio = manual ? round2(linea.manual_price) : conAjuste(auto.precio);
    if (costo == null) faltantesCosto.push(`${nombre}: costo de la prenda${talla ? ` (talla ${talla})` : ''}`);
    if (precio == null) faltantesPrecio.push(`${nombre}: precio de la prenda${talla ? ` (talla ${talla})` : ''} (falta el costo o pon precio manual)`);
    return { talla, cant, costo, precio, factor: manual ? null : auto.factor, fuente: manual ? 'precio manual' : ajuste ? `${auto.fuente} + ajuste ${round2(ajuste * 100)}%` : auto.fuente };
  });
  const ventaPrenda = sumOrNull(detalleTallas.map((t) => (t.precio == null ? null : t.precio * t.cant)));
  const costoPrenda = sumOrNull(detalleTallas.map((t) => (t.costo == null ? null : t.costo * t.cant)));
  prenda = { tallas: detalleTallas, venta: ventaPrenda, costo: costoPrenda, manual };
  porProceso.prendas = { venta: ventaPrenda, costo: costoPrenda };

  // --- decoraciones ---
  const decos = linea.decorations || [];
  const dtfIdx = decos.map((d, i) => (d.process === 'dtf' ? i : -1)).filter((i) => i >= 0);
  const dtfPrecios = preciosDtf(dtfIdx.map((i) => ({ ancho: decos[i].width, alto: decos[i].height })), cfg);
  // Modo hoja: el material se calcula con las hojas que necesita toda la línea y se reparte según el área de cada diseño
  const porHoja = cfg.dtf.costoModo === 'hoja';
  const areasDtf = dtfIdx.map((i) => areaDtf(decos[i].width, decos[i].height));
  const areaPieza = areasDtf.every((a) => a != null) ? areasDtf.reduce((a, b) => a + b, 0) : null;
  const hojasLinea = porHoja && areaPieza ? hojasDtf(qty, areasDtf, cfg) : null;
  const materialLinea = hojasLinea == null ? null : hojasLinea * Number(cfg.dtf.hoja.costo);
  decoraciones = decos.map((d, i) => {
    const etiqueta = `${nombre} · ${PROCESOS[d.process] || d.process} ${d.location || ''}`.trim();
    let precioPieza = null;
    let costoPieza = null;
    let detalle = '';
    if (d.process === 'bordado') {
      const t = tarifaBordado(cfg, qty, d.stitches);
      precioPieza = t.precio;
      costoPieza = t.costo;
      if (t.falta) detalle = `falta: ${t.falta}`;
    } else if (d.process === 'dtf') {
      const k = dtfIdx.indexOf(i);
      const p = dtfPrecios[k];
      if (p.area == null) detalle = 'falta: ancho y alto del diseño';
      else {
        precioPieza = p.precio;
        // La aplicación se cuenta una vez por prenda (en la 1ª ubicación), salvo que la matriz diga «por ubicación»
        const conAplicacion = cfg.dtf.aplicacionPor === 'ubicacion' || p.esPrimera;
        if (porHoja) {
          costoPieza = materialLinea == null || !qty ? null
            : (materialLinea * (p.area / areaPieza)) / qty + (conAplicacion ? Number(cfg.dtf.costoAplicacion) : 0);
          if (!cabeEnHoja(d.width, d.height, cfg)) avisos.push(`${etiqueta}: el diseño ${d.width}×${d.height}" no cabe en la hoja de ${cfg.dtf.hoja.ancho}×${cfg.dtf.hoja.alto}"; revisa el costo`);
        } else costoPieza = costoDtf(d.width, d.height, cfg, conAplicacion);
        detalle = `${d.width}×${d.height}" = ${p.area} in² · ${p.esPrimera ? '1ª ubicación' : 'ubicación adicional'}${porHoja && hojasLinea != null && p.esPrimera ? ` · ${hojasLinea} hoja(s) de ${cfg.dtf.hoja.ancho}×${cfg.dtf.hoja.alto}" para la línea` : ''}`;
      }
      if (num(cfg.dtf.minimo) && qty < Number(cfg.dtf.minimo)) avisos.push(`${etiqueta}: ${qty} piezas, por debajo del mínimo DTF (${cfg.dtf.minimo})`);
    } else if (d.process === 'heat_transfer') {
      const hojas = num(d.sheets) ?? 1;
      const t = tarifaHeatTransfer(cfg, hojas * qty);
      precioPieza = t.precioHoja == null || t.precioAplicacion == null ? null : round2(hojas * t.precioHoja + t.precioAplicacion);
      costoPieza = t.costoHoja == null || t.costoAplicacion == null ? null : round2(hojas * t.costoHoja + t.costoAplicacion);
      detalle = `${hojas} hoja(s) por pieza`;
      if (num(cfg.heatTransfer.minimo) && qty < Number(cfg.heatTransfer.minimo)) avisos.push(`${etiqueta}: por debajo del mínimo (${cfg.heatTransfer.minimo})`);
    } else {
      detalle = 'proceso no disponible (solo Bordado, DTF y Heat Transfer)';
    }
    const manualDeco = num(d.manual_price) != null;
    if (manualDeco) precioPieza = round2(d.manual_price);
    else precioPieza = conAjuste(precioPieza);
    if (precioPieza == null) faltantesPrecio.push(`${etiqueta}: precio${detalle ? ` (${detalle})` : ''}`);
    if (costoPieza == null) faltantesCosto.push(`${etiqueta}: costo pendiente${detalle && detalle.startsWith('falta') ? ` (${detalle})` : ''}`);
    const venta = precioPieza == null ? null : round2(precioPieza * qty);
    const costo = costoPieza == null ? null : round2(costoPieza * qty);
    const proc = PROCESOS[d.process] ? d.process : 'otros';
    const acc = (porProceso[proc] ||= { venta: 0, costo: 0 });
    acc.venta = acc.venta == null || venta == null ? null : round2(acc.venta + venta);
    acc.costo = acc.costo == null || costo == null ? null : round2(acc.costo + costo);
    return { process: d.process, location: d.location, precioPieza, costoPieza: round2(costoPieza), venta, costo, manual: manualDeco, detalle };
  });

  const ventaBruta = sumOrNull([ventaPrenda, ...decoraciones.map((d) => d.venta)]);
  const costo = sumOrNull([costoPrenda, ...decoraciones.map((d) => d.costo)]);
  const costosPorCategoria = { prendas: costoPrenda };
  for (const p of Object.keys(PROCESOS)) if (porProceso[p]) costosPorCategoria[p] = porProceso[p].costo;
  const precioDecoPieza = sumOrNull(decoraciones.map((d) => d.precioPieza));
  return {
    tipo, qty, prenda, decoraciones, porProceso, costosPorCategoria,
    ventaBruta, descuento, venta: ventaBruta == null ? null : round2(ventaBruta - descuento), costo,
    unitPrice: ventaBruta == null || !qty ? null : round2(ventaBruta / qty),
    precioDecoPieza,
    manual, faltantesCosto, faltantesPrecio, avisos,
    comisionable: linea.commissionable !== false && linea.commissionable !== 0,
  };
}

// ---------- Orden: rentabilidad y comisión ----------
/** Reparte `monto` entre las líneas en proporción a `pesos`. */
function repartir(monto, pesos) {
  const total = sum(pesos);
  if (!total) return pesos.map(() => 0);
  return pesos.map((p) => (monto * p) / total);
}

/**
 * Calcula la rentabilidad de una orden o cotización.
 * @param o.lineas        resultados de calcularLinea (con .comisionable)
 * @param o.descuentoGlobal, o.creditos (descuentos/créditos/devoluciones posteriores; reducen la venta)
 * @param o.envioCobrado, o.costoEnvio (null = desconocido), o.costosExtra [{ concepto, tipo, monto }]
 * @param o.tasaImpuesto, o.exento
 * @param o.reales        costo real por categoría { prendas: 120, dtf: 30 } (de facturas de proveedor)
 * @param o.regla         { nombre, base: 'venta_neta'|'ganancia_producto'|'ganancia_total', tasa } | null
 * @param o.margen        { objetivo, minimo }
 */
export function calcularRentabilidad(o) {
  const lineas = o.lineas || [];
  const faltantes = [];
  const faltantesPrecio = lineas.flatMap((l) => l.faltantesPrecio);
  const avisos = lineas.flatMap((l) => l.avisos);
  const reales = o.reales || {};

  // Venta
  const ventasLinea = lineas.map((l) => l.venta ?? 0);
  const ventaLineas = round2(sum(ventasLinea));
  const descuentoGlobal = round2(num(o.descuentoGlobal) || 0);
  const creditos = round2(num(o.creditos) || 0);
  const ventaProductos = round2(ventaLineas - descuentoGlobal - creditos);
  const envioCobrado = round2(num(o.envioCobrado) || 0);
  const ingresoSinImpuesto = round2(ventaProductos + envioCobrado);
  const tasa = o.exento ? 0 : Number(o.tasaImpuesto) || 0;
  const impuesto = round2(ingresoSinImpuesto * tasa);
  const total = round2(ingresoSinImpuesto + impuesto);
  const descuentosPorLinea = repartir(descuentoGlobal + creditos, ventasLinea);
  const ventaNetaLinea = lineas.map((l, i) => (l.venta == null ? null : l.venta - descuentosPorLinea[i]));

  // Costos cotizados por categoría (null = desconocido)
  const categorias = ['prendas', 'bordado', 'dtf', 'heat_transfer', 'servicios'];
  const cotizado = {};
  for (const c of categorias) {
    const vals = lineas.filter((l) => c in l.costosPorCategoria).map((l) => l.costosPorCategoria[c]);
    cotizado[c] = vals.length ? sumOrNull(vals) : 0;
  }
  const extras = (o.costosExtra || []).map((x) => num(x.monto));
  cotizado.otros = sumOrNull(extras.map((v) => v ?? null));
  if (cotizado.otros == null) cotizado.otros = null;
  const costoEnvio = num(o.costoEnvio);
  cotizado.envio = costoEnvio ?? (envioCobrado > 0 ? null : 0);

  // Costo efectivo: el real (factura) reemplaza al cotizado en su categoría
  const efectivo = {};
  for (const c of [...categorias, 'otros', 'envio']) {
    const r = num(reales[c]);
    efectivo[c] = r != null ? round2(r) : cotizado[c];
    if (efectivo[c] == null) {
      if (c === 'envio') faltantes.push('Costo de envío');
      else if (c === 'otros') faltantes.push('Monto de un costo extra');
      else faltantes.push(...lineas.flatMap((l) => l.faltantesCosto.filter((f) => esDeCategoria(f, c, l))));
    }
  }

  // Costo efectivo por línea (reparte costos reales para saber qué parte es comisionable)
  const costoLinea = lineas.map(() => 0);
  let lineaIncompleta = lineas.map(() => false);
  for (const c of categorias) {
    const idx = lineas.map((l, i) => (c in l.costosPorCategoria ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const quoted = idx.map((i) => lineas[i].costosPorCategoria[c]);
    const r = num(reales[c]);
    if (r == null) {
      idx.forEach((i, k) => { if (quoted[k] == null) lineaIncompleta[i] = true; else costoLinea[i] += quoted[k]; });
    } else {
      const base = quoted.every((q) => q != null) && sum(quoted) > 0 ? quoted : idx.map((i) => lineas[i].venta ?? 0);
      repartir(r, base).forEach((v, k) => { costoLinea[idx[k]] += v; });
    }
  }
  // Costo real de una categoría que ninguna línea tenía cotizada (p. ej. bordado en una orden cotizada solo con DTF):
  // también es costo del producto, así que se reparte entre las líneas según su venta. Antes se perdía y la comisión
  // sobre ganancia se calculaba como si ese costo no existiera.
  const sinLinea = sum(categorias.filter((c) => num(reales[c]) != null && !lineas.some((l) => c in l.costosPorCategoria)).map((c) => num(reales[c])));
  if (sinLinea) repartir(sinLinea, lineas.map((l) => l.venta ?? 0)).forEach((v, i) => { costoLinea[i] += v; });

  const costoProducto = sumOrNull([efectivo.prendas, efectivo.bordado, efectivo.dtf, efectivo.heat_transfer, efectivo.servicios, efectivo.otros]);
  const costoProductoCotizado = sumOrNull([cotizado.prendas, cotizado.bordado, cotizado.dtf, cotizado.heat_transfer, cotizado.servicios, cotizado.otros]);
  const hayReales = Object.values(reales).some((v) => num(v) != null);
  const gananciaProducto = costoProducto == null ? null : round2(ventaProductos - costoProducto);
  const gananciaEnvio = efectivo.envio == null ? null : round2(envioCobrado - efectivo.envio);
  const gananciaBruta = gananciaProducto == null || gananciaEnvio == null ? null : round2(gananciaProducto + gananciaEnvio);

  // Comisión
  const com = { estado: 'sin_regla', regla: o.regla?.nombre || null, base: null, baseTipo: o.regla?.base || null, tasa: o.regla ? Number(o.regla.tasa) : null, monto: null, ventaComisionable: null, motivo: null };
  const idxCom = lineas.map((l, i) => (l.comisionable ? i : -1)).filter((i) => i >= 0);
  com.ventaComisionable = round2(sum(idxCom.map((i) => ventaNetaLinea[i] ?? 0)));
  if (o.regla && (o.regla.tasa == null || !Number.isFinite(Number(o.regla.tasa)))) {
    com.estado = 'pendiente';
    com.tasa = null;
    com.motivo = 'La regla no tiene una tasa vigente en la fecha de la factura';
  } else if (o.regla) {
    let base = null;
    if (o.regla.base === 'venta_neta') base = com.ventaComisionable;
    else {
      const incompletas = idxCom.some((i) => lineaIncompleta[i]) || efectivo.otros == null || (o.regla.base === 'ganancia_total' && efectivo.envio == null);
      if (!incompletas) {
        base = com.ventaComisionable - sum(idxCom.map((i) => costoLinea[i])) - efectivo.otros;
        if (o.regla.base === 'ganancia_total') base += envioCobrado - efectivo.envio;
      }
    }
    if (base == null) {
      com.estado = 'pendiente';
      com.motivo = 'Falta un costo y la regla se calcula sobre la ganancia';
    } else {
      com.base = round2(Math.max(0, base));
      com.monto = round2(com.base * com.tasa);
      com.estado = 'calculada';
      if (base < 0) com.motivo = 'La base sobre ganancia es negativa: la comisión es $0';
    }
  }

  // Contribución y semáforo
  const comision = o.regla ? com.monto : 0;
  const contribucion = gananciaBruta == null || comision == null ? null : round2(gananciaBruta - comision);
  const contribucionPct = contribucion == null || !ingresoSinImpuesto ? null : round2((contribucion / ingresoSinImpuesto) * 100);
  const margen = o.margen || DEFAULT_PRICING.margen;
  const incompleta = contribucion == null || faltantesPrecio.length > 0;
  let semaforo = 'incompleta';
  let aprobacionRequerida = null;
  if (!incompleta) {
    if (contribucion < 0) { semaforo = 'rojo'; aprobacionRequerida = 'duena'; }
    else if (contribucionPct != null && contribucionPct < margen.minimo * 100) { semaforo = 'rojo'; aprobacionRequerida = 'gerencia'; }
    else if (contribucionPct != null && contribucionPct < margen.objetivo * 100) semaforo = 'amarillo';
    else semaforo = 'verde';
  }

  // Rentabilidad por proceso
  const porProceso = {};
  for (const l of lineas) for (const [p, v] of Object.entries(l.porProceso)) {
    const acc = (porProceso[p] ||= { venta: 0, costo: 0 });
    acc.venta = acc.venta == null || v.venta == null ? null : round2(acc.venta + v.venta);
    acc.costo = acc.costo == null || v.costo == null ? null : round2(acc.costo + v.costo);
  }
  for (const [p, v] of Object.entries(porProceso)) {
    const cat = p === 'servicios' ? 'servicios' : p;
    if (num(reales[cat]) != null) v.costo = round2(reales[cat]);
    v.ganancia = v.venta == null || v.costo == null ? null : round2(v.venta - v.costo);
  }

  return {
    ventaLineas, descuentoGlobal, creditos, ventaProductos, envioCobrado, ingresoSinImpuesto,
    tasaImpuesto: tasa, impuesto, total,
    costos: { cotizado, efectivo, reales: Object.fromEntries(Object.entries(reales).filter(([, v]) => num(v) != null)) },
    costoProducto, costoProductoCotizado,
    diferenciaCosto: hayReales && costoProducto != null && costoProductoCotizado != null ? round2(costoProducto - costoProductoCotizado) : null,
    gananciaProducto, gananciaEnvio, gananciaBruta,
    comision: com, contribucion, contribucionPct, semaforo, aprobacionRequerida,
    incompleta, faltantes: [...new Set(faltantes)], faltantesPrecio: [...new Set(faltantesPrecio)], avisos,
    porProceso,
  };
}

function esDeCategoria(texto, categoria, linea) {
  if (categoria === 'prendas') return texto.includes('costo de la prenda');
  if (categoria === 'servicios') return linea.tipo === 'servicio' || linea.tipo === 'diseno';
  return texto.includes(PROCESOS[categoria]);
}
