import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const workspace = ['@highwing/hermes', '@highwing/thread']

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: workspace } }
  },
  preload: {
    // A sandboxed preload cannot be an ES module.
    build: { externalizeDeps: { exclude: workspace }, rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: {
    plugins: [react()],
    // The page's CSP allows fonts from 'self' only, so a font small enough to inline as a data: URI would be blocked.
    build: { assetsInlineLimit: file => (/\.(woff2?|ttf)$/.test(file) ? false : undefined) }
  }
})
