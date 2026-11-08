import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Copy MediaPipe wasm runtime into public/ so face detection works fully offline.
function mediapipeAssets() {
  return {
    name: 'mediapipe-assets',
    buildStart() {
      const src = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
      const dst = path.resolve('public/mediapipe');
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const d = path.join(dst, f);
        if (!fs.existsSync(d) || fs.statSync(d).size !== fs.statSync(path.join(src, f)).size) fs.copyFileSync(path.join(src, f), d);
      }
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  plugins: [react(), mediapipeAssets()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 2000,
  },
});
