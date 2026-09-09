import { Router } from 'express';
import { ApiError } from './api/http.js';
import { searchSongs, formatDuration, formatPlayCount } from './api/bilibili.js';
import { fetchLyrics } from './api/lyrics.js';
import { handleStream, resolveAudio } from './api/stream.js';
import { favorites } from './store/favorites.js';
import { playlists } from './store/playlists.js';

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

/** 收藏条目补齐展示字段，前端拿到就能直接渲染 */
function withPlayText(item) {
  return { ...item, playText: item.playText || formatPlayCount(item.play) };
}

export function createRouter() {
  const router = Router();

  /** 搜索音乐 */
  router.get('/search', api(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const result = await searchSongs(req.query.keyword, page);
    res.json(result);
  }));

  /** 歌词：按当前播放的曲名查。查不到时返回 found=false 而不是报错 */
  router.get('/lyrics', api(async (req, res) => {
    const title = String(req.query.title || '');
    if (!title.trim()) { res.status(400).json({ error: '缺少曲名' }); return; }
    // durationSec 用来给候选打分（时长接近度），不是必填：没有时按中性分处理
    const durationSec = Number(req.query.durationSec) || 0;
    res.json(await fetchLyrics(title, String(req.query.artist || ''), durationSec));
  }));

  /** 播放：后端解析音轨地址后代理转发，支持 Range */
  router.get('/stream/:bvid', async (req, res) => {
    try {
      await handleStream(req, res, req.params.bvid);
    } catch (err) {
      // handleStream 自己已经处理了预期的失败；这里只兜住意料之外的异常，
      // 否则上游偶发故障会变成无日志的 502，完全无从排查
      console.error(`[error] GET /stream/${req.params.bvid}:`, err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message || '音频流处理失败' });
    }
  });

  /** 音轨可用性探测：前端播放前可先问一次，避免加载失败后才提示 */
  router.get('/probe/:bvid', api(async (req, res) => {
    const audio = await resolveAudio(req.params.bvid);
    res.json({
      ok: true,
      bvid: req.params.bvid,
      durationSec: audio.durationSec,
      bandwidth: audio.bandwidth,
      duration: formatDuration(audio.durationSec),
    });
  }));

  /** 全部收藏 */
  router.get('/favorites', api(async (req, res) => {
    res.json({ list: (await favorites.list()).map(withPlayText) });
  }));

  /** 查询收藏状态，批量 */
  router.get('/favorites/check', api(async (req, res) => {
    const ids = new Set((await favorites.ids()).map(String));
    const wanted = String(req.query.ids || '').split(',').filter(Boolean);
    res.json({ favorite: Object.fromEntries(wanted.map((id) => [id, ids.has(id)])) });
  }));

  /** 收藏一首 */
  router.post('/favorites', api(async (req, res) => {
    const body = req.body || {};
    if (!body.bvid) { res.status(400).json({ error: '缺少 bvid' }); return; }
    const created = await favorites.add({ ...body, id: body.bvid });
    res.status(created.already ? 200 : 201).json({ ok: true, song: withPlayText(created) });
  }));

  /** 取消收藏 */
  router.delete('/favorites/:id', api(async (req, res) => {
    const removed = await favorites.remove(req.params.id);
    if (!removed) { res.status(404).json({ error: '该曲目不在收藏中' }); return; }
    res.json({ ok: true });
  }));

  // ---------- 歌单 ----------

  /** 全部歌单（摘要：名字 + 曲数） */
  router.get('/playlists', api(async (req, res) => {
    res.json({ list: await playlists.list() });
  }));

  /** 新建歌单 */
  router.post('/playlists', api(async (req, res) => {
    const body = req.body || {};
    res.status(201).json({ ok: true, playlist: await playlists.create(body.name) });
  }));

  /** 单个歌单详情（含曲目） */
  router.get('/playlists/:id', api(async (req, res) => {
    const playlist = await playlists.get(req.params.id);
    if (!playlist) { res.status(404).json({ error: '歌单不存在' }); return; }
    res.json({ playlist });
  }));

  /** 重命名歌单 */
  router.put('/playlists/:id', api(async (req, res) => {
    const body = req.body || {};
    const updated = await playlists.rename(req.params.id, body.name);
    if (!updated) { res.status(404).json({ error: '歌单不存在' }); return; }
    res.json({ ok: true, playlist: updated });
  }));

  /** 删除歌单 */
  router.delete('/playlists/:id', api(async (req, res) => {
    const removed = await playlists.remove(req.params.id);
    if (!removed) { res.status(404).json({ error: '歌单不存在' }); return; }
    res.json({ ok: true });
  }));

  /**
   * 批量加歌。body: { songs: [...] }
   * 一次提交多条而不是逐条 POST：多选 20 首时省掉 20 个网络往返，
   * 也避免 20 次并发写把 saveChain 排成长队。重复的按 bvid 去重，不报错。
   */
  router.post('/playlists/:id/songs', api(async (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.songs) || !body.songs.length) {
      res.status(400).json({ error: '请至少选择一首歌' });
      return;
    }
    const result = await playlists.addSongs(req.params.id, body.songs);
    if (!result) { res.status(404).json({ error: '歌单不存在' }); return; }
    res.json({ ok: true, added: result.added, skipped: result.skipped, playlist: result.playlist });
  }));

  /** 从歌单移除一首 */
  router.delete('/playlists/:id/songs/:bvid', api(async (req, res) => {
    const result = await playlists.removeSong(req.params.id, req.params.bvid);
    if (!result) { res.status(404).json({ error: '歌单不存在' }); return; }
    if (!result.removed) { res.status(404).json({ error: '该曲目不在歌单中' }); return; }
    res.json({ ok: true, playlist: result.playlist });
  }));

  /** 重排歌单顺序。body: { songs: [bvid, ...] } 按目标顺序 */
  router.put('/playlists/:id/songs/order', api(async (req, res) => {
    const body = req.body || {};
    const result = await playlists.reorder(req.params.id, body.songs);
    if (!result) { res.status(404).json({ error: '歌单不存在' }); return; }
    res.json({ ok: true, playlist: result.playlist });
  }));

  return router;
}
