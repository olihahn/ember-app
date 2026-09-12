import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./native', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ base: fileURLToPath(new URL('.', import.meta.url)) }),
      ],
    },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('./mobile-dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
  },
});
