import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Only packages that have NO JavaScript entry in their npm publish go here.
// @capacitor-community/background-geolocation v1.2.26: ships only native Android/iOS code,
// no main/module/exports in package.json, no plugin.js in files[] — completely unresolvable by Vite.
// We access its native plugin via registerPlugin('BackgroundGeolocation') from @capacitor/core instead.
// capacitor-wifi: similarly broken publish.
const BROKEN_NATIVE_ONLY_PACKAGES = [
  'capacitor-wifi',
  '@capacitor-community/background-geolocation',
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['motion', ...BROKEN_NATIVE_ONLY_PACKAGES],
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      external: BROKEN_NATIVE_ONLY_PACKAGES,
    },
  },
});
