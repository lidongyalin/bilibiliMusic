/** 后端 API 封装。所有错误统一抛出带中文 message 的 Error。 */

async function request(path, options = {}) {
  let res
  try {
    res = await fetch(path, options)
  } catch {
    throw new Error('无法连接服务器，请确认服务仍在运行')
  }

  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const data = isJson ? await res.json().catch(() => ({})) : {}
  if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`)
  return data
}

export const api = {
  search(keyword, page = 1) {
    const q = new URLSearchParams({ keyword, page: String(page) })
    return request(`/api/search?${q}`)
  },

  listFavorites() {
    return request('/api/favorites')
  },

  addFavorite(song) {
    return request('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(song),
    })
  },

  removeFavorite(id) {
    return request(`/api/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  /**
   * 歌词。查不到时后端返回 found=false，不报错。
   * durationSec 传当前曲目的总时长，后端拿它给候选打分（时长接近度），
   * 有这条信号时几乎不会匹配到别首歌的同名版本。
   */
  lyrics(title, artist = '', durationSec = 0) {
    const q = new URLSearchParams({ title: String(title || '') })
    if (artist) q.set('artist', artist)
    if (durationSec) q.set('durationSec', String(durationSec))
    return request(`/api/lyrics?${q}`)
  },

  // ---------- 歌单 ----------

  listPlaylists() {
    return request('/api/playlists')
  },

  createPlaylist(name = '') {
    return request('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  },

  getPlaylist(id) {
    return request(`/api/playlists/${encodeURIComponent(id)}`)
  },

  renamePlaylist(id, name) {
    return request(`/api/playlists/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  },

  deletePlaylist(id) {
    return request(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  /**
   * 批量加歌：一次提交，服务端去重并返回实际新增数。
   *
   * 只传歌单真正需要的字段。前端搜到的条目带一堆纯展示数据（封面原始地址、
   * 已格式化的时长和播放量文本），全量提交时 500 首就要 134kB，会撞后端 body 上限。
   */
  addSongsToPlaylist(id, songs) {
    const payload = (Array.isArray(songs) ? songs : []).map((s) => ({
      bvid: s.bvid,
      id: s.id || s.bvid,
      type: s.type || 'video',
      aid: s.aid || 0,
      title: s.title || '',
      author: s.author || '',
      cover: s.cover || '',
      duration: s.duration || '',
      durationSec: Number(s.durationSec) || 0,
      play: Number(s.play) || 0,
      playText: s.playText || '',
      isPay: Boolean(s.isPay),
    }))
    return request(`/api/playlists/${encodeURIComponent(id)}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs: payload }),
    })
  },

  removeSongFromPlaylist(id, bvid) {
    return request(`/api/playlists/${encodeURIComponent(id)}/songs/${encodeURIComponent(bvid)}`, {
      method: 'DELETE',
    })
  },

  /** 重排歌单顺序：把歌单内曲目的顺序提交回后端 */
  reorderPlaylistSongs(id, ordered) {
    return request(`/api/playlists/${encodeURIComponent(id)}/songs/order`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs: ordered }),
    })
  },

  /**
   * 音频地址由后端解析并代理，前端从不接触 CDN 原始地址——
   * 既避免 CORS 拦截，也让地址过期时能由后端重新解析。
   */
  streamUrl(bvid) {
    return `/api/stream/${encodeURIComponent(bvid)}`
  },
}
