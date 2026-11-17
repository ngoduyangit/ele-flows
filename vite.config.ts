import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { flowsApi } from './server/plugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), flowsApi()],
  server: { port: 5180, watch: { ignored: ['**/.flows/**'] } },
})
