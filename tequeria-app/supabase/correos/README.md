# Correos de Supabase Auth

Plantillas en español de los correos que manda Supabase Auth con el servidor de correo del proyecto (Gmail,
SMTP propio). Las aplica `scripts/staging/correos.mjs` en staging; en producción se copian en el panel de
Supabase (Authentication → Emails) o con la API de administración, en la ventana de la migración
(docs/multinegocio/MIGRACION.md §5).

| Archivo | Plantilla de Supabase | Cuándo |
|---|---|---|
| `confirmacion.html` | Confirm signup | Alta en el panel de dueños; también la primera vez de una persona invitada por correo |
| `recuperacion.html` | Reset password | «Olvidé mi contraseña» |
| `enlace-de-acceso.html` | Magic link | Invitación enviada por correo a alguien que ya tiene acceso |

`{{ .ConfirmationURL }}` lleva la dirección de vuelta: el panel o la invitación (`/invitacion?clave=…`).
