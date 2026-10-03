import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Capacitor mobile-only packages — not available in Node/browser environments.
// Vite must skip them during the Render server build.
// They are only loaded at runtime via dynamic import(), guarded by checkNative().
const CAPACITOR_MOBILE_EXTERNALS = [
  'capacitor-wifi',
  '@capacitor-community/background-geolocation',
  '@capacitor/background-runner',
  '@capacitor/geolocation',
  '@capacitor/filesystem',
  '@capacitor/local-notifications',
  '@capawesome/capacitor-background-task',
  '@capacitor-community/keep-awake',
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['motion', ...CAPACITOR_MOBILE_EXTERNALS],
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      external: CAPACITOR_MOBILE_EXTERNALS,
    },
  },
});
