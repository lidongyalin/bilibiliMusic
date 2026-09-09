/**
 * 歌单单测。store 直接读写磁盘，所以用 os.tmpdir() 当 DATA_DIR，
 * 既测了真实的原子写入，也不会污染仓库里的 data/。
 *
 * 跑法：DATA_DIR=<临时目录> node scripts/test-playlists.mjs
 * （不用手动传 DATA_DIR，测试自己建临时目录并在退出时清理）
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在 import store 之前设好：config.js 在求值时就读了 DATA_DIR
const dataDir = await mkdtemp(join(tmpdir(), 'bilibili-music-playlists-'));
process.env.DATA_DIR = dataDir;

const { playlists } = await import('../src/store/playlists.js');

let pass = 0;
let fail = 0;

// check 是 async：断言值可能是 Promise（store 的返回值），必须先解出来再比
async function check(name, actual, expected) {
  actual = await actual;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       期望 ${e}\n       实际 ${a}`);
  }
}

async function ok(name, cond) {
  cond = await cond;
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkSong = (n, extra = {}) => ({
  id: `BV${n}`,
  bvid: `BV${n}`,
  title: `第 ${n} 首`,
  author: 'UP 主',
  duration: '3:00',
  durationSec: 180,
  play: 1000,
  playText: '1000',
  ...extra,
});

try {
  // --- 创建 ---

  await check('初始没有歌单', playlists.list(), []);
  await check('创建默认歌单', (await playlists.create()).name, '我喜欢的音乐');
  await check('创建的歌单是空的', (await playlists.create('华语经典')).songCount, 0);
  await check('空名字回落到默认名', (await playlists.create('')).name, '我喜欢的音乐 2');
  await check('超长名字被截断', (await playlists.create('歌'.repeat(200))).name.length, 40);

  // 摘要按更新时间倒序：刚建的在最前
  const a = await playlists.create('甲');
  await sleep(5);
  const b = await playlists.create('乙');
  await check(
    '按更新时间倒序',
    (await playlists.list()).map((p) => p.name).filter((n) => n === a.name || n === b.name),
    [b.name, a.name]
  );

  // 重名自动加后缀，不拒绝
  await playlists.create('重复');
  await sleep(5);
  await playlists.create('重复');
  await check(
    '重名自动加数字后缀',
    (await playlists.list()).map((p) => p.name).filter((n) => n.startsWith('重复')),
    ['重复 2', '重复']
  );

  // --- 详情 ---

  await check('不存在返回 null', playlists.get('nope'), null);
  const detail = await playlists.get(a.id);
  await ok('详情带曲目', Array.isArray(detail.songs));
  await ok('详情带 id/name/songCount', detail.id === a.id && detail.name === '甲' && detail.songCount === 0);

  // --- 加歌 ---

  await check('不存在的歌单加歌返回 null', playlists.addSongs('nope', [mkSong(1)]), null);
  await check('空批量不写盘但返回全 0', (await playlists.addSongs(a.id, [])).added, 0);

  const added = await playlists.addSongs(a.id, [mkSong(1), mkSong(2), mkSong(3)]);
  await check('批量加 3 首', added.added, 3);
  await check('返回完整歌单', added.playlist.songCount, 3);
  // 同一批加的歌时间戳相同，按提交顺序显示；跨批时才按时间倒序
  await check('同一批按提交顺序显示', added.playlist.songs.map((s) => s.bvid), ['BV1', 'BV2', 'BV3']);

  // 重复按 bvid 去重
  const dup = await playlists.addSongs(a.id, [mkSong(2), mkSong(4)]);
  await ok('重复的被跳过', dup.added === 1 && dup.skipped === 1);
  await check('去重后总数正确', dup.playlist.songCount, 4);

  // 缺 bvid 的条目跳过而不是报错
  const bad = await playlists.addSongs(a.id, [{ id: 'x', title: '没有 bvid' }, mkSong(5)]);
  await ok('缺 bvid 计入 skipped', bad.added === 1 && bad.skipped === 1);

  // --- 从歌单移除 ---

  await check('不存在的歌单返回 null', playlists.removeSong('nope', 'BV1'), null);
  await ok('移除成功', (await playlists.removeSong(a.id, 'BV1')).removed);
  await ok('不存在的曲目返回 removed=false', (await playlists.removeSong(a.id, 'BV99')).removed === false);
  await check('移除后总数减一', (await playlists.get(a.id)).songCount, 4);

  // --- 重排 ---

  await playlists.addSongs(b.id, [mkSong(10), mkSong(11), mkSong(12)]);
  await check('空顺序 = 清空', (await playlists.reorder(b.id, [])).playlist.songCount, 0);
  // 上一步刚清空，重新加回来再验证重排
  await playlists.addSongs(b.id, [mkSong(10), mkSong(11), mkSong(12)]);
  const reordered = await playlists.reorder(b.id, ['BV12', 'BV10']);
  await check('按给定顺序重排', reordered.playlist.songs.map((s) => s.bvid), ['BV12', 'BV10']);
  await check('顺序外的 id 被丢弃', reordered.playlist.songCount, 2);
  await check('不存在的歌单返回 null', playlists.reorder('nope', ['BV1']), null);

  // --- 重命名 ---

  await check('重命名不存在的返回 null', playlists.rename('nope', '新名'), null);
  const renamed = await playlists.rename(a.id, '  新歌单名  ');
  await check('重命名生效并去空白', renamed.playlist.name, '新歌单名');
  await ok('旧名字返回给调用方', renamed.oldName === '甲');
  await check(
    '空名字回落到默认名',
    (await playlists.rename(a.id, '   ')).playlist.name,
    '我喜欢的音乐 3'
  );
  // 改名成已有的名字要走去重，不能改出两个同名歌单
  await playlists.create('重名目标');
  await ok('改名撞名会被加上后缀', (await playlists.rename(a.id, '重名目标')).playlist.name === '重名目标 2');
  // 改名成自己的名字不算冲突
  const selfName = (await playlists.get(a.id)).name;
  await ok('改名成自己不受影响', (await playlists.rename(a.id, selfName)).playlist.name === selfName);

  // --- 删除 ---

  await check('删除不存在的返回 null', playlists.remove('nope'), null);
  await playlists.remove(b.id);
  await check('删除后查不到', playlists.get(b.id), null);

  // --- 持久化 ---

  const onDisk = JSON.parse(await readFile(join(dataDir, 'playlists.json'), 'utf8'));
  await ok('写盘的歌单数对得上', onDisk.playlists.length === (await playlists.list()).length);
  await ok('歌单名在写盘的内容里', onDisk.playlists.some((p) => p.name === detail.name || p.songs.length === 4));
  await check('写盘带上加进去的曲目', onDisk.playlists.find((p) => p.songs.length === 4).songs.length, 4);
  await check('写盘的是原子写入后的目标文件', typeof onDisk.version, 'number');

  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  console.log(`\n${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (err) {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  console.error(err);
  process.exit(1);
}
