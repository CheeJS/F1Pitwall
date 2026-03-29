/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OF1_CDN_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
