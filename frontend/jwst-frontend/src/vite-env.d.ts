/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_CE_MODE?: string;
  /** Aladin Lite v3 bundle URL (runtime script-tag loader); default CDS CDN. */
  readonly VITE_ALADIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
