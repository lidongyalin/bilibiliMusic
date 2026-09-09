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

  /** 歌词。查不到时后端返回 found=false，不报错 */
  lyrics(title, artist = '') {
    const q = new URLSearchParams({ title: String(title || '') })
    if (artist) q.set('artist', artist)
    return request(`/api/lyrics?${q}`)
  },

  /**
   * 音频地址由后端解析并代理，前端从不接触 CDN 原始地址——
   * 既避免 CORS 拦截，也让地址过期时能由后端重新解析。
   */
  streamUrl(bvid) {
    return `/api/stream/${encodeURIComponent(bvid)}`
  },
}
