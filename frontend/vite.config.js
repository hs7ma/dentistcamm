import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,  // السماح بالوصول من الشبكة المحلية (جوال، أجهزة أخرى)
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
