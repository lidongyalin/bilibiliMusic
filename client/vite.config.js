import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 开发时前端走 5173，/api 转发到 Node 后端
    proxy: {
      '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    // Element Plus 整包样式较大，本地应用无需强拆
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Vite 8 的 Rolldown 要求 manualChunks 是函数
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('element-plus')) return 'element'
          if (id.includes('vue')) return 'vendor'
        },
      },
    },
  },
})
