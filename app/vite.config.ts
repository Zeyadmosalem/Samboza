import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Capacitor (phase 5) serves the built files from disk, so every asset
  // reference has to be relative rather than rooted at /.
  base: './',
  build: { outDir: 'dist', sourcemap: true },
})
