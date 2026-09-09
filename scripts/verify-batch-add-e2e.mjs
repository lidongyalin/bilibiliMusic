// 端到端自检：在临时端口上把真实 Express 应用跑起来，走一遍「多选 → 批量加歌」全链路。
// 只监听 127.0.0.1 的随机端口，跑完立刻关，不占用 8788。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'bme2e-'));
process.env.DATA_DIR = dir;

const { createApp } = await import('../src/createApp.js');
const server = http.createServer(createApp());
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0;
const fail = [];
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('  ok   ' + name); }
  else { fail.push(name + (extra ? '  → ' + extra : '')); console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}

// 模拟前端 Slim 化后的提交形状（api.js 里 addSongsToPlaylist 的产物）
const slim = (i) => ({
  bvid: 'BV1' + String(i).padStart(4, '0'),
  id: 'BV1' + String(i).padStart(4, '0'),
  type: 'video',
  aid: i,
  title: '晴天 百万豪装录音棚大声听 4K修复 完整版',
  author: '周杰伦',
  cover: 'https://i0.hdslb.com/bfs/archive/abcdef1234567890abcdef1234567890abcdef12.jpg',
  duration: '04:29',
  durationSec: 269,
  play: 123456789,
  playText: '1234.6万',
  isPay: false,
});

async function req(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML 错误页 */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

// 1. 歌单路由必须真的注册上了（之前用户撞的就是这里：老进程上没有这些路由）
{
  const r = await req('POST', '/api/playlists', { name: '测试歌单' });
  ok('POST /api/playlists 注册成功', r.status === 201 && r.json?.playlist?.id, `HTTP ${r.status}`);
  globalThis.__pl = r.json?.playlist?.id;
}
{
  const r = await req('GET', '/api/playlists');
  ok('GET /api/playlists 返回摘要列表', r.status === 200 && Array.isArray(r.json?.list) && r.json.list.length === 1, `HTTP ${r.status}`);
}

// 2. 批量加歌：1 / 50 / 500 首。每批用不相交的分段，否则上一批的 bvid 会被判重复
let cursor = 0;
let total = 0;
for (const n of [1, 50, 500]) {
  const songs = Array.from({ length: n }, (_, i) => slim(cursor + i));
  cursor += n;
  total += n;
  const r = await req('POST', `/api/playlists/${__pl}/songs`, { songs });
  const inList = r.json?.playlist?.songs.length;
  ok(`批量加 ${n} 首`, r.status === 200 && r.json?.added === n && inList === total,
    `HTTP ${r.status} added=${r.json?.added} skipped=${r.json?.skipped} 歌单内=${inList} 应为=${total}`);
}

// 3. 重复提交要跳过而不是报错
{
  const songs = [slim(0), slim(1)];
  const r = await req('POST', `/api/playlists/${__pl}/songs`, { songs });
  ok('重复曲目计入 skipped', r.status === 200 && r.json?.added === 0 && r.json?.skipped === 2, JSON.stringify({ added: r.json?.added, skipped: r.json?.skipped }));
}

// 4. 空批量是 400 而不是 500
{
  const r = await req('POST', `/api/playlists/${__pl}/songs`, { songs: [] });
  ok('空批量返回 400', r.status === 400, `HTTP ${r.status}`);
}

// 5. 大 body 不被 413 拒（express.json 的 limit）
{
  const songs = Array.from({ length: 500 }, (_, i) => slim(9000 + i));
  const r = await req('POST', `/api/playlists/${__pl}/songs`, { songs });
  const bytes = JSON.stringify({ songs }).length;
  ok(`500 首大 body（${(bytes / 1024).toFixed(0)}kB）不被 413`, r.status === 200, `HTTP ${r.status}`);
}

// 6. 不存在的歌单是 404 而不是 500
{
  const r = await req('POST', '/api/playlists/不存在/songs', { songs: [slim(0)] });
  ok('不存在的歌单返回 404', r.status === 404, `HTTP ${r.status}`);
}

server.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} 通过, ${fail.length} 失败`);
if (fail.length) process.exit(1);
