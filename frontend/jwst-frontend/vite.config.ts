/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // react-plotly.js internally requires 'plotly.js/dist/plotly' but we use
      // the minified dist package. Rolldown (Vite 8) is stricter about CJS
      // resolution than esbuild was, so we alias explicitly.
      'plotly.js/dist/plotly': 'plotly.js-dist-min',
    },
  },
  server: {
    port: 3000,
    strictPort: true,  // Fail fast if port 3000 is unavailable
    host: true,  // Required for Docker
    watch: {
      ignored: ['**/coverage/**', '**/node_modules/**']
    }
  },
  build: {
    outDir: 'dist'
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/vite-env.d.ts']
    }
  }
})
