/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_PROVIDER?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_OSRM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
