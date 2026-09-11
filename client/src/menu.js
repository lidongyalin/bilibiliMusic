import { state } from './state.js'
import { ElMessage } from 'element-plus'
import { isLocalSong, playSong, playNext, addToQueue, togglePlay } from './player.js'
import { toggleFavorite } from './favorites.js'
import { addSongsToPlaylist } from './playlists.js'
import { saveMeta, restoreMeta, removeSongs, exportM3U } from './library.js'
import { clip } from './utils.js'

/**
 * 右键上下文菜单（F16 曲目 / F17 歌单与分组）。
 *
 * 按「操作清单」思路来：这里只产出一份 item 数组，
 * 桌面端渲染成右键菜单，移动端将来渲染成 Action Sheet 时可以直接复用同一份数据。
 *
 * item 结构：{ label, icon, danger, disabled, divider, onClick }
 * icon 是内联 SVG 路径字符串，跟 icons.js 的 ICON_PATHS 同源。
 */

/** 打开菜单。坐标是鼠标位置（视口坐标） */
export function openMenu(x, y, items) {
  state.contextMenu = { x, y, items: (Array.isArray(items) ? items : []).filter(Boolean) }
}

export function closeMenu() {
  state.contextMenu = null
  state.subMenu = null
}

const sep = { divider: true }

/**
 * 「加入歌单…」的子菜单：现有歌单 + 「新建歌单…」。
 * 没歌单时给一条禁用项，比弹空菜单强。
 */
function playlistChildren(songs) {
  const list = state.playlists.map((p) => ({
    label: p.name,
    count: p.songCount,
    onClick: () => addSongsToPlaylist(p.id, songs),
  }))
  list.push({ divider: true })
  list.push({
    label: '新建歌单…',
    icon: 'edit',
    onClick: () => {
      window.dispatchEvent(new CustomEvent('create-playlist-and-add', { detail: songs }))
    },
  })
  if (!state.playlists.length) list.unshift({ label: '还没有歌单', disabled: true })
  return list
}

/**
 * 曲目右键菜单。同一个函数生成「本地曲库」和「B 站搜索」两套，
 * 区别只在 local 分支（标签编辑、文件位置、移出曲库）。
 */
export function songMenu(x, y, song, list) {
  if (!song) return []
  const local = isLocalSong(song)
  const isCurrent = state.current?.bvid === song.bvid
  const playing = isCurrent && state.status === 'playing'

  const items = [
    {
      label: isCurrent ? (playing ? '暂停' : '继续播放') : '播放',
      icon: playing ? 'pause' : 'play',
      onClick: () => (isCurrent ? togglePlay() : void playSongAt(song, list)),
    },
    { label: '下一首播放', icon: 'next', onClick: () => { playNext([song]); ElMessage.success(`「${clip(song.title)}」已加入下一首`) } },
    { label: '加入播放队列', icon: 'add-queue', onClick: () => { const n = addToQueue([song]); ElMessage.success(n ? '已加入队列' : '队列里已有这首') } },
    sep,
    {
      label: state.favoriteIds.has(song.bvid) ? '取消收藏' : '收藏',
      icon: state.favoriteIds.has(song.bvid) ? 'star-filled' : 'star',
      onClick: () => toggleFavorite(song),
    },
    { label: '加入歌单…', icon: 'playlist', children: playlistChildren([song]) },
    sep,
  ]

  if (local) {
    items.push(
      { label: '编辑标签…', icon: 'edit', onClick: () => openMetaEditor(song) },
      ...(song.hasMetaOverride
        ? [{ label: '恢复原标签', icon: 'reset', onClick: () => restoreMeta(song) }]
        : []),
      { label: '在文件夹中显示', icon: 'folder', onClick: () => showInFolder(song) },
      sep,
      { label: '移出曲库', icon: 'trash', danger: true, onClick: () => removeSongs([song]) },
    )
  } else {
    items.push({ label: '打开 B 站页面', icon: 'external', onClick: () => openBilibili(song) })
  }

  return items
}

/** 播放这一首，并把它所在的列表设为队列 */
export function playSongAt(song, list) {
  void playSong(song, Array.isArray(list) ? list : undefined)
}

/** 歌单 / 分组 / 智能歌单的右键菜单（F17） */
export function playlistMenu(x, y, kind, target, songs) {
  const list = Array.isArray(songs) ? songs : []
  const items = [
    { label: '播放全部', icon: 'play', onClick: () => playAll(list) },
    { label: '下一首播放全部', icon: 'next', onClick: () => playNext(list) },
    { label: '加入播放队列', icon: 'add-queue', onClick: () => { const n = addToQueue(list); ElMessage.success(n ? `已加入队列 ${n} 首` : '队列里都已有') } },
    sep,
  ]

  if (kind === 'local') {
    items.push({ label: '导出为 m3u', icon: 'export', onClick: () => exportM3U(list.map((s) => s.bvid)) })
    items.push(sep)
    items.push({
      label: `全部移出曲库（${list.length} 首）`,
      icon: 'trash',
      danger: true,
      disabled: !list.length,
      onClick: () => {
        const ok = window.confirm(`确定把选中的 ${list.length} 首移出曲库吗？\n磁盘文件不会被删除。`)
        if (ok) removeSongs(list)
      },
    })
  } else if (kind === 'playlist') {
    items.push({
      label: '导出为 m3u',
      icon: 'export',
      onClick: () => exportM3U(list.map((s) => s.bvid)),
    })
  } else if (kind === 'group') {
    items.push({ label: '导出为 m3u', icon: 'export', onClick: () => exportM3U(list.map((s) => s.bvid)) })
  }

  return items
}

function playAll(list) {
  if (!Array.isArray(list) || !list.length) return
  void playSong(list[0], list)
}

// ---------- 标签编辑 ----------

/** 打开标签编辑弹窗。用 event 通知宿主，避免菜单模块直接持有 DOM */
function openMetaEditor(song) {
  state.metaEditor = { song: { ...song } }
}

export function closeMetaEditor() {
  state.metaEditor = null
}

/** 由弹窗组件调用：提交编辑结果 */
export async function submitMetaEditor(song, patch) {
  const ok = await saveMeta(song, patch)
  if (ok) state.metaEditor = null
}

// ---------- 文件位置 ----------

function showInFolder(song) {
  if (!song?.path) return
  // 桌面端有桥就调原生「在文件夹中显示」，浏览器里退化成复制路径
  if (window.desktop?.showItemInFolder) {
    void window.desktop.showItemInFolder(song.path)
    return
  }
  void navigator.clipboard?.writeText(song.path).then(
    () => ElMessage.success('已复制文件路径'),
    () => ElMessage.info(song.path)
  )
}

// ---------- B 站页面 ----------

function openBilibili(song) {
  const bvid = String(song?.bvid || '').replace(/^local-/, '')
  if (!bvid) return
  const url = `https://www.bilibili.com/video/${bvid}`
  if (window.desktop?.openExternal) void window.desktop.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

// ---------- 图标 ----------

/** 菜单图标用的 SVG 路径，跟 icons.js 保持一致风格 */
export const MENU_ICONS = {
  play: '<path d="M6 4.5 19 12 6 19.5Z"/>',
  pause: '<path d="M7 5v14M17 5v14"/>',
  next: '<path d="m5 5 7 7-7 7"/><path d="M12 5l7 7-7 7"/>',
  'add-queue': '<path d="M12 5v14M6 12h12"/>',
  star: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 5.9L12 16.6 6.7 19.3l1.2-5.9L3.4 9.3l6-.7Z"/>',
  'star-filled': '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 5.9L12 16.6 6.7 19.3l1.2-5.9L3.4 9.3l6-.7Z" fill="currentColor"/>',
  playlist: '<path d="M4 6h13M4 12h13M4 18h7"/><circle cx="20" cy="17" r="2.4"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  trash: '<path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  export: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
}

/** 时长格式化：给菜单副标题用 */
export function songHint(song) {
  const parts = []
  if (song?.duration) parts.push(song.duration)
  if (song?.format) parts.push(song.format.toUpperCase())
  if (song?.bitrate) parts.push(`${song.bitrate}kbps`)
  if (song?.sizeText) parts.push(song.sizeText)
  return parts.join(' · ')
}

/** 给菜单项用的展示名 */
export function menuTitle(song) {
  return `${song?.title || ''}${song?.author ? ` — ${song.author}` : ''}`
}
