// Prueba real contra SanMar (solo lectura). Uso:
//   npm run sanmar:probar -- PC61            → resumen (conteos, sin precios ni datos de la cuenta)
//   npm run sanmar:probar -- PC61 --estructura → además, la estructura XML con valores ocultos
// Lee SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME y SANMAR_PASSWORD del entorno o de .env.
// Nunca imprime la contraseña, los precios ni la respuesta completa.
import { createSanmarClient } from '../services/sanmar/index.js';
import { structure } from '../services/sanmar/xml.js';

const estilo = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'PC61').toUpperCase();
const verEstructura = process.argv.includes('--estructura');
const estructuras = {};

const sanmar = createSanmarClient({
  reintentos: 2,
  onRespuesta: (op, doc) => { if (!estructuras[op]) estructuras[op] = structure(doc).slice(0, 80); },
});

const si = (v) => (v ? 'sí' : 'no');
const paso = async (nombre, fn) => {
  const t = Date.now();
  try { const r = await fn(); console.log(`✔ ${nombre} (${Date.now() - t} ms)`); return r; }
  catch (e) { console.log(`✘ ${nombre}: [${e.codigo || 'ERROR'}] ${e.message}`); return null; }
};

console.log(`\nPrueba SanMar · estilo ${estilo}`);
console.log(`Credenciales: ${sanmar.configurado() ? 'definidas (no se muestran)' : 'FALTAN — define SANMAR_CUSTOMER_NUMBER, SANMAR_USERNAME, SANMAR_PASSWORD'}\n`);
if (!sanmar.configurado()) process.exit(1);

const producto = await paso('Información de producto (getProductInfoByStyleColorSize)', () => sanmar.buscarEstilo(estilo));
if (producto) {
  const combinaciones = producto.colores.reduce((a, c) => a + c.tallas.length, 0);
  const conFoto = (k) => producto.colores.filter((c) => c.fotos[k]).length;
  console.log(`   Marca: ${producto.marca || '—'} · Título: ${producto.titulo || '—'}`);
  console.log(`   Colores: ${producto.colores.length}`);
  console.log(`   Tallas del estilo: ${producto.tallas.join(', ') || '—'}`);
  console.log(`   Combinaciones color/talla: ${combinaciones}`);
  console.log(`   Fotos → frente: ${conFoto('frente')}/${producto.colores.length} · espalda: ${conFoto('espalda')} · lado: ${conFoto('lado')} · swatch: ${producto.colores.filter((c) => c.swatch).length}`);
  console.log(`   Peso por pieza: ${si(producto.peso != null)} · Descripción: ${si(producto.descripcion)}`);

  const color = producto.colores[0];
  if (color) {
    const tallas = await paso(`Precios (getPricing) · color ${color.nombre}`, () => sanmar.obtenerTallasYPrecios(estilo, color.nombre));
    if (tallas) {
      const conCosto = tallas.filter((t) => t.costo != null);
      const fuentes = [...new Set(conCosto.map((t) => t.fuenteCosto))].join(', ') || '—';
      console.log(`   Tallas con costo: ${conCosto.length}/${tallas.length} · campo usado como costo: ${fuentes}`);
    }
    const talla = color.tallas[0];
    if (talla) {
      const inv = await paso(`Inventario (getInventoryQtyForStyleColorSize) · ${color.nombre} ${talla}`, () => sanmar.obtenerInventario(estilo, color.nombre, talla));
      if (inv) console.log(`   Trae inventario: sí · almacenes: ${inv.almacenes.length} · total numérico: ${si(Number.isFinite(inv.total))}`);
    }
  }
}

if (verEstructura) {
  console.log('\nEstructura de las respuestas (valores ocultos: # = número, … = texto):');
  for (const [op, lineas] of Object.entries(estructuras)) console.log(`\n[${op}]\n${lineas.join('\n')}`);
}
console.log('');
