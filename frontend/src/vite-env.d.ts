/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // OctaPM's canonical hosts (src/lib/domains.ts). Unset: one host serves everything.
  readonly VITE_PUBLIC_SITE_URL?: string
  readonly VITE_APP_URL?: string
  readonly VITE_PORTAL_URL?: string
  readonly VITE_ADMIN_URL?: string
  readonly VITE_MARKET_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
