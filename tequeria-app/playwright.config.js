import { defineConfig, devices } from "@playwright/test";

// Recorridos de navegador. Ninguno toca una base de datos real:
//  · «chromium»: la app en MODO LOCAL (sin Supabase).
//  · «remoto-simulado»: la app compilada con Supabase configurado hacia una dirección que no existe; cada
//    prueba intercepta las llamadas (tests/e2e/remoto/servidor-simulado.js) y responde como el servidor.
//    Sirve para probar cómo reacciona la app a respuestas del servidor (revocación, sesión vencida…).
export const SUPABASE_SIMULADO = "http://127.0.0.1:5199";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", testIgnore: /remoto\//, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5174" } },
    { name: "remoto-simulado", testMatch: /remoto\/.*\.spec\.js/, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5175" } },
  ],
  webServer: [
    {
      command: "npx vite --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 60000,
      env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
    },
    {
      // compilada aparte (no comparte la caché del servidor de desarrollo) y servida tal cual se publica
      command: "npx vite build --outDir dist-remoto-simulado --emptyOutDir && npx vite preview --outDir dist-remoto-simulado --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      timeout: 120000,
      env: { VITE_SUPABASE_URL: SUPABASE_SIMULADO, VITE_SUPABASE_ANON_KEY: "llave-publica-de-prueba" },
    },
  ],
});
