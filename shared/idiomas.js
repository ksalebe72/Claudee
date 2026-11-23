// Textos que ve el CLIENTE (portal, factura, cotización y hoja del proof) en español e inglés.
// La app interna sigue en español; esto solo cambia los documentos del cliente.

export const IDIOMAS = { es: 'Español', en: 'English' };

const T = {
  es: {
    cotizacion: 'Cotización', factura: 'Factura', orden: 'Orden', para: 'Para', fecha: 'Fecha', fechaFactura: 'Fecha de factura',
    producto: 'Producto', tallas: 'Tallas', cant: 'Cant.', precioPz: 'Precio/pz', total: 'Total',
    subtotal: 'Subtotal', descuento: 'Descuento', envio: 'Envío', impuesto: 'Impuesto', pagado: 'Pagado', saldo: 'Saldo',
    entregaEstimada: 'Fecha de entrega estimada', estadoOrden: 'Estado de tu orden',
    revisaPrueba: 'Revisa tu prueba de arte', abrirPdf: 'Abrir PDF', pruebaAlt: 'Prueba de arte',
    comentariosCambios: 'Comentarios o cambios (obligatorio si pides cambios)', comentariosOpc: 'Comentarios (opcional)',
    aprobarArte: '✓ Aprobar arte', pedirCambios: 'Pedir cambios',
    avisoAprobarArte: 'Al aprobar confirmas ortografía, colores, tamaños y ubicación. La producción inicia con esta versión.',
    anticipo: 'Anticipo requerido para iniciar', aprobarCotizacion: '✓ Aprobar cotización', rechazar: 'Rechazar',
    graciasAprobada: '¡Gracias! Tu cotización fue aprobada. Te contactaremos para el arte y el anticipo.',
    enlaceInvalido: 'Enlace no válido', pideEnlace: 'Pide a tu proveedor un enlace nuevo.', cargando: 'Cargando…',
    imprimir: 'Imprimir / Guardar PDF', idioma: 'Idioma',
    // hoja del proof
    pruebaDeArte: 'PRUEBA DE ARTE', version: 'Versión', prenda: 'Prenda', cliente: 'CLIENTE', trabajo: 'TRABAJO', prendaT: 'PRENDA',
    color: 'Color', cantidades: 'CANTIDADES', piezas: 'piezas', pzs: 'pzs', decoracion: 'DECORACIÓN', decoracionGen: 'Decoración', colores: 'Colores',
    vista: { front: 'FRENTE', back: 'ESPALDA', side: 'LADO' }, notas: 'NOTAS',
    avisoProof: 'Revise ortografía, colores, tamaño y ubicación. Los colores en pantalla pueden variar del producto final y las medidas son aproximadas. Al aprobar esta prueba usted autoriza la producción; cambios posteriores pueden generar costos adicionales.',
  },
  en: {
    cotizacion: 'Quote', factura: 'Invoice', orden: 'Order', para: 'Bill to', fecha: 'Date', fechaFactura: 'Invoice date',
    producto: 'Item', tallas: 'Sizes', cant: 'Qty', precioPz: 'Unit price', total: 'Total',
    subtotal: 'Subtotal', descuento: 'Discount', envio: 'Shipping', impuesto: 'Sales tax', pagado: 'Paid', saldo: 'Balance due',
    entregaEstimada: 'Estimated delivery date', estadoOrden: 'Order status',
    revisaPrueba: 'Review your art proof', abrirPdf: 'Open PDF', pruebaAlt: 'Art proof',
    comentariosCambios: 'Comments or changes (required if you request changes)', comentariosOpc: 'Comments (optional)',
    aprobarArte: '✓ Approve art', pedirCambios: 'Request changes',
    avisoAprobarArte: 'By approving you confirm spelling, colors, sizes and placement. Production starts with this version.',
    anticipo: 'Deposit required to start', aprobarCotizacion: '✓ Approve quote', rechazar: 'Decline',
    graciasAprobada: 'Thank you! Your quote was approved. We will contact you about the artwork and the deposit.',
    enlaceInvalido: 'Invalid link', pideEnlace: 'Please ask your provider for a new link.', cargando: 'Loading…',
    imprimir: 'Print / Save PDF', idioma: 'Language',
    pruebaDeArte: 'ART PROOF', version: 'Version', prenda: 'Garment', cliente: 'CUSTOMER', trabajo: 'JOB', prendaT: 'GARMENT',
    color: 'Color', cantidades: 'QUANTITIES', piezas: 'pieces', pzs: 'pcs', decoracion: 'DECORATION', decoracionGen: 'Decoration', colores: 'Colors',
    vista: { front: 'FRONT', back: 'BACK', side: 'SIDE' }, notas: 'NOTES',
    avisoProof: 'Please check spelling, colors, size and placement. On-screen colors may vary from the final product and measurements are approximate. Approving this proof authorizes production; later changes may incur additional charges.',
  },
};

const ESTADOS = {
  es: { borrador: 'Borrador', enviada: 'Enviada', aprobada: 'Aprobada', rechazada: 'Rechazada', arte: 'Arte', aprobacion: 'Esperando aprobación', compras: 'Pedido de prendas', produccion: 'En producción', calidad: 'Control de calidad', listo: 'Lista para entrega', entregado: 'Entregada', pendiente: 'Pendiente' },
  en: { borrador: 'Draft', enviada: 'Sent', aprobada: 'Approved', rechazada: 'Declined', arte: 'Artwork', aprobacion: 'Awaiting approval', compras: 'Ordering blanks', produccion: 'In production', calidad: 'Quality check', listo: 'Ready for pickup/delivery', entregado: 'Delivered', pendiente: 'Pending' },
};

const PROCESOS = {
  es: { bordado: 'Bordado', dtf: 'DTF', heat_transfer: 'Heat Transfer' },
  en: { bordado: 'Embroidery', dtf: 'DTF', heat_transfer: 'Heat Transfer' },
};

const UBICACIONES_EN = {
  'frente': 'Front', 'espalda': 'Back', 'pecho izquierdo': 'Left chest', 'pecho derecho': 'Right chest',
  'manga izquierda': 'Left sleeve', 'manga derecha': 'Right sleeve', 'nuca': 'Back neck', 'frente gorra': 'Cap front',
  'lateral gorra': 'Cap side', 'manga': 'Sleeve', 'bolsillo': 'Pocket',
};

export const idiomaValido = (i) => (i === 'en' ? 'en' : 'es');
/** Diccionario del idioma. */
export const textos = (idioma) => T[idiomaValido(idioma)];
export const estadoCliente = (estado, idioma) => ESTADOS[idiomaValido(idioma)][estado] || estado;
/** Nombre del proceso para el cliente (acepta la clave o el nombre en español). */
export function procesoCliente(proceso, idioma) {
  const i = idiomaValido(idioma);
  const clave = Object.keys(PROCESOS.es).find((k) => k === proceso || PROCESOS.es[k] === proceso) || proceso;
  return PROCESOS[i][clave] || proceso;
}
/** Ubicación para el cliente: en inglés traduce las estándar; las escritas a mano se dejan igual. */
export const ubicacionCliente = (ubicacion, idioma) => (idiomaValido(idioma) === 'en' ? UBICACIONES_EN[String(ubicacion || '').trim().toLowerCase()] || ubicacion : ubicacion);
/** Fecha corta en el idioma del cliente. */
export function fechaCliente(iso, idioma) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(idiomaValido(idioma) === 'en' ? 'en-US' : 'es-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
