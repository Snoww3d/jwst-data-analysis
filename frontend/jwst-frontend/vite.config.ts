/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // react-plotly.js internally requires 'plotly.js/dist/plotly' but we use
      // the basic (scatter/bar/pie only) minified dist — ~75% smaller than the
      // full bundle. Rolldown (Vite 8) needs the explicit alias for CJS resolution.
      'plotly.js/dist/plotly': 'plotly.js-basic-dist-min',
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
