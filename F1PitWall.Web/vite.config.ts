import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // WebSocket proxy for SignalR — must come before the /hubs HTTP proxy
      '/hubs': {
        target: 'http://localhost:5018',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:5018',
        changeOrigin: true,
      },
    },
  },
})
