#!/usr/bin/env node
// Huella del esquema public a partir de scripts/catalogo-esquema.sql. Sirve para demostrar que una
// base reproduce exactamente otro esquema (por ejemplo, la instantánea de producción en
// tests/sql/esquema-v3.sql) sin leer datos.
//   node scripts/huella-esquema.mjs filas.json            → imprime la huella de las filas del catálogo
//   node scripts/huella-esquema.mjs a.json b.json         → además lista las entradas que difieren
// Los archivos son el resultado del catálogo como arreglo JSON de {categoria, entrada, cuerpo}.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const sha = (t) => createHash("sha256").update(t).digest("hex");

// Quita comentarios y reduce los espacios a uno solo, pero SOLO fuera de literales: el contenido de
// '…', E'…', "…" y $etiqueta$…$etiqueta$ se conserva exacto. Así dos cuerpos con el mismo código y
// distintos comentarios (Supabase puede descartarlos al aplicar el SQL) dan lo mismo, y cambiar un
// espacio dentro de un texto no.
export function normalizarSql(texto) {
  const s = String(texto ?? "");
  let out = "", i = 0, espacio = false;
  const emitir = (t) => { if (espacio && out) out += " "; espacio = false; out += t; };
  const identificador = (c) => /[A-Za-z0-9_$]/.test(c ?? "");
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (/\s/.test(c)) { espacio = true; i++; continue; }
    if (c === "-" && d === "-") { while (i < s.length && s[i] !== "\n") i++; espacio = true; continue; }
    if (c === "/" && d === "*") {
      let nivel = 0;
      do {
        if (s[i] === "/" && s[i + 1] === "*") { nivel++; i += 2; }
        else if (s[i] === "*" && s[i + 1] === "/") { nivel--; i += 2; }
        else i++;
      } while (i < s.length && nivel > 0);
      espacio = true; continue;
    }
    if (c === "'" || ((c === "E" || c === "e") && d === "'" && !identificador(s[i - 1]))) {
      const escape = c !== "'";
      let j = escape ? i + 2 : i + 1;
      while (j < s.length) {
        if (escape && s[j] === "\\") { j += 2; continue; }
        if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; }
        if (s[j] === "'") { j++; break; }
        j++;
      }
      emitir(s.slice(i, j)); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '"' && s[j + 1] === '"') { j += 2; continue; } if (s[j] === '"') { j++; break; } j++; }
      emitir(s.slice(i, j)); i = j; continue;
    }
    if (c === "$" && !identificador(s[i - 1])) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i));
      if (m) {
        const fin = s.indexOf(m[0], i + m[0].length);
        const j = fin < 0 ? s.length : fin + m[0].length;
        emitir(s.slice(i, j)); i = j; continue;
      }
    }
    emitir(c); i++;
  }
  return out;
}

const entradasPorCategoria = (filas) => {
  const por = {};
  for (const f of filas) {
    const e = f.cuerpo == null ? f.entrada : `${f.entrada} | cuerpo=${sha(normalizarSql(f.cuerpo))}`;
    (por[f.categoria] ||= []).push(e);
  }
  for (const k of Object.keys(por)) por[k].sort();
  return por;
};

// { categoria: { n, h } } con las categorías en orden
export function huellaEsquema(filas) {
  const por = entradasPorCategoria(filas);
  return Object.fromEntries(Object.keys(por).sort().map((k) => [k, { n: por[k].length, h: sha(por[k].join("\n")).slice(0, 32) }]));
}

// Entradas que están en una y no en la otra, por categoría (para encontrar la diferencia)
export function diferenciasEsquema(filasA, filasB) {
  const a = entradasPorCategoria(filasA), b = entradasPorCategoria(filasB);
  const res = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = new Set(a[k] || []), y = new Set(b[k] || []);
    const soloA = [...x].filter((e) => !y.has(e)), soloB = [...y].filter((e) => !x.has(e));
    if (soloA.length || soloB.length) res[k] = { soloA, soloB };
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [fa, fb] = process.argv.slice(2);
  if (!fa) { console.error("Uso: node scripts/huella-esquema.mjs filas.json [otras.json]"); process.exit(2); }
  const leer = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const a = leer(fa);
  console.log(JSON.stringify(huellaEsquema(a), null, 2));
  if (fb) {
    const dif = diferenciasEsquema(a, leer(fb));
    console.log(JSON.stringify(dif, null, 2));
    process.exit(Object.keys(dif).length ? 1 : 0);
  }
}
