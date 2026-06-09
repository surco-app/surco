/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Build-time freemium flags (see src/config.ts). Both optional; defaults apply.
  readonly VITE_SURCO_BETA?: string
  readonly VITE_PRO_PRICE_EUR?: string
  readonly VITE_SURCO_FREE_MONTHLY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
