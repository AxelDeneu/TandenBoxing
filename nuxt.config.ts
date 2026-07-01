// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: true },

  modules: ['@nuxt/ui', '@vite-pwa/nuxt', '@nuxt/eslint'],

  eslint: {
    config: {
      // Prettier gère le formatage → on désactive les règles stylistiques d'ESLint.
      stylistic: false,
    },
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },

  components: [{ path: '~/components', pathPrefix: false }],

  app: {
    head: {
      title: 'Tanden Boxing',
      htmlAttrs: { lang: 'fr' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        {
          name: 'description',
          content:
            'Coach de boxe à domicile : séances quotidiennes générées par IA, timer à intervalles et suivi de progression.',
        },
        { name: 'theme-color', content: '#0a0a0a' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Tanden' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-180.png' },
      ],
    },
  },

  runtimeConfig: {
    // Server-only (override via NUXT_ prefixed env vars)
    anthropicApiKey: '', // NUXT_ANTHROPIC_API_KEY
    aiModel: 'claude-opus-4-8', // NUXT_AI_MODEL
    timezone: 'Europe/Paris', // NUXT_TIMEZONE
    databasePath: './data/tanden.db', // NUXT_DATABASE_PATH
    disableCron: '', // NUXT_DISABLE_CRON=1 to disable the scheduler (e.g. in dev)
    public: {
      appName: 'Tanden Boxing',
    },
  },

  nitro: {
    preset: 'node-server',
    // Couches métier auto-importées côté serveur (repositories → services → api).
    imports: {
      dirs: ['server/repositories', 'server/services'],
    },
    // The SQLite file lives in ./data — keep it out of the bundle.
    // Cron scheduling is handled by a Nitro server plugin (croner).
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Tanden Boxing',
      short_name: 'Tanden',
      description: 'Coach de boxe à domicile : séances quotidiennes générées par IA.',
      lang: 'fr',
      theme_color: '#0a0a0a',
      background_color: '#0a0a0a',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/icons/maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      runtimeCaching: [
        {
          urlPattern: /\/api\/.*/i,
          handler: 'NetworkFirst',
          method: 'GET',
          options: {
            cacheName: 'tanden-api',
            networkTimeoutSeconds: 5,
            expiration: { maxEntries: 60, maxAgeSeconds: 604_800 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
    client: { installPrompt: true },
    // Pas de service worker en dev (évite les surprises de cache).
    devOptions: { enabled: false },
  },

  typescript: {
    strict: true,
  },
})
