#!/usr/bin/env node
// Correos de Supabase Auth en STAGING (docs/multinegocio/STAGING.md), nunca producción: aplica las plantillas
// en español de supabase/correos/ y dice si ya están el servidor de correo (Gmail) y la entrada con Google.
//   node scripts/staging/correos.mjs
// La contraseña de aplicación de Gmail y el secreto de Google no pasan por aquí: los escribe el dueño en el
// panel de Supabase. Este script no los lee ni los imprime.
import { readFileSync } from "node:fs";
import { abrirStaging, administracion } from "./comun.mjs";

await abrirStaging();
const dir = new URL("../../supabase/correos/", import.meta.url);
const leer = (f) => readFileSync(new URL(f, dir), "utf8");
// Supabase solo deja cambiar las plantillas con un servidor de correo propio
const antes = await administracion("/config/auth");
if (!antes.smtp_host) {
  console.log("Falta el servidor de correo (Gmail) en Authentication → Emails → SMTP Settings; sin él, Supabase no deja cambiar las plantillas.");
  console.log(`Entrar con Google: ${antes.external_google_enabled ? "activado" : "desactivado"}`);
  process.exit(1);
}
await administracion("/config/auth", { metodo: "PATCH", cuerpo: {
  mailer_subjects_confirmation: "Confirma tu correo para La Tequería",
  mailer_templates_confirmation_content: leer("confirmacion.html"),
  mailer_subjects_recovery: "Tu contraseña de La Tequería",
  mailer_templates_recovery_content: leer("recuperacion.html"),
  mailer_subjects_magic_link: "Te invitaron a La Tequería",
  mailer_templates_magic_link_content: leer("enlace-de-acceso.html"),
} });
const a = await administracion("/config/auth");
console.log("Plantillas aplicadas:", [a.mailer_subjects_confirmation, a.mailer_subjects_recovery, a.mailer_subjects_magic_link].join(" · "));
console.log(`Servidor de correo: ${a.smtp_host ? `${a.smtp_host}:${a.smtp_port}, remitente ${a.smtp_sender_name || "—"} <${a.smtp_admin_email}>` : "el de Supabase (solo al equipo del proyecto)"}`);
console.log(`Correos por hora: ${a.rate_limit_email_sent}`);
console.log(`Entrar con Google: ${a.external_google_enabled ? "activado" : "desactivado"}`);
console.log(`Direcciones de vuelta: ${a.site_url} · ${a.uri_allow_list}`);
