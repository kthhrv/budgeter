import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg'],
      workbox: {
        // Prevent the Service Worker from intercepting these paths so they reach the backend
        navigateFallbackDenylist: [/^\/accounts/, /^\/api/, /^\/admin/, /^\/static/],
      },
      manifest: {
        name: 'Budgeter',
        short_name: 'Budgeter',
        description: 'A simple budgeting app.',
        theme_color: '#4f46e5',
        background_color: '#4f46e5',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
        secure: false,
      },
      '/accounts': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        secure: false,
      },
      '/admin': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        secure: false,
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        secure: false,
      },
    },
    allowedHosts: [
      'localhost',
      'budget.lan',
      'budgeter.ddns.net',
      'budgeter-demo.ddns.net',
      '192.168.0.165',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
})