/* eslint-env node */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import process from 'node:process';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isCodespaces = Boolean(process.env.CODESPACES) || Boolean(process.env.CODESPACE_NAME) || Boolean(process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss({
      base: path.resolve(__dirname, 'src/index.css'),
    }),
  ],
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, 'src'),
      '@activities': path.resolve(__dirname, '..', 'activities'),
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
    // Disable HMR in Codespaces to avoid WebSocket proxy issues
    // The app works fine without live reload; just refresh the page after edits
    hmr: !isCodespaces,
    host: true,
    port: 5173,
    strictPort: true,
    // Proxy backend API and app WebSockets to the Express server when
    // accessing Vite directly at :5173. This avoids the double-proxy path
    // and typically makes reloads faster.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: false,
      },
      '/ws': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Name per-activity chunks for clearer artifacts
        manualChunks: (id) => {
          const match = id.match(/\/activities\/([^/]+)\/client\//);
          if (match) return `activity-${match[1]}`;
          return undefined;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name;
          const ext = name?.includes('.') ? name.split('.').pop() : null;
          return ext ? `assets/[name]-[hash].${ext}` : 'assets/[name]-[hash]';
        },
      },
    },
  },
})
