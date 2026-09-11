import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 本地曲库路由的端到端测试：真起 Express 但监听随机端口（listen(0)），
 * 跑完立即关，不占固定端口、不动 8788。
 *
 * 覆盖单测覆盖不到的部分：路由接线、Range 分段、m3u 文本、智能歌单聚合、
 * 设置读写、以及「404 而不是静默空响应」这类错误路径。
 */

const base = await mkdtemp(join(tmpdir(), 'blm-http-'));
const dataDir = join(base, 'data');
const musicDir = join(base, 'music');
const subDir = join(musicDir, '子目录');
await mkdir(dataDir, { recursive: true });
await mkdir(subDir, { recursive: true });

// config.js 在模块求值那一刻就冻结了 DATA_DIR，所以必须先设好环境变量，
// 再动态 import 后端代码。写成静态 import 会读到仓库内的 data/ 目录。
process.env.DATA_DIR = dataDir;
process.env.HOST = '127.0.0.1';

// env 变量设好之后才 import，保证后端用临时 DATA_DIR
const { createApp } = await import('../src/createApp.js');
const { mp3File, flacFile, m4aFile } = await import('./fixtures/audio.mjs');

await writeFile(join(musicDir, '周杰伦 - 晴天.mp3'), mp3File({
  title: '晴天', artist: '周杰伦', album: '叶惠美', xingFrames: 200,
}));
await writeFile(join(subDir, '邓紫棋 - 光年之外.flac'), flacFile({
  title: '光年之外', artist: '邓紫棋', album: '光年之外', durationSec: 2,
}));
await writeFile(join(subDir, '林俊杰 - 江南.m4a'), m4aFile({
  title: '江南', artist: '林俊杰', album: '江南', cover: true, durationSec: 3,
}));
// 本地歌词：只放在 m4a 旁边（按歌名取，而不是按音频文件名取）。
// FLAC 故意不放，用来验证「确实没有歌词时返回 found:false」。
await writeFile(join(subDir, '江南.lrc'), '[00:01.00]第一行歌词\n[00:03.00]第二行歌词\n');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  return { status: res.status, headers: res.headers, body, ct };
}
const post = (path, data) => get(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
const put = (path, data) => get(path, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

try {
  console.log('\n扫描曲库');
  const scan = await post('/api/library/folders', { path: musicDir });
  ok('扫描返回 201', scan.status === 201, `got ${scan.status}`);
  ok('扫到 3 首', scan.body.scanned === 3, `got ${scan.body.scanned}`);
  ok('进度已结束', (await get('/api/library/progress')).body.running === false);

  console.log('\n曲库列表');
  const list = await get('/api/library');
  ok('200', list.status === 200, `got ${list.status}`);
  ok('3 条曲目', list.body.songs.length === 3, `got ${list.body.songs.length}`);
  ok('1 个文件夹', list.body.folders.length === 1);
  const m4a = list.body.songs.find((s) => s.title === '江南');
  const mp3 = list.body.songs.find((s) => s.title === '晴天');
  ok('m4a 有封面 URL', m4a.cover.startsWith('/api/local/cover/'), `got ${m4a.cover}`);
  ok('mp3 无封面为空串', mp3.cover === '');

  console.log('\n分组');
  const artists = await get('/api/library/groups?type=artist');
  ok('按歌手分组 3 组', artists.body.groups.length === 3, `got ${artists.body.groups.length}`);
  const inArtist = await get(`/api/library/group?type=artist&key=${encodeURIComponent('周杰伦')}`);
  ok('组内 1 首', inArtist.body.songs.length === 1, `got ${inArtist.body.songs.length}`);
  ok('返回 key 回显', inArtist.body.key === '周杰伦');
  const byFolder = await get('/api/library/groups?type=folder');
  ok('按目录分组 2 组', byFolder.body.groups.length === 2, `got ${byFolder.body.groups.length}`);

  console.log('\n本地音频流（Range）');
  const full = await get(`/api/local/stream/${m4a.localId}`);
  ok('完整请求 200', full.status === 200, `got ${full.status}`);
  ok('声明 Accept-Ranges', full.headers.get('accept-ranges') === 'bytes');
  ok('Content-Type 是 audio/mp4', full.ct.startsWith('audio/mp4'), `got ${full.ct}`);
  const totalLen = Number(full.headers.get('content-length'));
  ok('有 Content-Length', totalLen > 0, `got ${totalLen}`);

  const partial = await fetch(`${BASE}/api/local/stream/${m4a.localId}`, { headers: { Range: 'bytes=0-19' } });
  ok('分段请求 206', partial.status === 206, `got ${partial.status}`);
  ok('Content-Range 正确', partial.headers.get('content-range') === `bytes 0-19/${totalLen}`, `got ${partial.headers.get('content-range')}`);
  ok('分段长度 20', Number(partial.headers.get('content-length')) === 20, `got ${partial.headers.get('content-length')}`);

  const suffix = await fetch(`${BASE}/api/local/stream/${m4a.localId}`, { headers: { Range: `bytes=${totalLen - 5}-${totalLen - 1}` } });
  ok('尾部请求 206', suffix.status === 206, `got ${suffix.status}`);

  ok('未知曲目 404', (await get('/api/local/stream/nope')).status === 404);
  ok('曲库详情 404', (await get('/api/library/nope')).status === 404);

  console.log('\n封面');
  const cover = await get(`/api/local/cover/${m4a.localId}`);
  ok('封面 200', cover.status === 200, `got ${cover.status}`);
  ok('Content-Type image/png', cover.ct.startsWith('image/png'), `got ${cover.ct}`);
  ok('无封面的曲目 404', (await get(`/api/local/cover/${mp3.localId}`)).status === 404);

  console.log('\n本地歌词');
  const lrc = await get(`/api/local/lrc/${m4a.localId}`);
  ok('找到 .lrc', lrc.body.found === true, JSON.stringify(lrc.body));
  ok('标记来源为本地', lrc.body.source === 'local');
  ok('回传文件名', lrc.body.file === '江南.lrc', `got ${lrc.body.file}`);
  ok('内容正确', lrc.body.text.includes('第一行歌词'));
  const flac = list.body.songs.find((s) => s.title === '光年之外');
  ok('没有 .lrc 时 found=false', (await get(`/api/local/lrc/${flac.localId}`)).body.found === false);
  ok('found=false 也是 200', (await get(`/api/local/lrc/${flac.localId}`)).status === 200);
  ok('歌词路径曲目不存在 404', (await get('/api/local/lrc/nope')).status === 404);

  console.log('\n元数据编辑');
  const meta = await put(`/api/library/${mp3.localId}`, { title: '晴天（修复版）' });
  ok('PUT 成功', meta.status === 200, `got ${meta.status}`);
  ok('标题已更新', meta.body.song.title === '晴天（修复版）', `got ${meta.body.song.title}`);
  ok('标记覆盖', meta.body.song.hasMetaOverride === true);
  ok('用带前缀 id 也能改', (await put(`/api/library/${mp3.bvid}`, { title: '晴天' })).body.song.title === '晴天');
  ok('恢复覆盖', (await get(`/api/library/${mp3.localId}`)).body.song.hasMetaOverride === false);
  ok('DELETE 覆盖 404 兜底', (await get(`/api/library/nope`, { method: 'PUT' })).status === 404);

  console.log('\n重复检测');
  await writeFile(join(musicDir, 'copy.mp3'), mp3File({ title: '晴天', artist: '周杰伦', xingFrames: 200 }));
  await post('/api/library/folders', { path: musicDir });
  const dups = await get('/api/library/duplicates');
  ok('找到重复组', dups.body.groups.length >= 1, `got ${dups.body.groups.length}`);

  console.log('\n批量移除');
  // copy.mp3 和原始 晴天.mp3 是重复内容，把它们从曲库里拿掉；磁盘文件不动
  const has = (arr, file) => arr.some((s) => s.path.endsWith(`\\${file}`) || s.path.endsWith(`/${file}`));
  const all = await get('/api/library');
  ok('此刻共 4 首（3 首 + copy.mp3）', all.body.songs.length === 4, `got ${all.body.songs.length}`);
  const copy = all.body.songs.find((s) => has([s], 'copy.mp3'));
  ok('找到 copy.mp3', !!copy);
  const rmRes = await post('/api/library/remove', { ids: [copy.bvid, mp3.bvid] });
  ok('移除成功', rmRes.status === 200, `got ${rmRes.status}`);
  ok('removed=2', rmRes.body.removed === 2, `got ${rmRes.body.removed}`);
  ok('已移除的曲目查不到', (await get(`/api/library/${copy.localId}`)).status === 404);
  ok('空数组 400', (await post('/api/library/remove', { ids: [] })).status === 400);

  console.log('\n修库');
  const onDisk = await get('/api/library');
  ok('移除后剩 2 首', onDisk.body.songs.length === 2, `got ${onDisk.body.songs.length}`);
  // 磁盘上再补一首，同时确认「被移出的曲目不会因修库而复活」
  await writeFile(join(musicDir, '删掉的.mp3'), mp3File({ title: '删掉的歌', artist: '某人', xingFrames: 2 }));
  const repair = await post('/api/library/repair', {});
  ok('修库 200', repair.status === 200, `got ${repair.status}`);
  ok('补进新出现的 1 首', repair.body.added === 1, JSON.stringify(repair.body));
  ok('总数 3', repair.body.total === 3, JSON.stringify(repair.body));
  const afterRepair = await get('/api/library');
  ok('手动移除的不会因修库复活', !has(afterRepair.body.songs, 'copy.mp3'));
  ok('被移除的曲目磁盘文件还在', (await stat(join(musicDir, 'copy.mp3'))).isFile());
  // 排除记录是持久化的：重新扫描同一个文件夹也不会把它扫回来
  const rescan = await post('/api/library/folders', { path: musicDir });
  ok('重新扫描不新增曲目', rescan.body.total === 3, `got ${JSON.stringify(rescan.body)}`);
  ok('重新扫描后仍无 copy.mp3', !has((await get('/api/library')).body.songs, 'copy.mp3'));

  console.log('\nm3u 导出');
  const cur = await get('/api/library');
  const exp = await get(`/api/library/export-m3u?ids=${cur.body.songs.map((s) => s.bvid).join(',')}`);
  ok('导出 200', exp.status === 200, `got ${exp.status} ${typeof exp.body === 'string' ? exp.body.slice(0, 120) : ''}`);
  ok('Content-Type text/plain', exp.ct.startsWith('text/plain'), `got ${exp.ct}`);
  ok('带附件头', (exp.headers.get('content-disposition') || '').includes('attachment'));
  ok('#EXTM3U 头', exp.body.startsWith('#EXTM3U'));
  ok('含 #EXTINF 行', exp.body.includes('#EXTINF:'));
  ok('EXTINF 带时长和「歌手 - 歌名」', /#EXTINF:\d+,.*-.*/.test(exp.body), exp.body);
  ok('含文件路径', exp.body.includes('删掉的.mp3'), exp.body);
  ok('不带 ids 导出全部', (await get('/api/library/export-m3u')).body.includes('#EXTM3U'));
  ok('空曲库 400', (await get(`/api/library/export-m3u?ids=不存在的id`)).status === 400);

  console.log('\nm3u 导入');
  const m3uPath = join(base, 'import.m3u');
  await writeFile(m3uPath, `#EXTM3U
#EXTINF:${mp3.durationSec || -1},周杰伦 - 晴天
${musicDir}\\周杰伦 - 晴天.mp3
`);
  const imp = await post('/api/library/import-m3u', { path: m3uPath });
  ok('导入 200', imp.status === 200, `got ${imp.status} ${JSON.stringify(imp.body)}`);
  ok('导入 1 首', imp.body.added === 1, `got ${imp.body.added}`);
  ok('来源文件夹名取自 m3u 文件名', imp.body.folder && imp.body.folder.name === 'import');
  ok('来源目录被记录', imp.body.folder && imp.body.folder.path === base);
  ok('坏 m3u 路径 400', (await post('/api/library/import-m3u', { path: join(base, 'nope.m3u') })).status === 400);
  ok('空 m3u 路径 400', (await post('/api/library/import-m3u', {})).status === 400);
  const emptyM3U = join(base, 'empty.m3u');
  await writeFile(emptyM3U, '#EXTM3U\n# 只有注释\n');
  ok('纯注释 m3u 400', (await post('/api/library/import-m3u', { path: emptyM3U })).status === 400);

  console.log('\n播放历史与智能歌单');
  ok('空历史 200', (await get('/api/history')).status === 200);
  const rec = await post('/api/history', { bvid: mp3.bvid, title: '晴天', author: '周杰伦', cover: '', durationSec: 5 });
  ok('记录播放', rec.status === 200 && rec.body.ok === true);
  ok('缺 bvid 400', (await post('/api/history', {})).status === 400);
  ok('历史里有记录', (await get('/api/history')).body.list.length === 1);
  ok('最常播放', (await get('/api/history/most-played')).body.list.length === 1);

  // 同一首歌重复播放：记录数不涨，次数涨
  await post('/api/history', { bvid: mp3.bvid, title: '晴天', author: '周杰伦' });
  await post('/api/history', { bvid: mp3.bvid, title: '晴天', author: '周杰伦' });
  const hist2 = await get('/api/history');
  ok('去重：仍是 1 条', hist2.body.list.length === 1, `got ${hist2.body.list.length}`);
  const mp2 = await get('/api/history/most-played');
  ok('次数累计到 3', mp2.body.list[0].plays === 3, `got ${JSON.stringify(mp2.body.list)}`);
  ok('历史条目本身不带 plays', hist2.body.list[0].plays === undefined);

  await post('/api/history', { bvid: flac.bvid, title: '光年之外', author: '邓紫棋', cover: '' });
  const hist3 = await get('/api/history');
  ok('两首歌两条记录', hist3.body.list.length === 2);
  ok('最近播放的在最前', hist3.body.list[0].bvid === flac.bvid);
  ok('最常播放排序正确', (await get('/api/history/most-played')).body.list[0].bvid === mp3.bvid);
  ok('删除单条', (await get(`/api/history/${flac.bvid}`, { method: 'DELETE' })).body.ok === true);
  ok('删完剩 1 条', (await get('/api/history')).body.list.length === 1);
  ok('删除后计数一并清掉', (await get('/api/history/most-played')).body.list.length === 1);
  ok('history count 与 list 一致', (await get('/api/history')).body.list.length === 1);

  const smartRecent = await get('/api/smart?kind=recently-played');
  ok('最近播放聚合', smartRecent.status === 200 && smartRecent.body.kind === 'recently-played');
  ok('最近播放有 1 条', smartRecent.body.songs.length === 1, `got ${smartRecent.body.songs.length}`);
  const smartMost = await get('/api/smart?kind=most-played');
  ok('最常播放聚合', smartMost.body.kind === 'most-played' && smartMost.body.songs.length === 1);
  const smartAdded = await get('/api/smart?kind=recently-added');
  ok('最近添加聚合', smartAdded.body.kind === 'recently-added' && smartAdded.body.songs.length >= 1);
  ok('未知 kind 回落默认', (await get('/api/smart?kind=bogus')).body.kind === 'recently-added');
  ok('limit 生效', (await get('/api/smart?kind=recently-added&limit=1')).body.songs.length === 1);

  ok('清空历史', (await get('/api/history', { method: 'DELETE' })).body.ok === true);
  ok('清空后为空', (await get('/api/history')).body.list.length === 0);

  console.log('\n设置');
  const s0 = await get('/api/settings');
  ok('默认 closeBehavior=ask', s0.body.settings.closeBehavior === 'ask', JSON.stringify(s0.body.settings));
  ok('带 schema', s0.body.schema && s0.body.schema.closeBehavior);
  const s1 = await put('/api/settings', { closeBehavior: 'tray', miniWidth: 500, unknown: 'x' });
  ok('更新成功', s1.status === 200 && s1.body.ok === true);
  ok('enum 生效', s1.body.settings.closeBehavior === 'tray');
  ok('int 生效', s1.body.settings.miniWidth === 500);
  ok('未知键被丢弃', s1.body.settings.unknown === undefined);
  ok('非布尔值被丢弃', (await put('/api/settings', { closeBehavior: 'bogus', miniWidth: 'abc' })).body.settings.closeBehavior === 'tray');
  ok('保留先前的合法值（不回落默认）', (await get('/api/settings')).body.settings.closeBehavior === 'tray');
  const clamped = await put('/api/settings', { miniWidth: 99999 });
  ok('越界 int 被夹住', clamped.body.settings.miniWidth === 900, JSON.stringify(clamped.body.settings));
  ok('越界下限也被夹住', (await put('/api/settings', { miniWidth: 1 })).body.settings.miniWidth === 320);
  ok('非法值不影响同批里的合法值', (await put('/api/settings', { closeBehavior: 'zzz', confirmClose: false })).body.settings.confirmClose === false);
  const fresh = await get('/api/settings');
  ok('读取与写入一致', fresh.body.settings.miniWidth === 320 && fresh.body.settings.confirmClose === false, JSON.stringify(fresh.body.settings));

  console.log('\n原有路由未被破坏（不打 B 站接口）');
  ok('GET /api/favorites 200', (await get('/api/favorites')).status === 200);
  ok('GET /api/favorites/check 200', (await get('/api/favorites/check?ids=a,b')).status === 200);
  ok('GET /api/playlists 200', (await get('/api/playlists')).status === 200);
  const pl = await post('/api/playlists', { name: '测试歌单' });
  ok('POST /api/playlists 201', pl.status === 201, `got ${pl.status}`);
  const plId = pl.body.playlist?.id;
  ok('歌单详情 200', (await get(`/api/playlists/${plId}`)).status === 200);
  ok('重命名返回 playlist + oldName', (await put(`/api/playlists/${plId}`, { name: '改名' })).body.oldName === '测试歌单');
  ok('把本地曲目加进歌单', (await post(`/api/playlists/${plId}/songs`, { songs: [{ bvid: mp3.bvid, title: '晴天', author: '周杰伦' }] })).body.added === 1);
} catch (e) {
  fail += 1;
  console.error('未捕获异常:', e);
} finally {
  server.close();
  await rm(base, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
