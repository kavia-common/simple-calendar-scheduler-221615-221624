import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Allow external access and the specific allowed host without changing ports
  server: {
    host: true,
    strictPort: false,
    allowedHosts: ['vscode-internal-30091-beta.beta01.cloud.kavia.ai'],
  },
})
