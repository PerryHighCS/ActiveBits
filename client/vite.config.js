import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(),],
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, 'src'),
      // Explicitly resolve React deps for files outside client/ (colocated activities)
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
    },
    preserveSymlinks: false,
  },
  server: {
    fs: {
      // Allow importing shared activity configs from the repo root
      allow: ['..'],
    },
    hmr: {
      // Disable HMR WebSocket in Codespaces to prevent connection errors
      clientPort: process.env.CODESPACES ? 443 : undefined,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
