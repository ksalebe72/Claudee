// Simulador mínimo de la API de Anthropic (POST /v1/messages) para pruebas. NO es la API real.
import http from 'node:http';

export function startAnthropicMock(port) {
  const peticiones = [];
  let modo = 'normal'; // 'normal' | 'refusal' | 'auth'
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      peticiones.push({ url: req.url, headers: req.headers, body: json, raw: body });
      if (modo === 'auth') {
        res.writeHead(401, { 'content-type': 'application/json', 'request-id': 'req_mock' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      }
      const sistema = typeof json.system === 'string' ? json.system : (json.system || []).map((b) => b.text).join('\n');
      let texto;
      if (sistema.includes('asistente de cotizaciones')) {
        const productoId = Number(/"id":(\d+),"estilo":"PC61"/.exec(sistema)?.[1] || /"id":(\d+),"estilo"/.exec(sistema)?.[1] || 0) || null;
        texto = JSON.stringify({
          cliente: { nombre: 'Ana Torres', empresa: 'Gym FitZone', email: 'ana@fitzone.com', telefono: null },
          titulo: 'Camisetas para el staff del gimnasio',
          fechaEntrega: '2026-12-10',
          lineas: [{
            descripcion: 'Port & Company PC61 negra', productoId, color: 'Jet Black',
            tallas: [{ talla: 'M', cantidad: 10 }, { talla: 'L', cantidad: 15 }, { talla: 'XXL', cantidad: 3 }],
            cantidadSinTalla: null,
            decoraciones: [{ proceso: 'dtf', ubicacion: 'Espalda', ancho: 10, alto: 12 }, { proceso: 'bordado', ubicacion: 'Pecho izquierdo', ancho: null, alto: null }],
          }],
          notas: 'Logo en blanco', dudas: ['¿Tienen el logo en vector?'], idiomaCliente: 'es',
        });
      } else if (sistema.includes('prueba de conexión')) {
        texto = `¡Hola equipo! Soy ${/Eres ([^,]+),/.exec(sistema)?.[1] || 'el asistente'} (simulador) y estoy listo para ayudar.`;
      } else if (sistema.includes('responder correos')) {
        texto = JSON.stringify({ asunto: 'Re: Camisetas para el evento', respuesta: 'Hola Ana, gracias por escribirnos. Con gusto te preparamos la cotización. — Color Plus', puntosAConfirmar: ['Cantidad por talla', 'Fecha del evento'], idioma: 'es' });
      } else if (sistema.includes('ideas de venta')) {
        texto = '**Simulador** (no es la IA real):\n\n1. **A quién:** Gym FitZone · **Qué ofrecer:** sudaderas bordadas · **Por qué:** compró camisetas DTF.';
      } else if (sistema.includes('analista interno')) {
        texto = 'Respuesta del **simulador** (no es la IA real):\n\n| Orden | Cliente | Contribución |\n|---|---|---|\n| OT-2001 | Iglesia Vida Nueva | 28.9% |\n\n- Está bajo el mínimo de 30% por la comisión de 25%.\n- Ya tiene aprobación del dueño.';
      } else {
        texto = JSON.stringify({ asunto: 'Tu cotización de Color Plus', mensaje: 'Hola, aquí tienes tu cotización. El equipo de Color Plus', canalSugerido: 'email' });
      }
      const respuesta = {
        id: 'msg_mock', type: 'message', role: 'assistant', model: json.model,
        content: modo === 'refusal' ? [] : [{ type: 'text', text: texto }],
        stop_reason: modo === 'refusal' ? 'refusal' : 'end_turn', stop_sequence: null,
        stop_details: modo === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_mock' });
      res.end(JSON.stringify(respuesta));
    });
  });
  return new Promise((ok) => server.listen(port, () => ok({
    server, peticiones,
    setModo: (m) => { modo = m; },
    close: () => server.close(),
  })));
}

if (process.argv[1]?.endsWith('anthropic-mock.js')) startAnthropicMock(Number(process.argv[2]) || 5555).then(() => console.log('Simulador de Anthropic listo'));
