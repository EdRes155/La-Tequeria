// CAPTCHA del inicio anónimo de los equipos (Cloudflare Turnstile; MODELO.md §4). Supabase Auth exige un
// token por cada inicio de sesión anónimo y lo comprueba con Cloudflare. Sin VITE_TURNSTILE_SITE_KEY no hay
// CAPTCHA (modo local y pruebas que no lo usan).
import { useEffect, useRef, useState } from "react";

export const LLAVE_CAPTCHA = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let carga = null;
function cargarTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  carga ??= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true;
    s.onload = () => (window.turnstile ? ok(window.turnstile) : mal(new Error("sin turnstile")));
    s.onerror = () => { carga = null; s.remove(); mal(new Error("no cargó")); };
    document.head.appendChild(s);
  });
  return carga;
}

// Pinta el widget en el contenedor y devuelve obtener(): una promesa con un token sin usar. Cada token sirve
// una sola vez; si ya se usó, el widget se reinicia y se espera el siguiente (por ejemplo, para la identidad
// nueva de un equipo revocado). estado: "cargando" | "listo" | "esperando" | "error".
export function useCaptcha(contenedor) {
  const [estado, setEstado] = useState(LLAVE_CAPTCHA ? "cargando" : "listo");
  const w = useRef({ id: null, token: null, esperas: [] });
  useEffect(() => {
    if (!LLAVE_CAPTCHA) return;
    let vivo = true;
    const entregar = (token) => {
      w.current.token = token;
      const esperas = w.current.esperas; w.current.esperas = [];
      esperas.forEach((e) => e.ok(token));
      if (esperas.length) w.current.token = null;   // la primera espera lo usó
      setEstado("listo");
    };
    cargarTurnstile().then((t) => {
      if (!vivo || !contenedor.current) return;
      w.current.id = t.render(contenedor.current, {
        sitekey: LLAVE_CAPTCHA, language: "es", appearance: "interaction-only",
        callback: entregar,
        "expired-callback": () => { w.current.token = null; },
        "error-callback": () => { setEstado("error"); },
      });
    }).catch(() => vivo && setEstado("error"));
    return () => {
      vivo = false;
      try { if (w.current.id != null) window.turnstile?.remove(w.current.id); } catch {}
      w.current.esperas.forEach((e) => e.mal(new Error("captcha")));
      w.current = { id: null, token: null, esperas: [] };
    };
  }, [contenedor]);

  const obtener = () => {
    if (!LLAVE_CAPTCHA) return Promise.resolve(undefined);
    if (w.current.token) { const t = w.current.token; w.current.token = null; return Promise.resolve(t); }
    return new Promise((ok, mal) => {
      w.current.esperas.push({ ok, mal });
      setEstado("esperando");
      // sin token pendiente: el widget ya entregó uno que se usó; se pide otro
      try { if (w.current.id != null) window.turnstile?.reset(w.current.id); } catch {}
      setTimeout(() => {
        const i = w.current.esperas.findIndex((e) => e.ok === ok);
        if (i >= 0) { w.current.esperas.splice(i, 1); mal(new Error("captcha")); }
      }, 60000);
    });
  };
  return { estado, obtener, activo: !!LLAVE_CAPTCHA };
}
