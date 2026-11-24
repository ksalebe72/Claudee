// Mensaje de bienvenida al iniciar sesión: saludo, fecha y hora (formato americano, hora de Maryland) y una frase de motivación.
import React, { useEffect, useState } from 'react';

const ZONA = 'America/New_York'; // Color Plus trabaja con la hora de Maryland
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const FRASES = [
  'Cada cotización que mandas hoy es una venta que puede cerrar mañana.',
  'El cliente no compra una camiseta: compra cómo se va a ver su negocio. Hazlo ver bien.',
  'Un seguimiento a tiempo vale más que diez cotizaciones olvidadas.',
  'Lo que se hace con cuidado se nota en cada puntada.',
  'Hoy alguien necesita justo lo que tú sabes hacer. Ve y encuéntralo.',
  'Los detalles no son detalles: son la razón por la que el cliente vuelve.',
  'Una llamada más. Muchas veces esa es la que cierra.',
  'El trabajo bien entregado es la mejor publicidad que existe.',
  'No hay orden pequeña: toda marca grande empezó pidiendo pocas piezas.',
  'Mide dos veces, imprime una.',
  'Vender es ayudar a alguien a decidir bien. Ayuda mucho hoy.',
  'La constancia le gana al talento cuando el talento no es constante.',
  'Un cliente contento trae a otro. Cuida al que ya tienes.',
  'Empieza por lo más difícil y el resto del día va en bajada.',
  'La puntualidad también es calidad.',
  'Lo que hoy parece mucho trabajo, mañana se llama experiencia.',
  'Tu marca también va puesta en cada prenda que entregas.',
  'Pregunta, escucha y después cotiza. En ese orden.',
  'Los equipos que se avisan a tiempo no apagan incendios.',
  'El margen se cuida en la cotización, no en la entrega.',
  'Hacerlo bien a la primera siempre sale más barato.',
  'Hoy es un buen día para recuperar a un cliente que hace rato no compra.',
  'La diferencia entre un pedido y un cliente de años es cómo lo atiendes hoy.',
  'Poco a poco se llena el tablero. Paso firme.',
  'El orden en el trabajo es tiempo que te regalas después.',
  'Nadie recuerda la cotización más barata; todos recuerdan la mejor entrega.',
  'Si hoy das un poco más de lo que te piden, mañana te piden más a ti.',
  'Cada orden entregada a tiempo es confianza ganada.',
  'El éxito es la suma de pequeños esfuerzos repetidos todos los días.',
  'Hazlo con ganas: se nota en el resultado.',
  '¡Con toda! Hoy se vende, se produce y se entrega bien.',
];

const partes = (ahora) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, weekday: 'short' }).formatToParts(ahora);
  const p = Object.fromEntries(f.map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const h24 = (Number(p.hour) % 12) + (p.dayPeriod === 'PM' ? 12 : 0);
  return { fecha: `${p.month}/${p.day}/${p.year}`, hora: `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod}`, dia: DIAS[dia] || '', h24 };
};

export default function Bienvenida({ nombre, asistente, onClose }) {
  const [ahora, setAhora] = useState(() => new Date());
  const [frase] = useState(() => FRASES[Math.floor(Math.random() * FRASES.length)]);
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    const tecla = (e) => (e.key === 'Escape' || e.key === 'Enter') && onClose();
    window.addEventListener('keydown', tecla);
    return () => { clearInterval(t); window.removeEventListener('keydown', tecla); };
  }, [onClose]);
  const { fecha, hora, dia, h24 } = partes(ahora);
  const saludo = h24 < 12 ? 'Buenos días' : h24 < 19 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <div className="bienvenida-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bienvenida" role="dialog" aria-label="Bienvenida">
        <div className="bienvenida-franja" />
        <p className="bienvenida-saludo">{saludo},</p>
        <h2>{nombre}</h2>
        <div className="bienvenida-reloj">
          <span className="bienvenida-fecha">Hoy es {dia} · {fecha}</span>
          <span className="bienvenida-hora">{hora}</span>
          <small>Hora de Maryland</small>
        </div>
        <blockquote>«{frase}»</blockquote>
        <button className="btn primary" autoFocus onClick={onClose}>¡Vamos con toda!</button>
        {asistente && <small className="muted">— {asistente}</small>}
      </div>
    </div>
  );
}
