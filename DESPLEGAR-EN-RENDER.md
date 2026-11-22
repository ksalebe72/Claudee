# Publicar ColorPlus OS en Render

Guía paso a paso para tener la app en internet con tu propio enlace (por ejemplo `https://colorplus-os.onrender.com`, o `os.colorplusllc.com` si usas tu dominio).

> **Las claves nunca se escriben en el código, en el chat ni en correos.** Solo se ponen en la pantalla **Environment** de Render.

---

## Qué ya está preparado en el código

| Qué | Para qué sirve |
|---|---|
| `render.yaml` | Render lee este archivo y crea el servicio solo: cómo construir, cómo arrancar y el disco. |
| Disco persistente (`/var/data`, 1 GB) | Aquí viven la base de datos, los logos y artes subidos y los respaldos. Sobreviven a cada actualización. |
| Código de instalación (`SETUP_CODE`) | Render lo genera al azar. Sin ese código nadie puede crear la cuenta del dueño. |
| Conexión segura (https) | Render pone el candado. La app marca la cookie de sesión como segura. |
| Chequeo de salud (`/api/salud`) | Si la app se cae, Render la reinicia sola. |
| Respaldos diarios | Una copia de la base cada día. Se guardan las últimas 14. Se descargan en **Ajustes → General → Respaldos**. |
| Sin datos de prueba | `SEED_DEMO=0`: la app arranca vacía, solo con tus tarifas y reglas de comisión. |

---

## Paso 1 · Crear la cuenta en Render

1. Entra a **render.com** y crea la cuenta. Lo más fácil es usar **Sign in with GitHub**.
2. Autoriza a Render a ver el repositorio **ksalebe72/Claudee**. Basta con ese, no hace falta darle acceso a todos.

## Paso 2 · Crear el servicio desde el Blueprint

1. En el panel de Render: **New → Blueprint**.
2. Elige el repositorio **ksalebe72/Claudee**.
3. Elige la rama **`claude/hgl-deconetwork-app-mix-wnz1nc`**. Es la que tiene la app. Si más adelante la unes a `main`, cambia `branch:` en `render.yaml`.
4. Render muestra lo que va a crear: el servicio web **colorplus-os** con un disco **datos**.
5. Te pide los valores marcados como secretos. Puedes dejarlos vacíos ahora y llenarlos después, en el Paso 4:
   - `ANTHROPIC_API_KEY`: la clave de la IA, creada en console.anthropic.com.
   - `SANMAR_CUSTOMER_NUMBER`, `SANMAR_USERNAME`, `SANMAR_PASSWORD`: tus datos del API de SanMar.
6. Pulsa **Apply**. La primera construcción tarda unos minutos.

> El plan es **Starter** porque el plan gratis **no permite disco**. Sin disco, la base de datos se borraría en cada reinicio. Revisa el precio en la página de Render antes de confirmar: desde aquí no pude verificarlo. Calcula unos USD 7/mes por el servicio, más unos centavos por GB de disco.

## Paso 3 · Crear la cuenta del dueño (hazlo enseguida)

1. En Render abre el servicio **colorplus-os → Environment** y copia el valor de **`SETUP_CODE`**.
2. Abre el enlace de la app, que aparece arriba en el panel del servicio, tipo `https://colorplus-os.onrender.com`.
3. Llena tu nombre, usuario, contraseña (mínimo 8 caracteres; usa una larga) y el **código de instalación**.
4. Listo. Después de crear tu cuenta, el código ya no sirve para nada: la pantalla de instalación desaparece.
5. Entra a **Ajustes → Usuarios** y crea las cuentas de tu equipo con su rol: finanzas, gerencia o ventas.

## Paso 4 · Poner las claves (SanMar e IA)

1. **colorplus-os → Environment → Edit**.
2. Pega cada valor en su variable:
   - `ANTHROPIC_API_KEY`
   - `SANMAR_CUSTOMER_NUMBER`
   - `SANMAR_USERNAME`
   - `SANMAR_PASSWORD`
3. **Save Changes**. Render reinicia la app sola en unos segundos.
4. Revisa en **Ajustes → General**: *Inteligencia artificial* debe decir que está conectada. En **Catálogo → Importar de SanMar**, prueba con el estilo **PC61**.

> La app nunca muestra ni guarda en los logs la contraseña de SanMar ni la clave de la IA.

## Paso 5 (opcional) · Tu propio dominio

1. **colorplus-os → Settings → Custom Domains → Add**: por ejemplo `os.colorplusllc.com`.
2. Render te da un registro **CNAME**. Agrégalo donde administras el dominio (GoDaddy, Namecheap, Cloudflare…).
3. En unos minutos u horas el dominio queda activo con candado (https), sin costo extra.

---

## Uso diario

- **Actualizaciones**: cada cambio que se sube a la rama se publica solo (`autoDeploy`). Durante la actualización la app se reinicia y no responde por unos segundos. Mejor no publicar en medio de una cotización importante.
- **Respaldos**:
  - Se hacen solos una vez al día.
  - En **Ajustes → General → Respaldos** puedes hacer uno al momento con **Respaldar ahora** y descargarlos.
  - **Recomendación**: una vez por semana descarga el último y guárdalo en tu Google Drive. Así tienes una copia fuera de Render.
- **Si algo falla**: en Render, **colorplus-os → Logs** muestra los mensajes de la app. No aparecen contraseñas ni datos de tarjetas.

## Restaurar un respaldo (solo si algo grave pasa)

1. Descarga el respaldo que quieres recuperar, por ejemplo `colorplus-2026-11-20.db`.
2. En Render, abre **colorplus-os → Shell** y ejecuta:
   ```
   cp /var/data/colorplus.db /var/data/colorplus-antes-de-restaurar.db
   ```
3. Reemplaza `/var/data/colorplus.db` por el respaldo. Puedes subirlo con `curl` desde un enlace temporal, o pídeme ayuda en ese momento.
4. Reinicia el servicio con **Manual Deploy → Restart service**.

---

## Variables que usa la app

| Variable | Valor en Render | Nota |
|---|---|---|
| `NODE_VERSION` | `22` | La app necesita Node 22 o más nuevo. |
| `DB_PATH` | `/var/data/colorplus.db` | En el disco persistente. |
| `UPLOAD_DIR` | `/var/data/uploads` | Logos y artes. |
| `BACKUP_DIR` | `/var/data/respaldos` | Respaldos diarios. |
| `SEED_DEMO` | `0` | Sin datos de prueba. |
| `SETUP_CODE` | generado por Render | Solo para crear la cuenta del dueño. |
| `ANTHROPIC_API_KEY` | tú la pones | Secreto. |
| `SANMAR_*` | tú los pones | Secretos. |
| `IA_MODEL` | opcional | Si no se pone, usa el modelo por defecto. |
| `BACKUP_KEEP` | opcional | Cuántos respaldos guardar. Por defecto, 14. |
