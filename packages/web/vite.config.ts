import { defineConfig } from 'vite';

// 로컬 개발: /api 요청(웹소켓 포함)을 `wrangler dev`(기본 8787)로 넘긴다
const target = process.env.API_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  server: { proxy: { '/api': { target, ws: true } } },
  preview: { proxy: { '/api': { target, ws: true } } },
});
