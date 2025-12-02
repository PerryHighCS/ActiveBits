/* eslint-env node */
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
      'react': path.resolve(__dirname, '..', 'node_modules/react'),
      'react-dom': path.resolve(__dirname, '..', 'node_modules/react-dom'),
      'react-router-dom': path.resolve(__dirname, '..', 'node_modules/react-router-dom'),
    },
    preserveSymlinks: false,
  },
  optimizeDeps: {
    // Pre-bundle common dependencies
    include: ['react', 'react-dom', 'react-router-dom'],
    // Don't scan activity client code upfront - let Vite discover on demand
    // This speeds up initial server start
  },
  server: {
    fs: {
      // Allow importing shared activity configs from the repo root
      allow: ['..'],
    },
    hmr: {
      // Disable HMR WebSocket in Codespaces to prevent connection errors
      clientPort: (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env && globalThis.process.env.CODESPACES) ? 443 : undefined,
    },
    // No proxy needed - access via Express port 3000 which proxies to Vite
    // OR access Vite directly at 5173 (API calls will fail unless you use port 3000)
  },
})
