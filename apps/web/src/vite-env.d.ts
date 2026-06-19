/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Local single-shop dev fallback when no ?shop= or hostname subdomain is present. */
  readonly VITE_SHOP_SLUG?: string;
  /** API origin for the split deploy, e.g. https://api.platform.dz. Empty = same-origin (Vite proxy). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
