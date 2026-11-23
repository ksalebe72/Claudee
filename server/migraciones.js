// Ajustes de datos que se aplican una sola vez al arrancar (pedidos puntuales del dueño), en orden y cada uno todo o nada.
// Cada uno guarda su marca en settings; si falla a la mitad no queda medio aplicado y se reintenta en el próximo arranque.
import { get, insert, run, getSetting, setSetting, transaction } from './db.js';
import { ensurePricing, ensureCommissionSetup, aplicarCambioComisionBryan, aplicarCambioWrapsBryan, fijarReglaAutomaticaBryan, asignarClientesExistentes, audit } from './config.js';
import { asignarVendedorPorEmpresa, completarVendedoresDesdeClientes } from './importar-deco.js';
import { computeJob } from './finance.js';
import { all } from './db.js';

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
  // Órdenes de Deco sin vendedor toman el de su cliente (las que ya tienen vendedor no se tocan)
  completarVendedoresDesdeClientes();
}
