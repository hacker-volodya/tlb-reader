import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  devtools: { enabled: true },
  vite: {
    plugins: [
      nodePolyfills({
        include: [
          'util',
          'buffer',
          'process',
          'events'
        ]
      }),
    ],
  }
})
