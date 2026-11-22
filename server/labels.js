// Nombres legibles de estados (mismos que en la interfaz).
const LABELS = {
  nuevo: 'Nuevo lead', contactado: 'Contactado', cotizado: 'Cotizado', negociacion: 'Negociación', ganado: 'Ganado', perdido: 'Perdido',
  borrador: 'Borrador', enviada: 'Enviada', aprobada: 'Aprobada', rechazada: 'Rechazada',
  arte: 'Arte', aprobacion: 'Esperando aprobación', compras: 'Pedido de blanks', produccion: 'En producción', calidad: 'Control de calidad', listo: 'Listo para entrega', entregado: 'Entregado',
  pendiente: 'Pendiente',
};
export const label = (s) => LABELS[s] || s;
