/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_EATERY_SLUG?: string
  readonly VITE_EATERY_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}