import { CONFIG } from './src/config.js';
import { createApp } from './src/createApp.js';

const app = createApp();

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log('');
  console.log('  B 站音乐播放器已启动');
  console.log(`  浏览器打开: http://${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log('  按 Ctrl+C 退出');
  console.log('');
});
