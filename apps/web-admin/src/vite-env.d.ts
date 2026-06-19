/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for the split deploy, e.g. https://api.platform.dz. Empty = same-origin (Vite proxy). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
