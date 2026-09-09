import { existsSync } from 'node:fs';
import express from 'express';
import { CONFIG } from './config.js';
import { createRouter } from './routes.js';

/**
 * 构建 Express 应用本身，但不监听端口。
 * server.js（CLI）和 electron/main.js（桌面）都从这里取，
 * 各自决定监听哪个端口——桌面端需要 PORT=0 让系统分配空闲端口。
 */
export function createApp() {
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

  return app;
}
