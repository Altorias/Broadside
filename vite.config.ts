import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：React 插件 + Vitest 测试环境
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    globals: true,
    environment: 'node',
  },
});
