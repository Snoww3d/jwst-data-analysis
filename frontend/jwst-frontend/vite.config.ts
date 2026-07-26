/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Lives under src/ so it is covered by eslint, prettier and coverage globs.
// Node-only: nothing in the app's module graph imports it, so it is never
// bundled into the client.
import { jobsRouteCollisionError } from './src/config/viteGuards';

export default defineConfig(({ command, isPreview, mode }) => {
  // Empty prefix: read the same .env files the bundle will see, plus
  // process.env — checking process.env alone would miss a .env-provided value
  // and misjudge one supplied only by the shell. Also covers the unprefixed
  // ENGINE_PROXY_TARGET, which is consumed here in Node rather than in the app.
  // process.cwd() is what Vite itself uses because neither `root` nor `envDir`
  // is configured here — keep them in step if either is ever introduced.
  const env = loadEnv(mode, process.cwd(), '');

  // Where the dev server forwards engine-owned paths. Inside Docker the engine
  // is only reachable on the compose network (`processing-engine:8000`); when
  // Vite runs on the host it is the published port. Override per environment.
  const engineProxyTarget = env.ENGINE_PROXY_TARGET || 'http://localhost:8000';

  // Dev server only. `vite preview` also reports command === 'serve' but
  // serves a built bundle through preview.proxy, and vitest loads this config
  // without ever serving the app — neither can hit the collision, and failing
  // them would block legitimate workflows.
  if (command === 'serve' && !isPreview && !process.env.VITEST) {
    const collision = jobsRouteCollisionError(env);
    if (collision) throw new Error(collision);
  }

  return {
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
      strictPort: true, // Fail fast if port 3000 is unavailable
      host: true, // Required for Docker
      // Engine-owned routes (ADR-0001: the frontend calls the Python engine
      // directly, not through the .NET gateway). Proxying them keeps the
      // browser on the origin it loaded from, so the same bundle works at
      // localhost:3000 and at http://<lan-ip>:3000 for phone testing — no LAN
      // IP baked into the bundle and no cross-origin request to CORS-approve.
      // The rules are always registered but only exercised when the bundle emits
      // relative URLs, i.e. when VITE_ENGINE_URL is empty (src/config/engine.ts).
      proxy: {
        '/api/calibration': { target: engineProxyTarget, changeOrigin: true },
        '/api/jobs': { target: engineProxyTarget, changeOrigin: true },
      },
      watch: {
        ignored: ['**/coverage/**', '**/node_modules/**'],
      },
    },
    build: {
      outDir: 'dist',
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
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}', 'src/vite-env.d.ts'],
      },
    },
  };
});
