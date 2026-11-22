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

## Probar en tu computadora (modo de prueba)

Necesitas **Node.js 22.13 o más nuevo** (nodejs.org → versión LTS).

```bash
git clone https://github.com/ksalebe72/Claudee.git
cd Claudee
git checkout claude/hgl-deconetwork-app-mix-wnz1nc
npm install
npm run demo
```

Abre **http://localhost:3001**. La primera vez pide crear la cuenta del dueño. El modo de prueba usa una base aparte (`data/demo.db`) con datos de ejemplo y **simuladores** de SanMar y de la IA (respuestas fijas), así que se puede probar todo sin claves. `npm run demo -- --reset` empieza de cero.

## Publicarla en internet (Render)

El repositorio ya trae `render.yaml`: en Render, **New → Blueprint**, eliges este repositorio y la rama, y Render crea el servicio con un disco persistente para la base, los archivos y los respaldos. La cuenta del dueño solo se crea con el código de instalación (`SETUP_CODE`), que Render genera. Los respaldos se hacen cada día y se descargan desde **Ajustes → General → Respaldos**.

Paso a paso completo: **[DESPLEGAR-EN-RENDER.md](DESPLEGAR-EN-RENDER.md)**.

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
| `SEED_DEMO=0` | Arranca sin los contactos de ejemplo |

`npm run seed` borra la base y la vuelve a crear con los datos iniciales. `npm test` corre las pruebas.

## Usuarios y roles

La primera vez que se abre la app, pide crear la **cuenta del dueño**. No hay contraseñas por defecto. Después, el dueño crea los demás usuarios en **Ajustes → Usuarios**.

| Rol | Puede |
|---|---|
| Dueño | Todo. Es el único que cambia la matriz, las comisiones y los usuarios, autoriza excepciones por contribución negativa y aprueba liquidaciones. |
| Finanzas (CFO) | Registrar costos reales y créditos, confirmar costos, revisar liquidaciones y marcarlas como pagadas, ver reportes. |
| Gerencia | Aprobar órdenes con contribución bajo el mínimo y ver reportes y liquidaciones. |
| Coordinación de ventas | Vende, ve todos los clientes y órdenes, asigna clientes a cada vendedor y manda a producción. |
| Ventas | Solo **sus** clientes (los que creó o le asignaron) y las órdenes de esos clientes o a su nombre. Cotiza siempre a su nombre y con su regla de comisión automática. |
| Logística | Órdenes, producción, tareas y datos de entrega del cliente. No ve costos, márgenes ni comisiones; no cotiza ni cambia precios. |

Los permisos se revisan en el servidor: si un vendedor intenta abrir un cliente u orden ajena, la app responde «no encontrado». Cada cliente tiene un **vendedor** (Contactos → editar); los clientes que ya existían quedan asignados al vendedor de sus órdenes.

Las sesiones usan una cookie HttpOnly y las contraseñas se guardan con hash scrypt. El portal del cliente sigue siendo público por enlace y nunca muestra costos.

## Costos, rentabilidad y comisiones

### Matriz de precios y costos (Ajustes → Tarifas)

Todo es editable solo por el dueño. Cada guardado crea una **versión nueva** y registra cada valor cambiado en el **historial**: quién, cuándo, valor anterior y valor nuevo. Una cotización guarda la versión con que se calculó, así que un cambio de tabla no la modifica. Si se quiere, se puede **recalcular con las tarifas vigentes** desde la propia cotización.

| Concepto | Valores iniciales |
|---|---|
| Prendas | Precio = costo × factor. Modo escalonado: costo < $5.00 → ×2.20; desde $5.00 → ×2.00. Modo fijo: ×2.00. Se puede poner una excepción por producto (porcentaje o precio fijo). El precio puesto a mano en una línea queda marcado "precio manual". |
| Bordado | $4.50 por logo y ubicación (columnas de COSTO y PRECIO por separado). La tabla está lista para rangos de puntadas y de cantidad. El digitalizado va como línea "Diseño/Digitalizado". |
| DTF | Costo: área ÷ 144 × $4.00 + $1.60 de aplicación. Precio, primera ubicación: ≤15 in² $6.00 · ≤95 $10.50 · ≤105 $11.50 · más $25.00. Ubicación adicional: ≤15 $1.00 · ≤95 $5.50 · más $25.00. Sin mínimo. |
| Heat Transfer | Estructura lista (por hoja con tramos, aplicación, mínimo), pero sin valores. Hasta que se llenen, el costo queda "pendiente" y el precio se pone a mano. |
| Impuesto | Maryland 6% sobre productos + envío cobrado. Cliente exento = 0%. |
| Márgenes | Objetivo 35%, mínimo 30%. |
| Pago de comisiones | Día 15 del mes siguiente. |

**Costo desconocido = nunca cero.** Si falta un costo, la rentabilidad y la comisión quedan "incompletas" y la orden dice exactamente qué falta.

### Rentabilidad por orden

| Concepto | Cálculo |
|---|---|
| Venta de productos | Líneas − descuentos de línea − descuento global − créditos |
| Ingreso sin impuesto | Venta de productos + envío cobrado |
| Ganancia de producto | Venta de productos − (prendas + decoración + setup + otros costos directos) |
| Ganancia bruta | Ganancia de producto + (envío cobrado − costo de envío) |
| Contribución | Ganancia bruta − comisión |

**Semáforo:**
- Verde: ≥ objetivo.
- Amarillo: entre el mínimo y el objetivo.
- Rojo: bajo el mínimo. Gerencia debe aprobarla antes de marcarla como enviada o convertirla en orden.
- Contribución negativa: requiere una excepción del dueño, con motivo.

**Costos reales.** Finanzas registra las facturas de proveedor (SanMar, S&S, Halftone, envío…) por categoría. El costo real reemplaza al cotizado y la orden muestra la diferencia. Luego Finanzas **confirma los costos**.

### Comisiones

| Regla | Tasa | Base |
|---|---|---|
| Bryan · Ventas | 25% | venta neta |
| Bryan · Wraps | 50% | ganancia de producto |
| Isabel · Cliente existente | 5% | venta neta |
| Isabel · Cliente nuevo | 10% | venta neta |
| Sin comisión | 0% | — |

- **Configuración:** cada regla puede calcularse sobre venta neta, ganancia de producto o ganancia de producto + envío. Las tasas tienen fecha de vigencia y se usa la vigente en la fecha de factura.
- **Cliente nuevo o existente:** es "existente" si tiene otra orden cobrada al 100%. Se puede corregir a mano.
- **Base comisionable:** excluye impuesto, envío, líneas de Diseño/Digitalizado y productos marcados como no comisionables (las mensualidades de websites y media players vienen así).
- **Base sobre ganancia negativa:** la comisión es $0.
- **Falta un costo y la regla es sobre ganancia:** la comisión queda "pendiente".

### Liquidación mensual (Finanzas → Liquidación de comisiones)

1. Elige el mes. Entran las órdenes **cobradas al 100%** y con **costos confirmados**, en el mes en que se completó el cobro. Abajo se listan las que aún no entran y por qué (falta cobro o falta costo).
2. **Finanzas** pulsa "Marcar revisada". La liquidación queda congelada.
3. **El dueño** pulsa "Aprobar".
4. Se paga **fuera del sistema** (cheque, transferencia, nómina). Luego Finanzas o el dueño la marcan como **pagada**, con fecha y referencia.
5. Si después hay una devolución, un crédito o un costo tardío, se crea un **ajuste** (negativo o positivo) en la siguiente liquidación abierta del vendedor. Una liquidación revisada, aprobada o pagada nunca se edita.
6. Cada liquidación se exporta a **PDF** y a **Excel**.

### Reportes (Finanzas → Reportes)

- Rentabilidad por orden, cliente, proceso (prendas, bordado, DTF, heat transfer, servicios) y vendedor, filtrada por fecha de factura.
- Órdenes bajo el mínimo de contribución.
- Comisiones por vendedor: pendientes de cobro, pendientes de costo, listas, aprobadas, pagadas y ajustes.

### Reglas que el sistema respeta

- **No envía nada al cliente:** las automatizaciones de SMS y email vienen apagadas y la capa de mensajes solo registra.
- **No cobra.**
- **No crea órdenes de compra.**
- **No paga comisiones.**

## SanMar (productos, fotos, precios e inventario · solo lectura)

La app solo **consulta** a SanMar. Nunca crea órdenes de compra ni envía datos.

### Configuración

Pon tus credenciales de SanMar Web Services en variables de entorno o en `.env` (ver `.env.example`). Nunca van en el código:

```
SANMAR_CUSTOMER_NUMBER=...
SANMAR_USERNAME=...
SANMAR_PASSWORD=...
```

Opcionales:
- `SANMAR_BASE_URL`: por defecto `https://ws.sanmar.com:8080`, el servidor de producción.
- `SANMAR_EXTRA_IMAGE_HOSTS`: otros dominios de los que se aceptan fotos.

### Prueba real

```bash
npm run sanmar:probar -- PC61               # resumen: colores, combinaciones, fotos, precio e inventario
npm run sanmar:probar -- PC61 --estructura  # además, la estructura XML con los valores ocultos
```

No imprime la contraseña, los precios ni la respuesta completa. La salida de `--estructura` se puede compartir: solo trae los nombres de las etiquetas.

### Módulo `services/sanmar/` (independiente de la app)

```js
import { createSanmarClient } from './services/sanmar/index.js';
const sanmar = createSanmarClient();                     // lee SANMAR_* del entorno
await sanmar.buscarEstilo('PC61');                       // { estilo, marca, descripcion, peso, colores:[{ nombre, codigo, swatch, fotos:{frente, espalda, lado, plana, modelo}, tallas }], tallas }
await sanmar.obtenerColores('PC61');
await sanmar.obtenerFotos('PC61', 'Navy');
await sanmar.obtenerTallasYPrecios('PC61', 'Navy');      // [{ talla, costo, fuenteCosto, precioLista }]
await sanmar.obtenerInventario('PC61', 'Navy', 'M');     // { total, almacenes:[{ id, nombre, cantidad }] }
await sanmar.obtenerDetalleColor('PC61', 'Navy');        // tallas con costo e inventario
```

| Archivo | Qué hace |
|---|---|
| `index.js` | Cliente con las funciones, caché, conversión a JSON. |
| `soap.js` | Llamadas SOAP, tiempo de espera, reintentos y oculta las credenciales en los mensajes. |
| `xml.js` | Lector XML sin dependencias. |
| `errors.js` | Códigos de error. |

**Servicios.** Usa los servicios web propios de SanMar, no PromoStandards:

| Servicio | Operación |
|---|---|
| `SanMarProductInfoServicePort` | `getProductInfoByStyleColorSize` |
| `SanMarPricingServicePort` | `getPricing` |
| `SanMarWebServicePort` | `getInventoryQtyForStyleColorSize` |

**Caché.** Productos y fotos 24 h, precios 12 h, inventario 15 min. En la app la caché se guarda en SQLite y las fotos en `server/uploads/sanmar/`.

**Errores.** Cada error trae un código: `NO_CONFIGURADO`, `CREDENCIALES`, `NO_ENCONTRADO`, `TIEMPO_AGOTADO`, `LIMITE`, `RED`, `RESPUESTA_INVALIDA` o `ERROR_SANMAR`. Si falla la red, se agota el tiempo o hay límite, reintenta hasta 3 veces esperando 0.8 s, luego 2 s y luego 5 s.

### Endpoints de la app

| Endpoint | Devuelve |
|---|---|
| `GET /api/sanmar/style/:estilo` | Descripción, marca, colores con fotos y tallas. |
| `GET /api/sanmar/style/:estilo/:color` | Por talla: `costo` (de SanMar), `precioVenta` (calculado por la app), `inventario` y `almacenes`. |
| `POST /api/sanmar/import` `{ style }` | Agrega el estilo al catálogo local. |

`?refresh=1` en cualquiera de los dos `GET` ignora la caché.

**Precio de venta.** Es `costo × (1 + markup)` y se calcula en la app, no en el módulo de SanMar. El markup por defecto es 100% (costo × 2) y se cambia en **Ajustes**.

### En el decorador

- Si el producto de la orden es de SanMar, carga sola la foto real (plana o con modelo).
- **Ajustar área** sirve para calibrar el área de impresión sobre la foto. Se guarda por estilo.

## Inteligencia artificial (Claude)

Tres funciones, todas de **solo lectura o borrador**: la IA no guarda, no envía y no cobra nada por su cuenta.

| Función | Dónde | Qué hace |
|---|---|---|
| Cotizar desde un mensaje | Cotizaciones → ✨ Cotizar desde mensaje | Pegas el email, SMS o WhatsApp del cliente y arma un borrador: cliente (reconoce contactos existentes), prendas del catálogo, tallas, decoraciones, ubicaciones, fecha y lo que falta preguntar. **Los precios los calcula la matriz, nunca la IA.** Revisas y pulsas «Crear borrador». |
| Don Pixel (asistente del negocio) | Menú → ✨ Don Pixel (todos los usuarios) | Responde preguntas con los datos de los últimos ~13 meses, recortados al acceso de quien pregunta: el vendedor solo sus clientes y su comisión; Logística sin montos; Coordinación sin liquidaciones. No puede cambiar nada. |
| Redactar mensajes | En cada cotización u orden → ✨ Redactar mensaje | Borradores (enviar cotización, seguimiento, aprobar arte, orden lista, recordatorio de pago o libre) en español o inglés, con el tono de Color Plus. Se copian o se guardan como nota; **no se envían**. La IA nunca recibe costos ni márgenes. |

### Activarla

1. Entra a **console.anthropic.com** con la cuenta de la empresa → **API Keys** → **Create Key**. (La clave de la API es distinta de la suscripción de Claude; se paga por uso.)
2. Ponla en el servidor como variable de entorno o en `.env` — nunca en el código:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Reinicia la app. En **Ajustes → General** debe decir «IA activa».

Opcional: `IA_MODEL` (por defecto `claude-opus-5-5`). Si el modelo rechaza una petición por sus filtros de seguridad, la API la reintenta automáticamente con otro modelo (respaldo del servidor).

**Privacidad y costo:** el texto que pegas y los datos que usa el asistente se envían a la API de Anthropic para procesarlos. Hay un límite de 40 consultas por hora por usuario y el dueño ve el uso del mes en Ajustes; el gasto detallado está en console.anthropic.com. El contenido de los mensajes nunca se escribe en los logs.

## SMS y email reales

Por ahora los mensajes **se registran** en la conversación del contacto, pero no salen. Para enviarlos de verdad hay que conectar un proveedor en `server/messaging.js`: Twilio para SMS, SMTP o SendGrid para email, o la API de HighLevel si quieres seguir usando sus números.

## Estructura

```
server/   API Express + SQLite (node:sqlite): auth, finanzas (rentabilidad, liquidación), tarifas versionadas, exportación PDF/Excel
shared/   motor de precios, costos y rentabilidad (lo usan el servidor y el navegador)
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
