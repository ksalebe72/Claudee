// Tarifas versionadas e historial de cambios.
// Cada guardado de la matriz crea una versión nueva; las cotizaciones guardan el id de la versión
// con la que se calcularon, así un cambio de tabla nunca altera una cotización existente.
import { all, get, run, insert, getSetting, setSetting } from './db.js';
import { DEFAULT_PRICING } from '../shared/pricing.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });

/** Completa con valores por defecto las claves que falten (por si se agregan secciones nuevas). */
function withDefaults(cfg) {
  const out = structuredClone(DEFAULT_PRICING);
  for (const [k, v] of Object.entries(cfg || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...out[k], ...v } : v;
  // Versiones guardadas antes de esta opción calculaban la aplicación DTF por ubicación: se respetan tal cual.
  if (cfg?.dtf && !('aplicacionPor' in cfg.dtf)) out.dtf.aplicacionPor = 'ubicacion';
  if (cfg?.dtf && !('costoModo' in cfg.dtf)) out.dtf.costoModo = 'area';
  return out;
}

let migrando = false;
// Tabla DTF con la que arrancó la app (para reemplazarla solo si nadie la cambió)
const TABLA_DTF_ORIGINAL = {
  primera: [{ hasta: 15, precio: 6 }, { hasta: 95, precio: 10.5 }, { hasta: 105, precio: 11.5 }, { hasta: null, precio: 25 }],
  adicional: [{ hasta: 15, precio: 1 }, { hasta: 95, precio: 5.5 }, { hasta: null, precio: 25 }],
};
export function ensurePricing() {
  if (!get('SELECT id FROM pricing_versions LIMIT 1')) {
    insert('pricing_versions', { config: DEFAULT_PRICING, note: 'Valores iniciales (matriz Color Plus)', created_by: 'sistema' });
  }
  // Aclaraciones de la dueña sobre DTF (se crea una versión nueva con historial; las cotizaciones guardadas conservan la suya):
  //  · los $1.60 de aplicación son una vez por prenda, no por ubicación
  //  · el material se cuenta por hojas de 12×12 a $4, con tamaños estándar por ubicación
  //  · sin el salto a $25: espalda/frente estándar (hasta 144 in²) a $13 (1ª) / $8.50 (adicional); más grande que la hoja $18.50 / $13.50
  //    (solo si la tabla sigue siendo la original; si la dueña ya la editó, no se toca)
  const ultima = get('SELECT config FROM pricing_versions ORDER BY id DESC LIMIT 1');
  const raw = typeof ultima.config === 'string' ? JSON.parse(ultima.config) : ultima.config;
  if (migrando || !raw?.dtf) return;
  const cfg = withDefaults(raw);
  const notas = [];
  if (!('aplicacionPor' in raw.dtf)) { cfg.dtf.aplicacionPor = 'prenda'; notas.push('aplicación una vez por prenda'); }
  if (!('costoModo' in raw.dtf)) {
    cfg.dtf.costoModo = 'hoja';
    cfg.dtf.hoja = structuredClone(DEFAULT_PRICING.dtf.hoja);
    cfg.dtf.tamanos = structuredClone(DEFAULT_PRICING.dtf.tamanos);
    notas.push('costo por hoja 12×12 y tamaños estándar');
  }
  const igual = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (igual(raw.dtf.primera, TABLA_DTF_ORIGINAL.primera) && igual(raw.dtf.adicional, TABLA_DTF_ORIGINAL.adicional)) {
    cfg.dtf.primera = structuredClone(DEFAULT_PRICING.dtf.primera);
    cfg.dtf.adicional = structuredClone(DEFAULT_PRICING.dtf.adicional);
    notas.push('precios DTF sin el salto a $25');
  }
  // Bordado: precio al cliente $7.50 por logo (antes $4.50 y luego $6); solo si la tabla no fue editada a mano
  const bordadoAnteriores = [4.5, 6].map((precio) => [{ puntadasHasta: null, cantidadDesde: 1, costo: 4.5, precio }]);
  if (bordadoAnteriores.some((t) => igual(raw.bordado?.filas, t))) {
    cfg.bordado.filas = structuredClone(DEFAULT_PRICING.bordado.filas);
    notas.push('bordado a $7.50 por logo para el cliente');
  }
  if (!notas.length) return;
  migrando = true;
  try { savePricing(cfg, null, `${notas.join(' · ')} (pedido de la dueña)`); } finally { migrando = false; }
}

export function currentPricing() {
  ensurePricing();
  const v = get('SELECT * FROM pricing_versions ORDER BY id DESC LIMIT 1');
  return { id: v.id, config: withDefaults(v.config), created_at: v.created_at, created_by: v.created_by, note: v.note };
}

export function pricingVersion(id) {
  if (!id) return currentPricing();
  const v = get('SELECT * FROM pricing_versions WHERE id = ?', id);
  return v ? { id: v.id, config: withDefaults(v.config), created_at: v.created_at } : currentPricing();
}

export function audit(user, area, field, oldValue, newValue, ref = null) {
  insert('audit_log', {
    user_id: user?.id ?? null, user_name: user?.name ?? 'sistema', area, field,
    old_value: oldValue === undefined ? null : JSON.stringify(oldValue),
    new_value: newValue === undefined ? null : JSON.stringify(newValue),
    ref,
  });
}

/** Lista de diferencias { ruta, antes, despues } entre dos objetos. */
export function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (x) => x && typeof x === 'object';
  if (Array.isArray(a) || Array.isArray(b) || !isObj(a) || !isObj(b)) return [{ ruta: path, antes: a, despues: b }];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diff(a[k], b[k], path ? `${path}.${k}` : k));
}

// ---------- validación ----------
const isNumOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
function validar(cfg) {
  const errs = [];
  const p = cfg.prendas;
  if (!['escalonado', 'fijo'].includes(p.modo)) errs.push('Modo de markup inválido');
  if (!(p.fijo.factor > 0)) errs.push('El factor del modo fijo debe ser mayor que 0');
  if (!p.escalonado.length || p.escalonado.some((t) => !(t.factor > 0) || !(t.menorQue === null || t.menorQue > 0))) errs.push('Revisa los tramos del modo escalonado');
  if (p.escalonado.filter((t) => t.menorQue === null).length !== 1) errs.push('El modo escalonado necesita exactamente un tramo final (sin límite)');
  for (const f of cfg.bordado.filas) if (!isNumOrNull(f.costo) || !isNumOrNull(f.precio) || !(f.cantidadDesde >= 1) || !isNumOrNull(f.puntadasHasta)) errs.push('Revisa la tabla de bordado');
  if (!(cfg.dtf.costoPieCuadrado >= 0) || !(cfg.dtf.costoAplicacion >= 0)) errs.push('Revisa los costos de DTF');
  if (!['prenda', 'ubicacion'].includes(cfg.dtf.aplicacionPor)) errs.push('La aplicación DTF debe ser por prenda o por ubicación');
  if (!['hoja', 'area'].includes(cfg.dtf.costoModo)) errs.push('El costo DTF debe ser por hoja o por área');
  if (cfg.dtf.costoModo === 'hoja') {
    const h = cfg.dtf.hoja || {};
    if (!(h.ancho > 0) || !(h.alto > 0) || !(h.costo >= 0)) errs.push('Revisa el tamaño y el costo de la hoja DTF');
    if (!(h.aprovechamiento > 0 && h.aprovechamiento <= 1)) errs.push('El aprovechamiento de la hoja DTF debe estar entre 1% y 100%');
  }
  for (const t of cfg.dtf.tamanos || []) if (!t.ubicacion || !(t.ancho > 0) || !(t.alto > 0)) errs.push('Cada tamaño estándar DTF necesita ubicación, ancho y alto');
  for (const t of [cfg.dtf.primera, cfg.dtf.adicional]) {
    if (!t.length || t.filter((f) => f.hasta === null).length !== 1 || t.some((f) => !isNumOrNull(f.precio) || f.precio === null)) errs.push('Cada tabla de DTF necesita precios y un tramo final sin límite');
  }
  if (!isNumOrNull(cfg.dtf.minimo) || !isNumOrNull(cfg.heatTransfer.minimo)) errs.push('Mínimo inválido');
  for (const f of cfg.heatTransfer.hojas) if (!isNumOrNull(f.costo) || !isNumOrNull(f.precio) || !(f.cantidadDesde >= 1)) errs.push('Revisa los tramos de heat transfer');
  if (!isNumOrNull(cfg.heatTransfer.aplicacion.costo) || !isNumOrNull(cfg.heatTransfer.aplicacion.precio)) errs.push('Revisa la aplicación de heat transfer');
  if (!(cfg.impuesto.tasa >= 0 && cfg.impuesto.tasa < 1)) errs.push('Tasa de impuesto inválida');
  if (!(cfg.margen.minimo >= 0 && cfg.margen.objetivo >= cfg.margen.minimo && cfg.margen.objetivo < 1)) errs.push('Umbrales de margen inválidos (objetivo ≥ mínimo)');
  const dia = cfg.liquidacion.diaPago;
  if (!(Number.isInteger(dia) && dia >= 1 && dia <= 28)) errs.push('El día de pago debe estar entre 1 y 28');
  if (errs.length) throw fail(400, [...new Set(errs)].join('. '));
}

/** Guarda una nueva versión de la matriz y registra cada valor cambiado en el historial. */
export function savePricing(newCfg, user, note) {
  const actual = currentPricing();
  const cfg = withDefaults(newCfg);
  validar(cfg);
  const cambios = diff(actual.config, cfg);
  if (!cambios.length) return { ...actual, cambios: 0 };
  const id = insert('pricing_versions', { config: cfg, note: note || null, created_by: user?.name || 'sistema' });
  for (const c of cambios) audit(user, 'tarifas', c.ruta, c.antes, c.despues, `versión ${id}`);
  return { ...currentPricing(), cambios: cambios.length };
}

// ---------- vendedores y reglas de comisión iniciales ----------
export function ensureCommissionSetup() {
  if (get('SELECT COUNT(*) AS c FROM commission_rules').c > 0) return;
  const bryan = insert('salespeople', { name: 'Bryan' });
  const isabel = insert('salespeople', { name: 'Isabel' });
  const desde = '2000-01-01';
  const reglas = [
    { salesperson_id: bryan, name: 'Bryan · Ventas', base: 'venta_neta', client_type: null, rate: 0.25 },
    { salesperson_id: bryan, name: 'Bryan · Wraps', base: 'ganancia_producto', client_type: null, rate: 0.5 },
    { salesperson_id: isabel, name: 'Isabel · Cliente existente', base: 'venta_neta', client_type: 'existente', rate: 0.05 },
    { salesperson_id: isabel, name: 'Isabel · Cliente nuevo', base: 'venta_neta', client_type: 'nuevo', rate: 0.1 },
    { salesperson_id: null, name: 'Sin comisión', base: 'venta_neta', client_type: null, rate: 0 },
  ];
  for (const r of reglas) {
    const id = insert('commission_rules', { salesperson_id: r.salesperson_id, name: r.name, base: r.base, client_type: r.client_type });
    insert('commission_rates', { rule_id: id, rate: r.rate, effective_from: desde, created_by: 'sistema' });
  }
}

/** Regla con la tasa vigente en una fecha (YYYY-MM-DD). tasa = null si no hay tasa vigente. */
export function ruleAt(ruleId, date) {
  if (!ruleId) return null;
  const r = get('SELECT * FROM commission_rules WHERE id = ?', ruleId);
  if (!r) return null;
  const rate = get('SELECT * FROM commission_rates WHERE rule_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1', ruleId, date);
  return { id: r.id, nombre: r.name, base: r.base, client_type: r.client_type, salesperson_id: r.salesperson_id, tasa: rate ? rate.rate : null, vigenteDesde: rate?.effective_from ?? null };
}

export function listRules() {
  return all(`SELECT r.*, s.name AS salesperson_name FROM commission_rules r LEFT JOIN salespeople s ON s.id = r.salesperson_id ORDER BY r.active DESC, s.name, r.id`).map((r) => ({
    ...r,
    tasas: all('SELECT * FROM commission_rates WHERE rule_id = ? ORDER BY effective_from DESC, id DESC', r.id),
  }));
}

/**
 * Cambio pedido por la dueña: Bryan pasa de 25% de la venta a 40% de la ganancia de producto, desde el día en que se aplica.
 * Se hace una sola vez: crea la regla «Bryan · Utilidad 40%» y desactiva «Bryan · Ventas» (las órdenes que ya la tienen la conservan).
 * Queda en el historial. (Los wraps se cambian aparte en aplicarCambioWrapsBryan.)
 */
export const CAMBIO_BRYAN = 'cambio_bryan_utilidad_40';
export function aplicarCambioComisionBryan(hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })) {
  if (getSetting(CAMBIO_BRYAN)) return false;
  const bryan = get("SELECT id FROM salespeople WHERE name = 'Bryan'");
  const yaExiste = bryan && get("SELECT id FROM commission_rules WHERE salesperson_id = ? AND base = 'ganancia_producto' AND name NOT LIKE '%Wrap%' AND active = 1", bryan.id);
  if (bryan && !yaExiste) {
    const id = insert('commission_rules', { salesperson_id: bryan.id, name: 'Bryan · Utilidad 40%', base: 'ganancia_producto', client_type: null });
    insert('commission_rates', { rule_id: id, rate: 0.4, effective_from: hoy, created_by: 'sistema (pedido de la dueña)' });
    audit(null, 'comisiones', 'regla Bryan · Utilidad 40%', null, { base: 'ganancia_producto', tasa: 0.4, desde: hoy }, String(id));
    const ventas = get("SELECT * FROM commission_rules WHERE salesperson_id = ? AND name = 'Bryan · Ventas'", bryan.id);
    if (ventas?.active) {
      run('UPDATE commission_rules SET active = 0 WHERE id = ?', ventas.id);
      audit(null, 'comisiones', 'regla Bryan · Ventas', { activa: true, tasa: 0.25 }, { activa: false, motivo: `reemplazada por Bryan · Utilidad 40% desde ${hoy}` }, String(ventas.id));
    }
  }
  setSetting(CAMBIO_BRYAN, hoy);
  return true;
}

/** Segundo pedido de la dueña: los wraps también al 40% de la utilidad (una sola regla para todo lo que venda Bryan). */
export const CAMBIO_BRYAN_WRAPS = 'cambio_bryan_wraps_40';
export function aplicarCambioWrapsBryan(hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })) {
  if (getSetting(CAMBIO_BRYAN_WRAPS)) return false;
  const wraps = get("SELECT r.* FROM commission_rules r JOIN salespeople s ON s.id = r.salesperson_id WHERE s.name = 'Bryan' AND r.name LIKE '%Wrap%' AND r.active = 1");
  if (wraps) {
    run('UPDATE commission_rules SET active = 0 WHERE id = ?', wraps.id);
    audit(null, 'comisiones', `regla ${wraps.name}`, { activa: true, tasa: 0.5 }, { activa: false, motivo: `wraps también con Bryan · Utilidad 40% desde ${hoy}` }, String(wraps.id));
  }
  setSetting(CAMBIO_BRYAN_WRAPS, hoy);
  return true;
}

/** La regla «Bryan · Utilidad 40%» queda como regla automática en el perfil de Bryan (una sola vez). */
export function fijarReglaAutomaticaBryan() {
  if (getSetting('bryan_regla_automatica')) return false;
  const bryan = get("SELECT * FROM salespeople WHERE name = 'Bryan'");
  const regla = bryan && get("SELECT id FROM commission_rules WHERE salesperson_id = ? AND name = 'Bryan · Utilidad 40%' AND active = 1", bryan.id);
  if (regla && bryan.default_rule_id !== regla.id) {
    run('UPDATE salespeople SET default_rule_id = ? WHERE id = ?', regla.id, bryan.id);
    audit(null, 'comisiones', 'vendedor Bryan', { regla_automatica: bryan.default_rule_id ?? null }, { regla_automatica: 'Bryan · Utilidad 40%' }, String(bryan.id));
  }
  setSetting('bryan_regla_automatica', true);
  return true;
}
