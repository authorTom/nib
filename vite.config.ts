import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The server library lives behind /api. Vite doesn't serve it, so proxy to a
    // locally running `node server/index.mjs` (DECKLE_SERVER_LIBRARY=true) to work on
    // that backend with hot reload. Without one running, the proxy just fails and
    // the app falls back to offering only the local folder / in-browser libraries.
    proxy: {
      '/api': {
        target: process.env.DECKLE_API_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
