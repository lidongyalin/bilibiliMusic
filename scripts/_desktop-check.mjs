/**
 * 临时验收脚本（跑完删掉）：验证 preload 桥 + 迷你窗 + 桌面歌词窗 + 主窗 + 全局快捷键。
 *
 * 不建托盘、不显示窗口（show: false，避免往用户桌面上放东西），
 * 只验证 IPC 通路与三种窗口的渲染。后端监听在 0 端口，绝不碰 8788。
 */
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bm-desktop-check-data-'));
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { createApp } = await import(new URL('../src/createApp.js', import.meta.url));
const { library } = await import(new URL('../src/store/library.js', import.meta.url));
const { mp3File } = await import(new URL('../scripts/fixtures/audio.mjs', import.meta.url));

const audioDir = mkdtempSync(join(tmpdir(), 'bm-desktop-check-music-'));
writeFileSync(join(audioDir, '测试 - 桥接.mp3'), mp3File({ title: '桥接', artist: '测试' }));
writeFileSync(join(audioDir, '测试 - 桥接.lrc'), '[00:05.00]第一句歌词\n[00:10.00]第二句歌词\n');

const results = [];
const ok = (label, cond, extra = '') => {
  results.push({ label, pass: Boolean(cond) });
  console.log(`${cond ? '  ✓ ' : '  ✗ '}${label}${extra ? `  ${extra}` : ''}`);
};

const FAKE_STATE = {
  playing: false,
  bvid: 'local-test',
  title: '桥接',
  artist: '测试',
  cover: '',
  duration: 120,
  progress: 6,
  muted: false,
  volume: 0.8,
  lyrics: [
    { time: 5, text: '第一句歌词' },
    { time: 10, text: '第二句歌词' },
  ],
  lyricOffset: 0.5,
  lyricStatus: 'ok',
};

app.whenReady().then(async () => {
  const scan = await library.scanFolder(audioDir);
  ok('曲库扫描到测试音频', scan.total === 1, `total=${scan.total}`);
  const song = (await library.songs())[0];
  ok('曲目模型用 author 字段', song.author === '测试', JSON.stringify(song.author));

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`\n后端 :${server.address().port}（未使用 8788）`);

  let pushCount = 0;
  let requested = 0;
  const commands = [];
  const invokeCalls = [];

  // 复刻 main.js 的转发逻辑：主窗推的状态要再发给两个辅助窗
  const auxWindows = [];
  const forward = (snap) => {
    for (const w of auxWindows) {
      if (!w.isDestroyed()) w.webContents.send('desktop:media-state', snap);
    }
  };

  ipcMain.on('desktop:push-state', (_e, snap) => { pushCount += 1; forward(snap); });
  ipcMain.on('desktop:command', (_e, msg) => { commands.push(msg); });
  ipcMain.on('desktop:lyrics-config', () => {});
  ipcMain.handle('desktop:invoke', async (_e, action, arg) => {
    invokeCalls.push([action, arg]);
    return null;
  });
  ipcMain.handle('desktop:request-state', () => {
    requested += 1;
    return { ...FAKE_STATE, bvid: song.bvid };
  });

  const make = (transparent = false, w = 460, h = 280) => new BrowserWindow({
    width: w,
    height: h,
    show: false,
    frame: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#121212',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(REPO, 'electron/preload.cjs'),
      // 跟 main.js 的 auxWindow 一致：辅助窗要一直滚歌词，别让系统把后台窗口降频
      backgroundThrottling: false,
    },
  });

  // 尺寸和透明度跟 main.js 的真实窗口一致（迷你窗不透明，桌面歌词窗透明）
  const mini = make(false, 460, 280);
  const lyrics = make(true, 640, 260);
  auxWindows.push(mini, lyrics);

  for (const [name, w] of [['mini', mini], ['lyrics', lyrics]]) {
    w.webContents.on('console-message', (_e, _level, message, _line, src) => {
      if (/Security Warning/.test(message)) return;
      console.log(`  [renderer:${name}] ${message}  <${src}>`);
    });
    w.webContents.on('render-process-gone', (_e, details) => {
      console.log(`  [renderer:${name}] 进程退出: ${JSON.stringify(details)}`);
    });
  }

  await Promise.all([
    mini.loadURL(`${base}/index.html?mode=mini`),
    lyrics.loadURL(`${base}/index.html?mode=desktop-lyrics`),
  ]);
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n[迷你窗]');
  const miniRes = await mini.webContents.executeJavaScript(`
    (() => {
      const q = (s) => document.querySelector(s);
      return {
        tag: document.querySelector('.mini') ? 'mini' : 'MISSING',
        htmlClass: document.documentElement.className,
        name: q('.mini-name') ? q('.mini-name').textContent.trim() : '',
        artist: q('.mini-artist') ? q('.mini-artist').textContent.trim() : '',
        playLabel: q('.mini-play') ? q('.mini-play').getAttribute('aria-label') : '',
        buttons: document.querySelectorAll('.mini-controls .mini-btn').length,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        dragRegion: q('.mini-drag') ? getComputedStyle(q('.mini-drag')).webkitAppRegion : '',
        noDrag: q('.mini-btn') ? getComputedStyle(q('.mini-btn')).webkitAppRegion : '',
        api: {
          requestState: typeof window.desktop.requestState,
          pushState: typeof window.desktop.pushState,
          pickDirectory: typeof window.desktop.pickDirectory,
          showItem: typeof window.desktop.showItemInFolder,
          openExternal: typeof window.desktop.openExternal,
          sendCommand: typeof window.desktop.sendCommand,
          onCommand: typeof window.desktop.onCommand,
          onMediaState: typeof window.desktop.onMediaState,
        },
      };
    })()
  `);
  ok('根节点渲染为 .mini', miniRes.tag === 'mini', miniRes.tag);
  ok('html 打上 mini-mode 类', /mini-mode/.test(miniRes.htmlClass), miniRes.htmlClass);
  ok('显示歌曲标题', miniRes.name === '桥接', JSON.stringify(miniRes.name));
  ok('显示艺术家', miniRes.artist === '测试', JSON.stringify(miniRes.artist));
  ok('播放按钮语义正确', miniRes.playLabel === '播放', miniRes.playLabel);
  ok('三个控制按钮', miniRes.buttons === 3, `count=${miniRes.buttons}`);
  ok('无横向溢出', !miniRes.overflowX);
  ok('无纵向溢出', !miniRes.overflowY);
  ok('拖拽区是 drag', miniRes.dragRegion === 'drag', miniRes.dragRegion);
  ok('按钮区是 no-drag', miniRes.noDrag === 'no-drag', miniRes.noDrag);
  for (const [k, v] of Object.entries(miniRes.api)) {
    ok(`preload 暴露 ${k}`, v === 'function', v);
  }

  console.log('\n[桌面歌词窗]');
  const dlRes = await lyrics.webContents.executeJavaScript(`
    (() => {
      const q = (s) => document.querySelector(s);
      const now = q('.dl-line-now');
      return {
        tag: document.querySelector('.dl') ? 'dl' : 'MISSING',
        htmlClass: document.documentElement.className,
        now: now ? now.textContent.trim() : '',
        next: q('.dl-line-next') ? q('.dl-line-next').textContent.trim() : '',
        fontSize: now ? getComputedStyle(now).fontSize : '',
        color: now ? getComputedStyle(now).color : '',
        offset: q('.dl-offset') ? q('.dl-offset').textContent.trim() : '',
        sliders: document.querySelectorAll('.dl-field input[type="range"]').length,
        swatches: document.querySelectorAll('.dl-swatch').length,
        lockLabel: q('.dl-lock') ? q('.dl-lock').getAttribute('aria-label') : '',
        barOpacity: getComputedStyle(q('.dl-bar')).opacity,
      };
    })()
  `);
  ok('根节点渲染为 .dl', dlRes.tag === 'dl', dlRes.tag);
  ok('html 打上 desktop-lyrics-mode 类', /desktop-lyrics-mode/.test(dlRes.htmlClass), dlRes.htmlClass);
  ok('当前行取到偏移后的时间（6s - 0.5s → 第一句）', dlRes.now === '第一句歌词', JSON.stringify(dlRes.now));
  ok('下一行是第二句', dlRes.next === '第二句歌词', JSON.stringify(dlRes.next));
  ok('字号来自 prefs 默认值', dlRes.fontSize === '22px', dlRes.fontSize);
  ok('颜色来自 prefs 默认值', dlRes.color === 'rgb(255, 255, 255)', dlRes.color);
  ok('偏移显示为 +0.5s', dlRes.offset === '+0.5s', dlRes.offset);
  ok('三个滑杆（字号/透明/描边）', dlRes.sliders === 3, `count=${dlRes.sliders}`);
  ok('六个颜色选项', dlRes.swatches === 6, `count=${dlRes.swatches}`);
  ok('锁图标初始为未锁定', dlRes.lockLabel === '未锁定', dlRes.lockLabel);
  ok('控制条默认收起', Number(dlRes.barOpacity) < 0.05, dlRes.barOpacity);

  console.log('\n[命令回流：辅助窗按钮 → 主窗]');
  await mini.webContents.executeJavaScript(
    "document.querySelector('.mini-controls .mini-btn').click()"
  );
  await mini.webContents.executeJavaScript("document.querySelector('.mini-play').click()");
  await new Promise((r) => setTimeout(r, 250));
  ok('迷你窗上一首按钮发出 prev', commands.some((c) => c.cmd === 'prev'),
    JSON.stringify(commands.map((c) => c.cmd)));
  ok('迷你窗播放按钮发出 toggle', commands.some((c) => c.cmd === 'toggle'),
    JSON.stringify(commands.map((c) => c.cmd)));

  console.log('\n[状态回流：主窗 → 辅助窗]');
  pushCount = 0;
  await mini.webContents.executeJavaScript(
    "window.desktop.pushState({ playing: true, title: '桥接', artist: '测试', progress: 30 })"
  );
  await new Promise((r) => setTimeout(r, 300));
  ok('主窗收到 push-state', pushCount >= 1, `count=${pushCount}`);
  const afterPush = await mini.webContents.executeJavaScript(`
    (() => ({
      playLabel: document.querySelector('.mini-play').getAttribute('aria-label'),
      percent: document.querySelector('.mini-progress-fill').style.width,
    }))()
  `);
  ok('迷你窗跟随变成暂停按钮', afterPush.playLabel === '暂停', afterPush.playLabel);
  ok('迷你窗进度条更新', afterPush.percent === '25%', afterPush.percent);

  console.log('\n[IPC 请求/响应]');
  ok('requestState 返回过状态', requested >= 1, `requested=${requested}`);
  await mini.webContents.executeJavaScript('window.desktop.pickDirectory()');
  await mini.webContents.executeJavaScript('window.desktop.showItemInFolder("D:/tmp/x.mp3")');
  await mini.webContents.executeJavaScript('window.desktop.openExternal("ftp://bad")');
  await mini.webContents.executeJavaScript('window.desktop.openExternal("https://example.com")');
  await new Promise((r) => setTimeout(r, 300));
  ok('pickDirectory 走通 invoke', invokeCalls.some(([a]) => a === 'pick-directory'),
    JSON.stringify(invokeCalls));
  ok('showItemInFolder 带路径走通',
    invokeCalls.some(([a, g]) => a === 'show-item' && g === 'D:/tmp/x.mp3'),
    JSON.stringify(invokeCalls));
  ok('openExternal 放行 https、拒绝 ftp', invokeCalls.filter(([a]) => a === 'open-external').length === 1,
    JSON.stringify(invokeCalls));

  console.log('\n[滚轮校准时序 + 锁定]');
  await lyrics.webContents.executeJavaScript(`
    document.querySelector('.dl').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  `);
  await new Promise((r) => setTimeout(r, 200));
  const afterWheel = await lyrics.webContents.executeJavaScript(
    "document.querySelector('.dl-offset').textContent.trim()"
  );
  ok('滚轮向上偏移 +0.25s', afterWheel === '+0.8s', afterWheel);
  ok('滚轮偏移回推给主窗',
    commands.some((c) => c.cmd === 'lyric-offset' && c.payload.offset === 0.8),
    JSON.stringify(commands.filter((c) => c.cmd === 'lyric-offset').map((c) => c.payload)));

  await lyrics.webContents.executeJavaScript("document.querySelector('.dl-lock').click()");
  // 控制条有 0.18s 的 opacity 过渡，先看看它什么时候到位
  for (const t of [100, 300, 600, 1000]) {
    await new Promise((r) => setTimeout(r, t));
    const probe = await lyrics.webContents.executeJavaScript(`
      (() => {
        const bar = document.querySelector('.dl-bar');
        return {
          opacity: getComputedStyle(bar).opacity,
          cls: document.querySelector('.dl').className,
          anims: bar.getAnimations ? bar.getAnimations().length : -1,
        };
      })()
    `);
    console.log(`    opacity=${probe.opacity} cls="${probe.cls}" anims=${probe.anims}`);
  }
  const locked = await lyrics.webContents.executeJavaScript(`
    (() => ({
      label: document.querySelector('.dl-lock').getAttribute('aria-label'),
      controlsVisible: document.querySelector('.dl-controls').getBoundingClientRect().width > 0,
      barOpacity: getComputedStyle(document.querySelector('.dl-bar')).opacity,
      stored: JSON.parse(localStorage.getItem('bilibili-music-player:desktopLyricsStyle') || '{}'),
    }))()
  `);
  ok('点击后变成已锁定', locked.label === '已锁定', locked.label);
  ok('锁定时隐藏控制条', !locked.controlsVisible);
  ok('锁定时控制条保持可见（有解锁入口）', Number(locked.barOpacity) === 1, locked.barOpacity);
  ok('样式写入共享 localStorage', locked.stored && locked.stored.lock === true, JSON.stringify(locked.stored));

  await lyrics.webContents.executeJavaScript(`
    document.querySelector('.dl').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
  `);
  const afterLockedWheel = await lyrics.webContents.executeJavaScript(
    "document.querySelector('.dl-offset').textContent.trim()"
  );
  ok('锁定时滚轮不生效', afterLockedWheel === '+0.8s', afterLockedWheel);

  console.log('\n[全局快捷键]');
  globalShortcut.register('CommandOrControl+Alt+Space', () => {});
  ok('快捷键注册成功', globalShortcut.isRegistered('CommandOrControl+Alt+Space'));
  globalShortcut.unregisterAll();
  ok('注销后不再注册', !globalShortcut.isRegistered('CommandOrControl+Alt+Space'));

  console.log('\n[主窗：App.vue + 桌面桥 + 设置面板]');
  const main = make(false, 1280, 840);
  main.setMenu(null);
  await main.loadURL(base);
  await new Promise((r) => setTimeout(r, 1500));
  const mainRes = await main.webContents.executeJavaScript(`
    (() => {
      const q = (s) => document.querySelector(s);
      return {
        shell: q('.app-shell') ? 'ok' : 'MISSING',
        sidebar: q('.sidebar') ? 'ok' : 'MISSING',
        bar: q('.player-bar') ? 'ok' : 'MISSING',
        desktop: typeof window.desktop,
        htmlClass: document.documentElement.className,
      };
    })()
  `);
  ok('主窗渲染出 .app-shell', mainRes.shell === 'ok', mainRes.shell);
  ok('主窗渲染出侧栏', mainRes.sidebar === 'ok', mainRes.sidebar);
  ok('主窗渲染出播放条', mainRes.bar === 'ok', mainRes.bar);
  ok('主窗也拿到 preload 桥', mainRes.desktop === 'object', mainRes.desktop);
  ok('主窗没被打上辅助窗类名', mainRes.htmlClass === 'dark', mainRes.htmlClass);

  // Ctrl+, 打开设置。keyboard.js 判断的是 e.code === 'Comma'，不是 e.key
  await main.webContents.executeJavaScript(
    "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', key: ',', ctrlKey: true, bubbles: true, cancelable: true }))"
  );
  await new Promise((r) => setTimeout(r, 900));
  const dlg = await main.webContents.executeJavaScript(`
    (() => {
      const rows = Array.from(document.querySelectorAll('.settings-dialog .st-row .st-label'))
        .map((e) => e.textContent.trim());
      const kbd = Array.from(document.querySelectorAll('.settings-dialog kbd')).map((e) => e.textContent.trim());
      return {
        open: Boolean(document.querySelector('.settings-dialog .st-group')),
        labels: rows,
        hasMonitor: rows.includes('监控音乐文件夹'),
        hasShortcuts: rows.includes('全局快捷键'),
        hasGlobalHotkeys: kbd.some((k) => k.includes('Ctrl + Alt')),
        kbdCount: kbd.length,
      };
    })()
  `);
  ok('设置面板能打开', dlg.open, `labels=${JSON.stringify(dlg.labels)}`);
  ok('有「监控音乐文件夹」开关（F27）', dlg.hasMonitor, JSON.stringify(dlg.labels));
  ok('有「全局快捷键」开关（F8）', dlg.hasShortcuts);
  ok('快捷键表列出全局组合键', dlg.hasGlobalHotkeys, JSON.stringify(dlg.kbdCount));

  mini.destroy();
  lyrics.destroy();
  main.destroy();
  server.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
  if (failed.length) for (const f of failed) console.log('  失败:', f.label);

  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  rmSync(audioDir, { recursive: true, force: true });
  app.quit(failed.length > 0 ? 1 : 0);
});

app.on('window-all-closed', () => app.quit());
