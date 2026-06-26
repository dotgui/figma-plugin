import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'src/ui',
  resolve: {
    alias: {
      // The plugin UI iframe has a DOM, so it consumes the kit like any web app.
      // render → prebuilt bundle; parser → source (Vite bundles it, DOM-free).
      '@dotgui/kit/render': fileURLToPath(new URL('../kit/dist/render.js', import.meta.url)),
      '@dotgui/kit/parser': fileURLToPath(new URL('../kit/src/parser/index.ts', import.meta.url)),
    },
  },
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/ui/ui.html',
    },
  },
})
