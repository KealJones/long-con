import { defineConfig } from "vite";

// Relative base, so the build works at any Pages path (kealjones.com/long-con/ or a fork's).
// GitHub Pages runs Jekyll, which drops files starting with "_", like Vite's __vite-browser-external chunk.
const output = { chunkFileNames: (c: { name: string }) => `assets/${c.name.replace(/^_+/, "")}-[hash].js` };
export default defineConfig({
  base: "./",
  build: { rollupOptions: { output } },
  worker: { format: "es", rollupOptions: { output } },
});
