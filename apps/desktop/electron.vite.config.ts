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
    plugins: [react()]
  }
})
