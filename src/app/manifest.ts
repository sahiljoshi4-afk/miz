import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mise',
    short_name: 'Mise',
    start_url: '/',
    display: 'standalone',
    background_color: '#EDEEEA',
    theme_color: '#EDEEEA',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
