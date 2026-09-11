/**
 * 本地曲库性能基准（离线，不联网）。
 *
 * 用法：
 *   node scripts/perf-library.mjs [曲目数] [端口]
 *
 * 做什么：
 *   1. 在临时目录里生成 N 个带标签的合成音频文件，按 歌手/专辑 建子目录
 *   2. 起一个独立的 server（PORT / DATA_DIR 都指过去）
 *   3. 量：扫描入库、曲库列表、分组、智能歌单、重复检测、批量改标签
 *
 * 量的是后端与数据层的成本。渲染/交互的性能用浏览器量（见 perf-browser）。
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { mp3File, flacFile, m4aFile } from './fixtures/audio.mjs';

const N = Math.max(1, Number(process.argv[2]) || 1000);
const PORT = Number(process.argv[3]) || 8799;

const ARTISTS = ['周杰伦', '林俊杰', '陈奕迅', 'Taylor Swift', 'Adele', '五月天', '邓紫棋', 'Ed Sheeran'];
const ALBUMS = ['叶惠美', '范特西', '十一月的萧邦', '1989', '25', '自传', '新的心跳', 'Divide'];
const GENRES = ['流行', '摇滚', '民谣', '电子', '古典'];

const root = await mkdtemp(join(tmpdir(), 'blm-perf-'));
const dataDir = join(root, 'data');
const musicDir = join(root, 'music');
await mkdir(dataDir, { recursive: true });

let pass = 0;
let fail = 0;
function report(name, ms, extra = '') {
  console.log(`  ${name.padEnd(22)} ${String(Math.round(ms)).padStart(7)} ms  ${extra}`);
}
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log(`\n生成 ${N} 个文件到 ${musicDir} …`);
const tGen = Date.now();
const kinds = ['mp3', 'flac', 'm4a'];
for (let i = 0; i < N; i += 1) {
  const artist = ARTISTS[i % ARTISTS.length];
  const album = ALBUMS[i % ALBUMS.length];
  const genre = GENRES[i % GENRES.length];
  const dir = join(musicDir, artist, album);
  await mkdir(dir, { recursive: true });
  const kind = kinds[i % kinds.length];
  const meta = {
    title: `曲目 ${String(i + 1).padStart(5, '0')}`,
    artist,
    album,
    year: String(2000 + (i % 24)),
  };
  let buf;
  if (kind === 'mp3') buf = mp3File({ ...meta, genre, frames: 40, xingFrames: 40 });
  else if (kind === 'flac') buf = flacFile({ ...meta, durationSec: 200 + (i % 100) });
  else buf = m4aFile({ ...meta, durationSec: 180 + (i % 120) });
  await writeFile(join(dir, `${artist} - ${String(i + 1).padStart(5, '0')}.${kind}`), buf);
}
console.log(`  生成耗时 ${(Date.now() - tGen) / 1000}s`);

console.log('\n启动 server …');
const child = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

async function waitUp() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/library`);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const j = async (path, init) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`${path} → ${r.status} ${text.slice(0, 200)}`);
  return body;
};
const timed = async (name, fn, extra) => {
  const t = Date.now();
  const out = await fn();
  report(name, Date.now() - t, typeof extra === 'function' ? extra(out) : (extra || ''));
  return out;
};

try {
  if (!(await waitUp())) {
    console.error('server 没起来：\n' + serverLog);
    process.exit(1);
  }
  console.log('  ok\n');

  console.log('后端 / 数据层');
  const folder = musicDir.replace(/\\/g, '/');
  await timed('扫描入库', () => j('/api/library/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folder }),
  }), (o) => `scanned=${o.scan?.scanned ?? o.scanned ?? N}`);

  const lib = await timed('曲库列表 /api/library', () => j('/api/library'), (o) => `songs=${o.songs?.length}`);
  ok('入库数量正确', lib.songs.length === N, `got ${lib.songs.length}`);

  await timed('分组 /api/library/groups', () => j('/api/library/groups?type=artist'), (o) => `groups=${o.groups?.length}`);
  const groupsRes = await j('/api/library/groups?type=artist');
  const firstGroup = groupsRes.groups?.[0];
  await timed('单组曲目 /api/library/group', () => j(`/api/library/group?type=artist&key=${encodeURIComponent(firstGroup?.key || '')}`), (o) => `songs=${o.songs?.length}`);
  ok('分组曲目查得到', (o => o.songs.length > 0)(await j(`/api/library/group?type=artist&key=${encodeURIComponent(firstGroup?.key || '')}`)));
  await timed('智能歌单 /api/smart', () => j('/api/smart'));
  await timed('重复检测 /api/library/duplicates', () => j('/api/library/duplicates'));

  // 批量改标签：拿 500 首，量一次请求的落盘成本
  const ids = lib.songs.slice(0, Math.min(500, lib.songs.length)).map((s) => s.localId);
  await timed(`批量改标签（${ids.length} 首）`, () => j('/api/library/meta-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { genre: '基准测试' } }),
  }), (o) => `updated=${o.updated}`);
  const after = await j('/api/library');
  ok('批量后可读回', after.songs.slice(0, ids.length).every((s) => s.genre === '基准测试'));
  await timed('再次全量列表', () => j('/api/library'));

  // 大覆盖层下再扫一次（重复检测要在有覆盖时也不退化）
  await timed('重复检测（有覆盖层）', () => j('/api/library/duplicates'));

  console.log('\n冷启动（重启 server 后首读）');
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  const child2 = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child2.stdout.on('data', () => {});
  child2.stderr.on('data', () => {});
  const t0 = Date.now();
  if (!(await waitUp())) { console.error('重启失败'); process.exit(1); }
  report('重启到可服务', Date.now() - t0);
  await timed('冷启动首读曲库', () => j('/api/library'), (o) => `songs=${o.songs?.length}`);
  child2.kill();
} catch (e) {
  fail += 1;
  console.error('基准跑挂了:', e.message);
} finally {
  try { child.kill(); } catch { /* already dead */ }
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
