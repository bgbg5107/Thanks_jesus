import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '감사 기록',
        short_name: '감사 기록',
        description: '소란한 일상 속 가장 고요한 쉼표, 감사 기록',
        theme_color: '#2E4A66',
        background_color: '#FAF5EC',
        display: 'standalone',
        lang: 'ko',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes('supabase.co') && url.pathname.includes('/storage/'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 200 } }
          }
        ]
      }
    })
  ]
});
