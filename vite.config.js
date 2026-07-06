import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Bind the dev server to all network interfaces so other devices on the same
  // Wi-Fi (phone, iPad) can reach it at http://<your-mac-ip>:5173
  server: {
    host: true,
    port: 5173,
  },
})
