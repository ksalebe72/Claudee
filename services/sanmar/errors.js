// Errores de SanMar con un código estable para que la app decida qué mostrar.

export const CODIGOS = {
  NO_CONFIGURADO: 'NO_CONFIGURADO',
  CREDENCIALES: 'CREDENCIALES',
  NO_ENCONTRADO: 'NO_ENCONTRADO',
  TIEMPO_AGOTADO: 'TIEMPO_AGOTADO',
  LIMITE: 'LIMITE',
  RED: 'RED',
  RESPUESTA_INVALIDA: 'RESPUESTA_INVALIDA',
  ERROR_SANMAR: 'ERROR_SANMAR',
};

// Código HTTP que la app debería devolver a su propio cliente.
const HTTP = { NO_CONFIGURADO: 503, CREDENCIALES: 502, NO_ENCONTRADO: 404, TIEMPO_AGOTADO: 504, LIMITE: 429, RED: 503, RESPUESTA_INVALIDA: 502, ERROR_SANMAR: 502 };

export class SanmarError extends Error {
  constructor(codigo, message, { retryable = false, retryAfterMs = null, detalle = null } = {}) {
    super(message);
    this.name = 'SanmarError';
    this.codigo = codigo;
    this.status = HTTP[codigo] || 502;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.detalle = detalle;
  }
  toJSON() { return { error: this.message, codigo: this.codigo }; }
}

/** Clasifica el mensaje de error que devuelve SanMar en el cuerpo SOAP. */
export function clasificarMensaje(msg = '') {
  const m = String(msg);
  if (/(invalid|incorrect|wrong|bad).{0,40}(user|password|credential|login|customer|account)|not authori[sz]ed|unauthori[sz]ed|authenticat|access denied|permission/i.test(m)) {
    return new SanmarError(CODIGOS.CREDENCIALES, 'SanMar rechazó las credenciales (revisa número de cliente, usuario y contraseña, y que el usuario tenga acceso a web services).', { detalle: m });
  }
  if (/limit|too many|throttl|exceed|rate/i.test(m)) {
    return new SanmarError(CODIGOS.LIMITE, 'SanMar indicó que se superó el límite de consultas. Intenta de nuevo en unos minutos.', { retryable: true, detalle: m });
  }
  if (/not found|no (data|records?|results?|product|inventory|pricing)|does not exist|invalid (style|color|size)|no match/i.test(m)) {
    return new SanmarError(CODIGOS.NO_ENCONTRADO, 'SanMar no encontró ese estilo, color o talla.', { detalle: m });
  }
  return new SanmarError(CODIGOS.ERROR_SANMAR, `SanMar devolvió un error: ${m}`, { detalle: m });
}
