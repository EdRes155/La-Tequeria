import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// Persistencia local del navegador: cada dispositivo guarda sus propios datos.
// (Para datos compartidos entre dispositivos en tiempo real se usaría un backend.)
if (!window.storage) {
  window.storage = {
    get: async (k) => { const v = localStorage.getItem(k); return v != null ? { value: v } : null; },
    set: async (k, v) => { localStorage.setItem(k, v); },
  };
}

document.documentElement.style.height = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
const el = document.getElementById("root");
el.style.height = "100%";
createRoot(el).render(<App />);
