import { defineConfig } from "vite";

// Relative base, so the build works at any Pages path (kealjones.com/long-con/ or a fork's).
export default defineConfig({
  base: "./",
  // GitHub Pages runs Jekyll, which drops files starting with "_", like Vite's __vite-browser-external chunk.
  build: { rollupOptions: { output: { chunkFileNames: (c) => `assets/${c.name.replace(/^_+/, "")}-[hash].js` } } },
});
