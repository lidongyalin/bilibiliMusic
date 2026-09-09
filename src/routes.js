import { Router } from 'express';
import { ApiError } from './api/http.js';
import { searchSongs, formatDuration, formatPlayCount } from './api/bilibili.js';
import { fetchLyrics } from './api/lyrics.js';
import { handleStream, resolveAudio } from './api/stream.js';
import { favorites } from './store/favorites.js';

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
    res.json(await fetchLyrics(title, String(req.query.artist || '')));
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

  return router;
}
