# Taller OS

Una sola app para manejar un taller de impresión y decoración textil. Junta en un mismo sistema lo que hoy se hace en **HighLevel**: CRM, pipeline, conversaciones, tareas y automatizaciones. Y lo que se hace en **DecoNetwork**: catálogo, cotizador por tallas y decoración, órdenes, aprobación de arte, producción, pagos y portal del cliente.

## Qué incluye

| Módulo | Qué hace |
|---|---|
| **Tablero** | Pipeline abierto, cotizaciones sin cerrar, órdenes activas y atrasadas, cobrado del mes, cuentas por cobrar, tareas de hoy y actividad reciente. |
| **Contactos** | Ficha del cliente con etiquetas, origen, oportunidades, trabajos, tareas y una **conversación** (SMS, email, llamadas, notas). |
| **Pipeline** | Kanban de oportunidades (Nuevo → Contactado → Cotizado → Negociación → Ganado/Perdido) con drag & drop. |
| **Cotizaciones** | Precio por **talla** (recargo automático 2XL+), varias **decoraciones por pieza** (serigrafía, bordado, DTF, vinil, sublimación) con escalas por cantidad, colores y setup. Descuento, impuesto, duplicar y enlace para el cliente. |
| **Portal del cliente** | Enlace público donde el cliente **aprueba la cotización** y **aprueba o pide cambios en la prueba de arte**. |
| **Órdenes / Producción** | Al aprobarse, la cotización se vuelve orden de trabajo. Pasa por Arte → Esperando aprobación → Pedido de blanks → Producción → Control de calidad → Listo → Entregado. Tablero kanban, fechas de entrega, prioridad (rush) y orden imprimible. |
| **Decorador de pruebas** | Dentro de la orden: eliges la prenda (camiseta, polo, sudadera, gorra, bolsa) y su color, subes el logo del cliente o agregas textos, y los acomodas (mover, cambiar tamaño, girar) en cada ubicación con su área de impresión real. Marca en rojo lo que se sale del área. Genera la **hoja de prueba** (frente y espalda con medidas en pulgadas, método, colores de tinta y cantidades por talla) y la envía al cliente con un clic. Cada versión se puede volver a abrir y editar. |
| **Pruebas de arte** | También puedes subir una imagen o PDF ya terminado. Las pruebas llevan versiones; el cliente las aprueba desde el portal y la orden avanza sola. |
| **Cobranza** | Anticipos, pagos parciales, saldos y órdenes listas o entregadas que aún no se han pagado. |
| **Catálogo y precios** | Blanks (SKU, marca, proveedor, colores, tallas, costo) y métodos de decoración con su tabla de precios editable. El markup se configura en Ajustes. |
| **Automatizaciones** | Reglas del tipo "cuando pasa X, haz Y": crear tarea, enviar SMS o email con variables, cambiar el estado de la orden, convertir en orden, mover la oportunidad o etiquetar al contacto. |

### Flujo automático incluido de fábrica

1. Entra un lead. Se crea una tarea de seguimiento y se envía un SMS de bienvenida.
2. Envías la cotización. La oportunidad pasa a "Cotizado", el cliente recibe un email con el enlace y se crea un recordatorio a 2 días.
3. El cliente aprueba en el portal. Se crea la orden y la oportunidad pasa a "Ganado".
4. Subes la prueba de arte. El cliente recibe un SMS con el enlace.
5. Si aprueba, la orden pasa a "Pedido de blanks". Si pide cambios, vuelve a "Arte" y se le crea una tarea al diseñador.
6. Cuando la orden está lista, se envía un SMS para recoger. Al entregarla, se envía un email pidiendo una reseña.

Todas estas reglas se pueden activar, desactivar o editar en **Automatizaciones**.

## Cómo correrla

Requiere **Node.js 22.13 o superior**. No usa base de datos externa: trae SQLite integrado y guarda todo en `data/taller.db`.

```bash
npm install
npm run dev        # desarrollo: API en :3001 y web en http://localhost:5173
```

Producción:

```bash
npm run build
npm start          # sirve todo en http://localhost:3001
```

Variables de entorno opcionales:

| Variable | Uso |
|---|---|
| `PORT` | Puerto (por defecto 3001) |
| `DB_PATH` | Ruta del archivo SQLite |
| `APP_USER` / `APP_PASSWORD` | Protege el panel con usuario y contraseña. El portal del cliente sigue siendo público. |
| `SEED_DEMO=0` | Arranca sin los contactos de ejemplo |

`npm run seed` borra la base y la vuelve a crear con los datos iniciales. `npm test` corre las pruebas.

## SMS y email reales

Por ahora los mensajes **se registran** en la conversación del contacto, pero no salen. Para enviarlos de verdad hay que conectar un proveedor en `server/messaging.js`: Twilio para SMS, SMTP o SendGrid para email, o la API de HighLevel si quieres seguir usando sus números.

## Estructura

```
server/   API Express + SQLite (node:sqlite), automatizaciones, mensajería
shared/   motor de precios (lo usan el servidor y el navegador)
client/   React + Vite
tests/    pruebas del cotizador y del flujo completo
```

## Siguientes pasos sugeridos

- Envío real de SMS y email (Twilio, SendGrid).
- Pagos en línea desde el portal (Stripe o Square) y sincronización con QuickBooks.
- Importar catálogo y existencias de SanMar, S&S y alphabroder.
- Usuarios con roles (ventas, arte, producción) y login.
- Tienda en línea / designer para clientes (equivalente a las tiendas de DecoNetwork).
- Formularios de captura de leads y calendario de citas.
