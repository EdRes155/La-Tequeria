# La Tequería — Sistema de comandas (versión con Supabase, tiempo real)

Página web para tomar comandas (mesas, para llevar, domicilio), cocina, inventario,
gastos, precios y administración. Con **Supabase** todos los dispositivos ven lo
mismo al instante: el mesero manda la comanda desde su celular y aparece en la
tablet de cocina; una mesa se ocupa y se ve en todos lados.

Login de prueba — Edwin (admin): **1234** · Mesero 1: **1111**

---

## PASO 1 — Crear el proyecto en Supabase (gratis, ~5 min)
1. Entra a https://supabase.com y crea una cuenta.
2. **New project**. Ponle nombre y una contraseña de base de datos. Espera a que termine.
3. Ve a **SQL Editor → New query**, pega TODO el contenido de **supabase-schema.sql**
   (está en esta carpeta) y dale **Run**. Eso crea la tabla y activa el tiempo real.
4. Ve a **Project Settings → API** y copia dos cosas:
   - **Project URL**
   - **anon public** key

## PASO 2 — Configurar la app
1. En esta carpeta, copia el archivo **.env.example** y renómbralo a **.env**
2. Pega tus valores:
   ```
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ... (tu llave anon)
   ```

## PASO 3 — Probarlo en tu computadora
Requiere Node.js 18+.
```
npm install
npm run dev
```
Abre la URL que aparece (ej. http://localhost:5173). En el login debe decir
**"En línea — sincronizado entre dispositivos"**. Abre la misma URL en otra
pestaña/dispositivo y verás que los cambios aparecen en ambos.

## PASO 4 — Publicarlo (para abrirlo desde cualquier dispositivo con una URL)
**Opción Vercel (recomendada):**
1. Sube esta carpeta a un repo de GitHub.
2. En https://vercel.com → New Project → importa el repo.
3. Framework: **Vite**. Agrega las variables de entorno
   `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (mismas del .env).
4. Deploy. Te da una URL pública.

**Opción Netlify (arrastrando):**
1. `npm run build` (genera la carpeta **dist/**).
2. Arrastra **dist/** a https://app.netlify.com/drop
   (Para que tome las variables, mejor conéctalo desde GitHub y ponlas en
   Site settings → Environment variables; el "drag and drop" no lee el .env.)

---

## Cómo funciona la sincronización
- Todo el estado del negocio se guarda en una tabla `app_state` de Supabase.
- Cada cambio se guarda y se transmite por **Realtime** a los demás dispositivos.
- Si no configuras Supabase, la app sigue funcionando en **modo local** (cada
  dispositivo guarda lo suyo), útil para probar.

## Notas y siguiente nivel
- El login por PIN es sencillo (pensado para uso interno del negocio); no es
  autenticación bancaria. Para algo más estricto se puede usar Supabase Auth.
- El estado se guarda como un bloque único. Para muchísimos meseros escribiendo
  a la vez, el siguiente endurecimiento es separar en tablas (comandas, mesas,
  etc.). Para una taquería normal, así va muy bien.

## Estructura
- `supabase-schema.sql` — pégalo en Supabase (crea la tabla + tiempo real)
- `.env` — tus llaves de Supabase (créalo a partir de `.env.example`)
- `src/supabaseClient.js` — conexión a Supabase
- `src/store.js` — carga, guardado y tiempo real
- `src/main.jsx` — arranque de React
- `src/App.jsx` — toda la aplicación
