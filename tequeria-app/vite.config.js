import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // Expone al navegador las variables con estos prefijos
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
});
