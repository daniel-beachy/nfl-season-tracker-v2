import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves project sites from /<repo>/ — override with BASE_PATH in CI.
const base = process.env.BASE_PATH ?? '/nfl-season-tracker-v2/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5180,
    open: false,
  },
});
