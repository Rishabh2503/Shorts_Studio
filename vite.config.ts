import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-server proxies. Pollinations and Lexica both 403 / CORS-block direct
// browser requests from `Origin: http://localhost:5173`. Routing through
// Vite's proxy means the dev server makes the upstream request server-side
// — no Origin header, no CORS, no rate-limited third-party proxy chain.
//
// In the browser: `fetch('/api/poll/prompt/...')` → Vite forwards to
// `https://image.pollinations.ai/prompt/...` and streams the bytes back
// as same-origin, so the response has implicit CORS approval.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      // Forward /api/poll/* → image.pollinations.ai/*
      // (e.g. /api/poll/prompt/foo?width=… → /prompt/foo?width=…)
      '/api/poll': {
        target: 'https://image.pollinations.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/poll/, '')
      },
      // Forward /api/lexica/* → lexica.art/api/*
      '/api/lexica': {
        target: 'https://lexica.art',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/lexica/, '/api')
      }
    }
  }
});
