import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  root: 'src/ui',
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
