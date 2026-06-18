/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which shop this build serves. apps/web is pinned to one shop. */
  readonly VITE_SHOP_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
