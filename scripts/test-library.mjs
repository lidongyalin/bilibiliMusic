import { mkdtemp, mkdir, writeFile, rm, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mp3File, flacFile, m4aFile, oggFile,
} from './fixtures/audio.mjs';

/**
 * 曲库 store 的集成测试：真扫描临时目录，不走 HTTP。
 *
 * DATA_DIR 要在 import 之前设好——store 在模块求值时就读了 CONFIG.DATA_DIR。
 */

const base = await mkdtemp(join(tmpdir(), 'blm-lib-'));
const dataDir = join(base, 'data');
const musicDir = join(base, 'music');
const subDir = join(musicDir, '歌手A');
await mkdir(dataDir, { recursive: true });
await mkdir(subDir, { recursive: true });

process.env.DATA_DIR = dataDir;

const { library } = await import('../src/store/library.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

try {
  console.log('\n扫描文件夹');
  await writeFile(join(musicDir, '周杰伦 - 晴天.mp3'), mp3File({
    title: '晴天', artist: '周杰伦', album: '叶惠美', year: '2003', xingFrames: 200,
  }));
  await writeFile(join(musicDir, '邓紫棋 - 光年之外.flac'), flacFile({
    title: '光年之外', artist: '邓紫棋', album: '光年之外', durationSec: 2,
  }));
  await writeFile(join(subDir, '周杰伦 - 七里香.m4a'), m4aFile({
    title: '七里香', artist: '周杰伦', album: '七里香', year: '2004', cover: true, durationSec: 3,
  }));
  await writeFile(join(subDir, '陈奕迅 - 富士山下.ogg'), oggFile({
    title: '富士山下', artist: '陈奕迅', durationSec: 4,
  }));
  await writeFile(join(musicDir, 'notes.txt'), 'not audio');

  const scan = await library.scanFolder(musicDir);
  ok('扫到 4 首', scan.scanned === 4, `got ${scan.scanned}`);
  ok('新增 4 首', scan.added === 4, `got ${scan.added}`);
  ok('无失败', scan.failed === 0, `got ${scan.failed}`);
  ok('扫描完成', library.progress().running === false);

  console.log('\n列表与序列化');
  const { songs, folders } = await library.list();
  ok('4 条曲目', songs.length === 4, `got ${songs.length}`);
  ok('1 个文件夹', folders.length === 1);
  ok('bvid 前缀 local-', songs.every((s) => s.bvid.startsWith('local-')), JSON.stringify(songs[0]?.bvid));
  ok('source=local', songs.every((s) => s.source === 'local'));
  const qing = songs.find((s) => s.title === '晴天');
  ok('作者取自标签', qing.author === '周杰伦', `got ${qing.author}`);
  ok('时长已格式化', /\d+:\d{2}$/.test(qing.duration), `got ${qing.duration}`);
  ok('bvid 作为播放主键可用', typeof qing.bvid === 'string' && qing.bvid.length > 10);
  ok('localId 是裸 id', qing.localId && !qing.localId.startsWith('local-'), `got ${qing.localId}`);
  ok('裸 id 和带前缀 id 都能查到', await library.get(qing.localId) !== null && await library.get(qing.bvid) !== null);
  ok('无封面时封面字段为空串', qing.cover === '');
  const qi = songs.find((s) => s.title === '七里香');
  ok('有封面的曲目给封面 URL', qi.cover.startsWith('/api/local/cover/'), `got ${qi.cover}`);
  ok('歌手缺失时回落默认值', songs.every((s) => s.author), JSON.stringify(songs.find((s) => !s.author)));

  console.log('\n分组浏览');
  const artists = await library.groups('artist');
  ok('按歌手分组 3 组', artists.length === 3, `got ${artists.length}: ${artists.map((a) => a.name).join('/')}`);
  const artistRows = await library.groupSongs('artist', '周杰伦');
  ok('周杰伦组下 2 首', artistRows.length === 2, `got ${artistRows.length}`);

  const albums = await library.groups('album');
  ok('按专辑分组', albums.length >= 3, `got ${albums.length}`);

  const foldersG = await library.groups('folder');
  ok('按文件夹分组 2 组', foldersG.length === 2, `got ${foldersG.length}`);

  console.log('\n元数据覆盖（不改动原文件）');
  {
    const updated = await library.updateMeta(qing.localId, { title: '晴天（修复版）', artist: '周杰伦' });
    ok('标题被覆盖', updated.title === '晴天（修复版）', `got ${updated.title}`);
    ok('标记 hasMetaOverride', updated.hasMetaOverride === true);
    ok('覆盖对分组生效', (await library.groupSongs('artist', '周杰伦')).some((s) => s.title === '晴天（修复版）'));
    ok('分组里不再出现旧标题', !(await library.groupSongs('artist', '周杰伦')).some((s) => s.title === '晴天'));
    const cleared = await library.clearOverrides(qing.localId);
    ok('清除后恢复原标题', cleared.title === '晴天', `got ${cleared.title}`);
    ok('清除后标记归零', cleared.hasMetaOverride === false);
    ok('未知曲目返回 null', await library.updateMeta('nope', { title: 'x' }) === null);
  }

  console.log('\n批量元数据（F28）');
  {
    const all = await library.list();
    const picks = all.songs.slice(0, 3);
    const ids = picks.map((s) => s.localId);

    const res = await library.updateMetaBatch(ids, { genre: '流行', albumArtist: '群星' });
    ok('全部更新', res.updated === picks.length, `got ${res.updated}`);
    ok('无缺失', res.missing === 0, `got ${res.missing}`);
    const after = await library.list();
    ok('流派写进覆盖', after.songs.slice(0, 3).every((s) => s.genre === '流行'));
    ok('标记 hasMetaOverride', after.songs.slice(0, 3).every((s) => s.hasMetaOverride === true));

    // 与原标签相同的值不应留下覆盖。用一首还没被这批用例碰过的歌验证，
    // picks[0..2] 此时已带着上一条的 genre 覆盖，hasMetaOverride 必然是 true
    const one = all.songs[3];
    if (one) {
      await library.updateMetaBatch([one.localId], { artist: one.author });
      const oneAfter = (await library.list()).songs.find((s) => s.localId === one.localId);
      ok('填回原值不算修改', oneAfter.hasMetaOverride === false, `author=${oneAfter.author}`);
    }

    // 与原值相同的字段不覆盖，其他字段仍然写
    const r2 = await library.updateMetaBatch(ids, { artist: '不存在的歌手', album: '合集' });
    ok('混合更新成功', r2.updated === picks.length);
    const after2 = await library.list();
    ok('专辑已批量写入', after2.songs.slice(0, 3).every((s) => s.album === '合集'));

    // 空 patch 直接跳过
    const r3 = await library.updateMetaBatch(ids, {});
    ok('空 patch skipped', r3.skipped === true && r3.updated === 0);

    // 含未知 id：updated 只算存在的
    const r4 = await library.updateMetaBatch([...ids, 'nope'], { genre: '摇滚' });
    ok('缺失计数', r4.updated === picks.length && r4.missing === 1, `updated=${r4.updated} missing=${r4.missing}`);

    // 清理，免得影响后面的用例
    for (const s of after2.songs.slice(0, 3)) await library.clearOverrides(s.localId);
  }

  console.log('\n重复检测');
  {
    // 复制一份文件：标题 + 歌手 + 时长一致
    await copyFile(join(musicDir, '周杰伦 - 晴天.mp3'), join(musicDir, 'copy.mp3'));
    await library.scanFolder(musicDir);
    const dups = await library.duplicates();
    ok('找到 1 组重复', dups.length === 1, `got ${dups.length}`);
    ok('组内 2 条', dups[0]?.length === 2, `got ${dups[0]?.length}`);
  }

  console.log('\n批量移除');
  {
    const all = await library.list();
    const victim = all.songs.filter((s) => s.bvid !== 'keep')[0];
    const res = await library.removeSongs([victim.bvid]);
    ok('移除 1 条', res.removed === 1, `got ${res.removed}`);
    const after = await library.list();
    ok('总数减 1', after.songs.length === all.songs.length - 1);
  }

  console.log('\n修库（文件被删后标 broken）');
  {
    const before = await library.list();
    const target = before.songs[0];
    await rm(target.path);
    const rep = await library.repair();
    ok('标记 1 条缺失', rep.missing === 1, `got ${rep.missing}`);
    const after = await library.list();
    ok('缺失项标记 broken', after.songs.find((s) => s.id === target.id)?.broken === true);
    const artistRows = (await library.groups('artist')).reduce((n, g) => n + g.songCount, 0);
    ok('分组计数不含 broken', artistRows === after.songs.filter((s) => !s.broken).length, `got ${artistRows}`);
  }

  console.log('\n重新扫描已有曲目不重复入库');
  {
    const before = (await library.list()).songs.length;
    await library.scanFolder(musicDir);
    const after = (await library.list()).songs.length;
    ok('数量不变', after === before, `before=${before} after=${after}`);
  }

  console.log('\n手动移出的文件不会被重新扫描带回来');
  {
    // 跳过上一段被删掉的 broken 曲目，取一首文件还真实存在的
    const drop = (await library.list()).songs.find((s) => !s.broken);
    await library.removeSongs([drop.bvid]);
    await library.scanFolder(musicDir);
    await library.repair();
    const after = await library.list();
    ok('重新扫描后仍不在曲库', !after.songs.some((s) => s.id === drop.id));
    ok('修库也不复活', !(await library.list()).songs.some((s) => s.id === drop.id));
    ok('磁盘文件仍在（移除曲库不等于删文件）', (await stat(drop.path)).isFile());
  }

  console.log('\n移除文件夹');
  {
    const { folders: fs } = await library.list();
    const res = await library.removeFolder(fs[0].id);
    ok('文件夹被移除', res.removed >= 1, `got ${res.removed}`);
    const after = await library.list();
    ok('文件夹清空', after.folders.length === 0);
    ok('曲目清空', after.songs.length === 0);
  }

  console.log('\n持久化（重新加载）');
  {
    // 清掉内存缓存，模拟进程重启
    await writeFile(join(dataDir, 'library.json'), JSON.stringify({
      version: 1,
      folders: [{ id: 'f1', path: '/x', name: 'x', addedAt: '2026-01-01', songCount: 1 }],
      songs: [{
        id: 's1', folderId: 'f1', path: '/x/a.mp3', name: 'a.mp3', format: 'mp3',
        size: 100, durationSec: 30, title: 'A', artist: 'B', album: 'C', addedAt: '2026-01-02',
      }],
      overrides: { s1: { title: 'A2' } },
    }, null, 2));
    library._resetForTest();
    const { songs } = await library.list();
    ok('重载后曲目可读', songs.length === 1, `got ${songs.length}`);
    ok('重载后保留覆盖', songs[0].title === 'A2', `got ${songs[0].title}`);
  }

  console.log('\n异常输入');
  {
    for (const [name, input] of [
      ['空路径', ''],
      ['不存在的目录', join(base, 'nope')],
      ['文件不是目录', join(musicDir, '周杰伦 - 晴天.mp3')],
    ]) {
      try {
        await library.scanFolder(input);
        ok(`${name} 抛错`, false, '没有抛');
      } catch (e) {
        ok(`${name} 抛错`, /不存在|不是文件夹|请指定/.test(e.message), e.message);
      }
    }
  }
} catch (e) {
  fail += 1;
  console.error('未捕获异常:', e);
}

await rm(base, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
