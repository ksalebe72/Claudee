// Ajustes de datos que se aplican una sola vez al arrancar (pedidos puntuales del dueño), en orden y cada uno todo o nada.
// Cada uno guarda su marca en settings; si falla a la mitad no queda medio aplicado y se reintenta en el próximo arranque.
import { get, insert, run, getSetting, setSetting, transaction } from './db.js';
import { ensurePricing, ensureCommissionSetup, aplicarCambioComisionBryan, aplicarCambioWrapsBryan, fijarReglaAutomaticaBryan, asignarClientesExistentes, audit } from './config.js';
import { asignarVendedorPorEmpresa, completarVendedoresDesdeClientes } from './importar-deco.js';
import { computeJob } from './finance.js';
import { all } from './db.js';
import { hoyNY } from './clientes-recencia.js';
import { logosDePruebasAnteriores } from './atajos-cotizacion.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function unaVez(clave, fn) {
  if (getSetting(clave)) return;
  transaction(() => { fn(); setSetting(clave, true); });
}

/** Vendedor por nombre; lo crea si no existe. */
function vendedor(nombre) {
  const sp = get('SELECT * FROM salespeople WHERE lower(name) = lower(?)', nombre);
  if (sp) return sp;
  const id = insert('salespeople', { name: nombre });
  audit(null, 'comisiones', `vendedor ${nombre}`, null, 'creado', String(id));
  return get('SELECT * FROM salespeople WHERE id = ?', id);
}

export function aplicarMigraciones() {
  ensurePricing();
  ensureCommissionSetup();
  if (process.env.CAMBIO_BRYAN_DISABLED !== '1') { aplicarCambioComisionBryan(); aplicarCambioWrapsBryan(); fijarReglaAutomaticaBryan(); }
  asignarClientesExistentes();
  // Pedido del dueño: si una orden de Bryan queda bajo 30% de contribución, su comisión baja de 40% a 20% (desde hoy)
  if (process.env.CAMBIO_BRYAN_DISABLED !== '1') unaVez('bryan_comision_reducida', () => {
    const regla = get("SELECT r.id FROM commission_rules r JOIN salespeople s ON s.id = r.salesperson_id WHERE s.name = 'Bryan' AND r.name = 'Bryan · Utilidad 40%' AND r.active = 1");
    if (!regla) return;
    const hoy = hoyNY();
    const actual = get('SELECT * FROM commission_rates WHERE rule_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1', regla.id, hoy);
    if (!actual || actual.rate_reducida != null) return;
    insert('commission_rates', { rule_id: regla.id, rate: actual.rate, effective_from: hoy, created_by: 'sistema (pedido del dueño)', min_contribucion: 0.3, rate_reducida: 0.2 });
    audit(null, 'comisiones', `tasa Bryan · Utilidad 40% desde ${hoy}`, { tasa: actual.rate, minimo_contribucion: null, tasa_reducida: null }, { tasa: actual.rate, minimo_contribucion: 0.3, tasa_reducida: 0.2 }, String(regla.id));
  });
  // «Todas las de Guapo's son de Karol»
  unaVez('karol_guapos', () => asignarVendedorPorEmpresa({ texto: 'guapo', salesperson_id: vendedor('Karol').id }, null));
  // «I'm Karol the owner»: sus ventas son de la casa, sin comisión
  unaVez('karol_es_dueno', () => {
    const karol = vendedor('Karol');
    if (karol.es_dueno) return;
    run('UPDATE salespeople SET es_dueno = 1 WHERE id = ?', karol.id);
    audit(null, 'comisiones', 'vendedor Karol', { dueno_sin_comision: false }, { dueno_sin_comision: true }, String(karol.id));
  });
  // Corrección de la comisión sobre ganancia (costo real de una categoría no cotizada, caso OT-2003):
  // recalcula el resumen guardado de cada orden y cotización. Las liquidaciones cerradas no se tocan; si cambia algo ya liquidado, se ajusta en la próxima.
  unaVez('recalculo_costos_sin_linea', () => { for (const { id } of all('SELECT id FROM jobs')) computeJob(id); });
  // Biblioteca de logos por cliente: se llena con los logos de las pruebas que ya existían
  unaVez('logos_de_pruebas', () => logosDePruebasAnteriores(process.env.UPLOAD_DIR || resolve(dirname(fileURLToPath(import.meta.url)), 'uploads')));
  // Órdenes de Deco sin vendedor toman el de su cliente (las que ya tienen vendedor no se tocan)
  completarVendedoresDesdeClientes();
}
