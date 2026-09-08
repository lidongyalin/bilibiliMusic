import { existsSync } from 'node:fs';
import express from 'express';
import { CONFIG } from './src/config.js';
import { createRouter } from './src/routes.js';

const app = express();
app.use(express.json());
app.use('/api', createRouter());

if (existsSync(CONFIG.PUBLIC_DIR)) {
  app.use(express.static(CONFIG.PUBLIC_DIR));
  // 前端是单页应用，未知路径回退到 index.html
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(CONFIG.PUBLIC_DIR + '/index.html'));
} else {
  // 前端还没构建时给出明确提示，而不是静默 404
  app.use((req, res) => {
    res.status(503).send('前端尚未构建。请先执行：npm run build （或直接 npm run dev 用开发模式）');
  });
}

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log('');
  console.log('  B 站音乐播放器已启动');
  console.log(`  浏览器打开: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log('  按 Ctrl+C 退出');
  console.log('');
});
