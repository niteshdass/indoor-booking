/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  // lightningcss rejects ::picker(select):popover-open in base.css; esbuild keeps it.
  build: { cssMinify: 'esbuild' },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] },
});
