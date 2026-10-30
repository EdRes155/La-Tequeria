// Revisa que no se versionen ni se publiquen secretos de Supabase.
// Uso: node scripts/check-secrets.mjs   (revisa archivos de git y, si existe, dist/)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const hallazgos = [];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const PATRONES = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "llave secreta de Supabase (sb_secret_)"],
  [/SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S{20,}/, "SUPABASE_SERVICE_ROLE_KEY con valor"],
  [/SUPABASE_JWT_SECRET\s*=\s*\S{10,}/, "SUPABASE_JWT_SECRET con valor"],
  [/postgres(ql)?:\/\/[^:\s]+:[^@\s]{6,}@[^\s]*supabase/, "cadena de conexión a Postgres con contraseña"],
];

function revisar(archivo, texto) {
  for (const [re, desc] of PATRONES) if (re.test(texto)) hallazgos.push(`${archivo}: ${desc}`);
  for (const jwt of texto.match(JWT) || []) {
    try {
      const carga = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
      if (carga.role && carga.role !== "anon") hallazgos.push(`${archivo}: JWT con rol "${carga.role}"`);
    } catch {}
  }
}

const versionados = execSync("git ls-files", { cwd: raiz, encoding: "utf8" }).split("\n").filter(Boolean);
for (const f of versionados) {
  if (/(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")) hallazgos.push(`${f}: archivo .env versionado`);
  const ruta = path.join(raiz, f);
  if (!fs.existsSync(ruta) || fs.statSync(ruta).size > 2_000_000 || /\.(png|jpe?g|gif|zip|ico)$/i.test(f)) continue;
  revisar(f, fs.readFileSync(ruta, "utf8"));
}
const dist = path.join(raiz, "dist");
if (fs.existsSync(dist)) {
  const recorrer = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) recorrer(p); else if (/\.(js|html|css|json)$/.test(e.name)) revisar(path.relative(raiz, p), fs.readFileSync(p, "utf8"));
  });
  recorrer(dist);
}

if (hallazgos.length) {
  console.error("Posibles secretos encontrados:\n- " + hallazgos.join("\n- "));
  process.exit(1);
}
console.log(`Sin secretos: ${versionados.length} archivos versionados${fs.existsSync(dist) ? " + dist/" : ""} revisados.`);
