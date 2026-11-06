import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/figtree";
import "@fontsource-variable/bricolage-grotesque";

// /duenos y /invitacion: panel de dueños (sesión de una persona, cliente de Supabase aparte; se carga aparte).
// Lo demás: la app de comandas del equipo.
const ruta = window.location.pathname.replace(/\/+$/, "");
const Raiz = lazy(() => (ruta === "/duenos" || ruta === "/invitacion" ? import("./PanelDuenos.jsx") : import("./App.jsx")));

document.documentElement.style.height = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
const el = document.getElementById("root");
el.style.height = "100%";
createRoot(el).render(<Suspense fallback={null}><Raiz /></Suspense>);
