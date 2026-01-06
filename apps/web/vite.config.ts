import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo_icon.svg', 'icons/*.png'],
      manifest: false, // We use our own manifest.json in public/
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            // Cache API requests with network-first strategy
            urlPattern: /^https?:\/\/.*\/(api|login|logout|me|bills|payments|databases|users)\/?.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60, // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            // Cache fonts
            urlPattern: /\.(?:woff|woff2|ttf|eot)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // Disable PWA in development
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/login': 'http://localhost:5001',
      '/logout': 'http://localhost:5001',
      '/me': 'http://localhost:5001',
      '/change-password': 'http://localhost:5001',
      '/bills': 'http://localhost:5001',
      '/payments': 'http://localhost:5001',
      '/select-db': 'http://localhost:5001',
      '/databases': 'http://localhost:5001',
      '/users': 'http://localhost:5001',
      '/api': 'http://localhost:5001',
      '/debug-db': 'http://localhost:5001',
      '/telemetry': 'http://localhost:5001',
    },
  },
  build: {
    outDir: 'dist',
  },
})
