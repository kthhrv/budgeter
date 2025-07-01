import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
	  react(),
	  tailwindcss(),
  ],
  server: {
    allowedHosts: [
      'localhost',
      'budget.lan',
      'budgeter.ddns.net',
      '192.168.0.165',
    ],
  },
})
