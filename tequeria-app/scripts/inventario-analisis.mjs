// Análisis de las funciones del catálogo para el inventario (scripts/inventario.mjs).
// Separado para poder probarlo sin base de datos (tests/inventario.test.js).
export const sinComentarios = (s) => s.replace(/--[^\n]*/g, "");
export const unicos = (xs) => [...new Set(xs)].sort();
export const lista = (xs) => (xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "—");

// Lo que una función hace por sí misma: tablas que lee o escribe, funciones que llama y puntos a cuidar
export function directo(f, tablas, funciones) {
  const cuerpo = sinComentarios(f.def.slice(f.def.indexOf("AS $function$")));
  const toca = (re) => unicos([...cuerpo.matchAll(re)].map((m) => m[1]).filter((t) => tablas.has(t)));
  const escribe = unicos([
    ...toca(/insert\s+into\s+public\.(\w+)/gi), ...toca(/update\s+public\.(\w+)/gi), ...toca(/delete\s+from\s+public\.(\w+)/gi),
  ]);
  const lee = toca(/(?:from|join)\s+public\.(\w+)/gi).filter((t) => !escribe.includes(t) || /select[\s\S]*from\s+public\./i.test(cuerpo));
  const llama = unicos([...funciones].filter((n) => n !== f.nombre && new RegExp(`(?:^|[^\\w.])(?:public\\.)?${n}\\s*\\(`).test(cuerpo)));
  // _contexto(p_token, roles | null, 'tipo'): roles exigidos y tipo de llamada (MODELO.md §3.2)
  const ctx = cuerpo.match(/_contexto\(\s*p_token\s*,\s*(null|array\[([^\]]*)\])\s*,\s*'(\w+)'/);
  const roles = ctx?.[2]?.replace(/'/g, "").replace(/\s+/g, " ");
  // _dueno(p_cuenta, roles, 'tipo'): panel de dueños (MODELO.md §3.2)
  const dueno = cuerpo.match(/_dueno\(\s*p_cuenta\s*,\s*array\[([^\]]*)\]\s*,\s*'(\w+)'/);
  const acceso = !f.api ? (SOLO_SQL_EDITOR.includes(f.nombre) ? "Solo SQL Editor" : "Interna")
    : ctx ? `Sesión: ${roles || "cualquier rol"} · ${ctx[3]}`
    : dueno ? `Dueño: ${dueno[1].replace(/'/g, "").replace(/\s+/g, " ")} · ${dueno[2]}`
    : /\b_identidad\(\)/.test(cuerpo) ? "Persona con correo verificado"
    : /\b_vinculacion\(/.test(cuerpo) ? "Identidad anónima con código de vinculación"
    : /\b_dispositivo\(\)/.test(cuerpo) ? "Equipo vinculado, sin operador"
    : /\bp_token\b/.test(f.args) ? "Token propio (sin revisar rol)"
    : "Sin sesión";
  const marcas = [];
  if (/\bid\s*=\s*1\b/.test(cuerpo)) marcas.push("fila única `id = 1`");
  for (const m of cuerpo.matchAll(/pg_advisory_xact_lock(_shared)?\(hashtextextended\('([^']+)'\s*\|\|\s*([a-z_.]+)/g)) {
    const porSucursal = /sucursal_id$/.test(m[3]);
    marcas.push(`candado \`${m[2]}\`${m[1] ? " (compartido)" : ""}${porSucursal ? " por sucursal" : ` por ${m[3].replace(/^[a-z]+\./, "").replace(/^[pv]_/, "")}`}`);
  }
  for (const m of cuerpo.matchAll(/pg_advisory_xact_lock(_shared)?\(hashtextextended\('([^']+)',/g)) marcas.push(`candado \`${m[2]}\`${m[1] ? " (compartido)" : ""} global`);
  if (/'duplicado',\s*true/.test(cuerpo)) {
    marcas.push(/\.sucursal_id\s*<>\s*s\.sucursal_id/.test(cuerpo)
      ? "devuelve lo ya guardado si se repite el id (solo de su sucursal)"
      : "devuelve lo ya guardado si se repite el id (sin comprobar la sucursal)");
  }
  if (/_verificar_admin\(/.test(cuerpo)) {
    marcas.push(/_verificar_admin\(\s*s\.sucursal_id/.test(cuerpo) ? "PIN de administrador de su sucursal" : "PIN de administrador (de cualquier sucursal)");
  }
  if (/_pin_ok\(|_hash_pin\(/.test(cuerpo)) marcas.push("verifica o guarda PIN");
  if (/realtime\.send/.test(cuerpo)) marcas.push("aviso en tiempo real (canal `tequeria`, público)");
  const prefijos = unicos([...cuerpo.matchAll(/_(?:fallo|espera|limpiar_intentos)\('(\w+):'/g)].map((m) => m[1] + ":"));
  if (prefijos.length) marcas.push(`contadores de intentos ${prefijos.map((x) => `\`${x}\``).join(", ")}`);
  if (/\bnow\(\)/.test(cuerpo)) marcas.push("usa `now()`");
  const ids = (f.args.match(/\bp_(?:id|ids|ticket|tickets|mesa_id)\b/g) || []);
  if (f.api && ids.length) marcas.push(`recibe ids del cliente (${unicos(ids).join(", ")})`);
  return { lee, escribe, llama, acceso, marcas, sesion: /\b_(?:sesion|contexto|dispositivo)\(/.test(cuerpo) };
}

// Funciones que no se exponen a la API y ejecuta el proveedor desde el SQL Editor
export const SOLO_SQL_EDITOR = ["crear_admin_inicial", "crear_invitacion_inicial"];

// Contexto decidido a mano para funciones cuyo papel no se deduce de lo que leen o escriben
export const CONTEXTO_REVISADO = {
  _dispositivo: "Es el validador del equipo: de aquí sale la sucursal (auth.uid() → dispositivo sin revocar)",
  _contexto: "Es el validador de la operación: equipo y sesión del operador de esa sucursal y ese equipo",
  _cuenta_con_propietario: "Cuenta de la fila: invariante de propietario (MODELO.md §3.0)",
  _identidad: "Es el validador de personas: auth.uid() con correo verificado, no anónima y que nunca fue un equipo",
  _dueno: "Es el validador del panel de dueños: membresía en la cuenta que recibe, con su rol",
  _vinculacion: "Es el validador de la vinculación: identidad anónima sin equipo y código vigente; la sucursal sale del código",
  _preparar_sucursal: "Crea la sucursal en la cuenta que recibe (ya validada por _identidad o _dueno)",
  _log_cuenta: "Recibe la cuenta (y la sucursal, si la hay) de quien la llama",
};

// Agrega lo que hacen las funciones que llama, de forma transitiva: un ayudante que no toca tablas
// pero llama a otro que lee la configuración también depende de la sucursal.
export function conDependencias(lista) {
  const porNombre = new Map();
  for (const f of lista) porNombre.set(f.nombre, [...(porNombre.get(f.nombre) || []), f]);
  const memo = new Map();
  const cerrar = (nombre, camino = new Set()) => {
    if (memo.has(nombre)) return memo.get(nombre);
    const vacio = { lee: [], escribe: [], marcas: [], sesion: false, via: new Map() };
    if (camino.has(nombre)) return vacio;
    camino.add(nombre);
    const r = { lee: new Set(), escribe: new Set(), marcas: new Map(), sesion: false };
    for (const f of porNombre.get(nombre) || []) {
      f.lee.forEach((t) => r.lee.add(t)); f.escribe.forEach((t) => r.escribe.add(t));
      if (f.sesion) r.sesion = true;
      for (const g of f.llama) {
        const c = cerrar(g, camino);
        c.lee.forEach((t) => r.lee.add(t)); c.escribe.forEach((t) => r.escribe.add(t));
        if (c.sesion) r.sesion = true;
        for (const [m, via] of c.marcas) if (!r.marcas.has(m)) r.marcas.set(m, via);
        for (const m of (porNombre.get(g) || []).flatMap((x) => x.marcas)) if (!r.marcas.has(m)) r.marcas.set(m, g);
      }
    }
    camino.delete(nombre);
    const res = { lee: [...r.lee].sort(), escribe: [...r.escribe].sort(), marcas: r.marcas, sesion: r.sesion };
    memo.set(nombre, res);
    return res;
  };
  return lista.map((f) => {
    const c = cerrar(f.nombre);
    const leeIndirecto = c.lee.filter((t) => !f.lee.includes(t));
    const escribeIndirecto = c.escribe.filter((t) => !f.escribe.includes(t));
    const indirectas = [...c.marcas].filter(([m]) => !f.marcas.includes(m) && !m.startsWith("recibe ids"))
      .map(([m, via]) => `${m} (vía \`${via}\`)`);
    const tocaDatos = c.lee.length || c.escribe.length;
    const contexto = CONTEXTO_REVISADO[f.nombre] ? `${CONTEXTO_REVISADO[f.nombre]} (revisado)`
      : f.acceso.startsWith("Sesión") || f.acceso.startsWith("Token") ? "Sucursal de la sesión operativa"
      : f.acceso.startsWith("Dueño") ? "Cuenta elegida en el panel (membresía comprobada); sucursal e ids dentro de ella"
      : f.acceso === "Persona con correo verificado" ? "Ninguno al entrar: crea la cuenta o la membresía, o lista las suyas"
      : f.acceso.startsWith("Identidad anónima") ? "Sucursal del código de vinculación"
      : f.acceso.startsWith("Equipo") || f.acceso === "Sin sesión" ? "Sucursal del dispositivo vinculado"
      : f.acceso === "Solo SQL Editor" ? "La que indica el proveedor (parámetro)"
      : f.resultado === "trigger" && f.marcas.some((m) => m.startsWith("aviso en tiempo real")) ? "Sucursal de la fila (canal privado por sucursal)"
      : f.resultado === "trigger" ? "La fila que lo dispara"
      : c.sesion ? "Sucursal de la sesión (resuelve la sesión)"
      : tocaDatos ? `Recibe la sucursal de quien la llama${f.lee.length || f.escribe.length ? "" : " (indirecto)"}`
      : "Ninguno (no toca datos, ni directa ni indirectamente)";
    return { ...f, leeIndirecto, escribeIndirecto, indirectas, contexto };
  });
}

