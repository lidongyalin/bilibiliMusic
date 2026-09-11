import { Router } from 'express';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, basename, resolve } from 'node:path';
import { ApiError } from './api/http.js';
import { library } from './store/library.js';
import { history } from './store/history.js';
import { settings } from './store/settings.js';
import { handleLocalFile } from './api/localstream.js';

/**
 * 本地曲库 / 播放历史 / 设置这一组路由。
 * 与 routes.js 分开是因为它跟 B 站上游完全无关，
 * 独立成一个文件也让「本地播放器」这个能力可以整体增删。
 */

function api(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      console.error(`[error] ${req.method} ${req.path}:`, err.message);
      res.status(status).json({ error: err.message || '服务器内部错误' });
    }
  };
}

/** 解析 m3u：跳过注释行，去掉 file:// 前缀，相对路径按 m3u 所在目录解析 */
function parseM3U(text, baseDir) {
  const paths = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let p = line;
    if (/^file:\/\//i.test(p)) p = p.replace(/^file:\/\//i, '');
    // 去掉反斜杠路径里的引号包裹（Windows 导出常见）
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    const abs = p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) ? resolve(p) : resolve(baseDir, p);
    paths.push(abs);
  }
  return paths;
}

function buildM3U(songs) {
  const lines = ['#EXTM3U'];
  for (const s of songs) {
    const duration = Number(s.durationSec) || -1;
    const artist = s.author || '';
    const label = artist ? `${artist} - ${s.title}` : s.title;
    lines.push(`#EXTINF:${duration},${label}`);
    lines.push(s.path || '');
  }
  return lines.join('\n') + '\n';
}

const SMART_KINDS = ['recently-added', 'most-played', 'recently-played'];

export function createLocalRouter() {
  const router = Router();

  // ---------- 曲库 ----------

  /** 全部曲目 + 监控中的文件夹 */
  router.get('/library', api(async (req, res) => {
    res.json(await library.list());
  }));

  /** 扫描进度：扫描是后台任务，前端轮询这个接口 */
  router.get('/library/progress', api(async (req, res) => {
    res.json(library.progress());
  }));

  /** 扫描一个文件夹。body: { path } */
  router.post('/library/folders', api(async (req, res) => {
    const body = req.body || {};
    const result = await library.scanFolder(body.path);
    res.status(201).json({ ok: true, ...result });
  }));

  /** 移除一个监控文件夹及其曲目（不删磁盘文件） */
  router.delete('/library/folders/:id', api(async (req, res) => {
    const result = await library.removeFolder(req.params.id);
    if (!result) { res.status(404).json({ error: '文件夹不存在' }); return; }
    res.json({ ok: true, ...result });
  }));

  /** 修库：检查文件是否还在，补进新出现的文件 */
  router.post('/library/repair', api(async (req, res) => {
    res.json({ ok: true, ...(await library.repair()) });
  }));

  /** 分组列表：artist / album / genre / year / folder */
  router.get('/library/groups', api(async (req, res) => {
    res.json({ groups: await library.groups(req.query.type || 'artist') });
  }));

  /** 分组下的曲目 */
  router.get('/library/group', api(async (req, res) => {
    const type = req.query.type || 'artist';
    const key = String(req.query.key || '');
    res.json({ type, key, songs: await library.groupSongs(type, key) });
  }));

  /** 疑似重复（标题 + 歌手 + 时长三者一致） */
  router.get('/library/duplicates', api(async (req, res) => {
    res.json({ groups: await library.duplicates() });
  }));

  /**
   * 导出 m3u。?ids=id1,id2 只导出选中的；不带 ids 导出全部。
   * 必须声明在下面的 /library/:id 之前——Express 按注册顺序匹配，
   * 否则 export-m3u 会被当成一个 id 吃掉，回 404「曲目不存在」。
   */
  router.get('/library/export-m3u', api(async (req, res) => {
    const { songs } = await library.list();
    const wanted = String(req.query.ids || '').split(',').filter(Boolean);
    const set = wanted.length ? new Set(wanted) : null;
    const picked = set ? songs.filter((s) => set.has(s.bvid)) : songs;
    if (!picked.length) {
      res.status(400).json({ error: '没有可导出的曲目' });
      return;
    }
    const text = buildM3U(picked);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `bilibili-music-${stamp}.m3u`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(text);
  }));

  /** 导入 m3u。body: { path } —— 由 Electron 的打开对话框选出来 */
  router.post('/library/import-m3u', api(async (req, res) => {
    const body = req.body || {};
    if (typeof body.path !== 'string' || !body.path) {
      res.status(400).json({ error: '请指定 m3u 文件路径' });
      return;
    }
    let text;
    try {
      text = await readFile(body.path, 'utf8');
    } catch {
      res.status(400).json({ error: 'm3u 文件读取失败' });
      return;
    }
    const paths = parseM3U(text, dirname(body.path));
    if (!paths.length) {
      res.status(400).json({ error: 'm3u 里没有可用的文件路径' });
      return;
    }
    const result = await library.addFiles(paths, {
      name: basename(body.path).replace(/\.[^.]+$/, ''),
      path: dirname(body.path),
    });
    res.json({ ok: true, ...result });
  }));

  /** 单曲详情 */
  router.get('/library/:id', api(async (req, res) => {
    const song = await library.get(req.params.id);
    if (!song) { res.status(404).json({ error: '曲目不存在' }); return; }
    res.json({ song });
  }));

  /** 编辑元数据（本地覆盖，不改原文件标签）。body: { title, artist, album, ... } */
  router.put('/library/:id', api(async (req, res) => {
    const song = await library.updateMeta(req.params.id, req.body || {});
    if (!song) { res.status(404).json({ error: '曲目不存在' }); return; }
    res.json({ ok: true, song });
  }));

  /** 清除覆盖，恢复原标签 */
  router.delete('/library/:id/override', api(async (req, res) => {
    const song = await library.clearOverrides(req.params.id);
    if (!song) { res.status(404).json({ error: '曲目不存在' }); return; }
    res.json({ ok: true, song });
  }));

  /** 批量从曲库移除（不删磁盘文件）。body: { ids } */
  router.post('/library/remove', api(async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.ids) || !body.ids.length) {
      res.status(400).json({ error: '请至少选择一首歌' });
      return;
    }
    res.json({ ok: true, ...(await library.removeSongs(body.ids)) });
  }));

  // ---------- 本地文件 ----------

  /** 本地音频流，支持 Range */
  router.get('/local/stream/:id', async (req, res) => {
    const path = await library.rawPath(req.params.id);
    if (!path) {
      res.status(404).json({ error: '曲目不存在' });
      return;
    }
    try {
      await handleLocalFile(req, res, path);
    } catch (err) {
      console.error(`[error] GET /local/stream/${req.params.id}:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: '音频流处理失败' });
    }
  });

  /** 专辑封面。缓存到内存，不写回索引 */
  router.get('/local/cover/:id', api(async (req, res) => {
    const art = await library.art(req.params.id);
    if (!art) {
      // 没有封面时返回 404，前端走占位图
      res.status(404).json({ error: '没有封面' });
      return;
    }
    res.setHeader('Content-Type', art.mime);
    res.setHeader('Content-Length', String(art.data.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(Buffer.from(art.data));
  }));

  /**
   * 本地歌词：同目录下的 .lrc / .txt。
   * 只在这一次请求里读进内存，后端不落任何缓存——
   * 歌词是版权内容，处理原则和在线歌词一样：进程内即时使用，不写文件。
   *
   * 用户自己放在曲库旁边的 .lrc 是本地文件，属于用户自己的数据，
   * 跟从第三方接口抓取有本质区别。
   */
  router.get('/local/lrc/:id', api(async (req, res) => {
    const song = await library.raw(req.params.id);
    if (!song) { res.status(404).json({ error: '曲目不存在' }); return; }

    // 歌词文件名没有统一约定，常见两种：跟音频同名（`歌手 - 歌名.lrc`），
    // 或者只按歌名（`歌名.lrc`）。把两种都试一遍，.lrc 优先于 .txt。
    const base = basename(song.path, extnameSafe(song.path));
    const names = new Set();
    for (const n of [base, song.title, song.artist, song.album]) {
      if (n) names.add(n);
    }
    for (const a of [song.artist, song.albumArtist]) {
      if (a && song.title) names.add(`${a} - ${song.title}`);
    }
    if (song.artist && song.title) names.add(`${song.title} - ${song.artist}`);

    const exts = ['.lrc', '.lyrics'];
    if (process.env.LOCAL_LRC_TXT !== '0') exts.push('.txt');
    const candidates = [];
    for (const ext of exts) for (const n of names) candidates.push(`${n}${ext}`);

    const dir = dirname(song.path);
    for (const name of candidates) {
      const full = join(dir, name);
      try {
        const st = await stat(full);
        if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
        res.json({ found: true, source: 'local', file: name, text: await readFile(full, 'utf8') });
        return;
      } catch { /* 继续试下一个 */ }
    }
    res.json({ found: false, source: null, text: '' });
  }));

  // ---------- 播放历史 / 智能歌单 ----------

  router.get('/history', api(async (req, res) => {
    const limit = Number(req.query.limit) || 200;
    res.json({ list: await history.list(limit) });
  }));

  router.get('/history/most-played', api(async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json({ list: await history.mostPlayed(limit) });
  }));

  /** 记一次播放。前端在曲目开始播放时调 */
  router.post('/history', api(async (req, res) => {
    const song = req.body || {};
    if (!song.bvid) { res.status(400).json({ error: '缺少 bvid' }); return; }
    const record = await history.record(song);
    res.json({ ok: true, record });
  }));

  router.delete('/history', api(async (req, res) => {
    await history.clear();
    res.json({ ok: true });
  }));

  router.delete('/history/:id', api(async (req, res) => {
    await history.remove(req.params.id);
    res.json({ ok: true });
  }));

  /**
   * 智能歌单。全部由本地记录实时算出，不存副本：
   *   recently-added  ← 曲库导入时间
   *   most-played     ← 播放次数
   *   recently-played ← 最近播放时间
   */
  router.get('/smart', api(async (req, res) => {
    const kind = SMART_KINDS.includes(req.query.kind) ? req.query.kind : 'recently-added';
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 300, 1000));

    if (kind === 'most-played') {
      res.json({ kind, songs: await history.mostPlayed(limit) });
      return;
    }
    if (kind === 'recently-played') {
      res.json({ kind, songs: await history.list(limit) });
      return;
    }
    const all = await library.songs();
    const songs = all
      .filter((s) => !s.broken)
      .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
      .slice(0, limit)
      .map((s) => ({ ...s, added: s.addedAt }));
    res.json({ kind, songs });
  }));

  // ---------- 设置 ----------

  router.get('/settings', api(async (req, res) => {
    res.json({ settings: await settings.all(), schema: settings.schema() });
  }));

  router.put('/settings', api(async (req, res) => {
    res.json({ ok: true, settings: await settings.update(req.body || {}) });
  }));

  return router;
}

function extnameSafe(p) {
  const i = p.lastIndexOf('.');
  return i > 0 ? p.slice(i) : '';
}
