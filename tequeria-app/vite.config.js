import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // Solo VITE_*: evita publicar por accidente otras variables del proyecto en el navegador
  envPrefix: ["VITE_"],
  build: {
    rollupOptions: {
      // librerías en archivos aparte: cambian poco y el navegador las conserva entre versiones
      output: { manualChunks: { react: ["react", "react-dom"], supabase: ["@supabase/supabase-js"] } },
    },
  },
});
