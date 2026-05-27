import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,    // 同時 listen IPv4 + IPv6,讓 localhost / 127.0.0.1 都能連
    port: 5173,
    open: true
  }
})
