import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'
import { switchView, currentView, currentList } from './views.js'


/**
 * 本地曲库：扫描文件夹、分组下钻、排序筛选、元数据编辑、批量移除、
 * 重复检测、m3u 导入导出。
 *
 * 曲目对象和 B 站搜索结果共用同一套字段（title/author/cover/duration/bvid），
 * 本地曲目额外带 path/format/size/bitrate/addedAt，以及一个 local- 前缀的 bvid——
 * 播放器靠这个前缀决定走哪条代理路由。
 */

/** 排序字段 → 展示名 */
export const SORT_OPTIONS = [
  { key: 'title', label: '歌名' },
  { key: 'author', label: '歌手' },
  { key: 'album', label: '专辑' },
  { key: 'year', label: '年份' },
  { key: 'genre', label: '流派' },
  { key: 'durationSec', label: '时长' },
  { key: 'bitrate', label: '比特率' },
  { key: 'addedAt', label: '导入时间' },
]

/** 分组类型 → 展示名 */
export const GROUP_TYPES = [
  { key: 'artist', label: '歌手' },
  { key: 'album', label: '专辑' },
  { key: 'folder', label: '文件夹' },
  { key: 'year', label: '年份' },
  { key: 'genre', label: '流派' },
]

// ---------- 列表 ----------

export async function refreshLibrary() {
  state.libraryLoading = true
  try {
    const { songs, folders } = await api.listLibrary()
    state.library = Array.isArray(songs) ? songs : []
    state.libraryFolders = Array.isArray(folders) ? folders : []
  } catch (err) {
    ElMessage.error(err.message)
  } finally {
    state.libraryLoading = false
  }
}

/** 当前视图应用排序 + 筛选后的列表 */
export function sortedLibrary() {
  let list = state.library.slice()
  const kw = state.libraryFilter.trim().toLowerCase()
  if (kw) {
    list = list.filter((s) =>
      [s.title, s.author, s.album, s.path, s.genre, s.year]
        .some((v) => String(v || '').toLowerCase().includes(kw))
    )
  }
  const key = state.librarySortKey
  const mul = state.librarySortDir === 'desc' ? -1 : 1
  list.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av || '').localeCompare(String(bv || ''), 'zh-Hans-CN') * mul
  })
  return list
}

export function setSort(key) {
  if (state.librarySortKey === key) state.librarySortDir = state.librarySortDir === 'asc' ? 'desc' : 'asc'
  else {
    state.librarySortKey = key
    state.librarySortDir = ['durationSec', 'bitrate', 'addedAt'].includes(key) ? 'desc' : 'asc'
  }
  prefs.setSortKey(state.librarySortKey)
  prefs.setSortDir(state.librarySortDir)
}

export function setLibraryFilter(kw) {
  state.libraryFilter = String(kw || '')
}

// ---------- 扫描 / 修库 ----------

/**
 * 扫描文件夹。浏览器环境拿不到本机路径，此时弹个提示让走桌面端；
 * 桌面端通过 preload 桥给出真实路径。
 */
export async function scanFolder(path) {
  if (!path) {
    ElMessage.info('需要在桌面版里用「添加文件夹」选择目录')
    return false
  }
  state.scanProgress = { running: true, phase: '开始扫描…', current: 0, total: 0 }
  try {
    const res = await api.addFolder(path)
    state.scanProgress = null
    await refreshLibrary()
    if (currentView() === 'library') switchView('library')
    ElMessage.success(`扫描完成：新增 ${res.added} 首，共 ${res.total} 首`)
    return true
  } catch (err) {
    state.scanProgress = null
    ElMessage.error(err.message)
    return false
  }
}

/** 轮询扫描进度。扫描是后台任务，前端定时来问 */
let progressTimer = 0
export function watchScanProgress() {
  if (progressTimer) return
  const poll = async () => {
    try {
      const p = await api.scanProgress()
      state.scanProgress = p
      if (!p.running) {
        stopScanProgress()
        await refreshLibrary()
      }
    } catch { /* 后端重启过就静默 */ }
  }
  void poll()
  progressTimer = setInterval(poll, 1500)
}

export function stopScanProgress() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = 0
  }
  state.scanProgress = null
}

export async function removeFolder(id) {
  try {
    await api.removeFolder(id)
    await refreshLibrary()
    ElMessage.success('已移出曲库（磁盘文件未删除）')
  } catch (err) {
    ElMessage.error(err.message)
  }
}

export async function repairLibrary() {
  state.libraryLoading = true
  try {
    const res = await api.repairLibrary()
    await refreshLibrary()
    const parts = []
    if (res.missing) parts.push(`缺失 ${res.missing} 首`)
    if (res.restored) parts.push(`恢复 ${res.restored} 首`)
    if (res.added) parts.push(`新增 ${res.added} 首`)
    ElMessage.success(`修库完成${parts.length ? '（' + parts.join('，') + '）' : ''}`)
    return res
  } catch (err) {
    ElMessage.error(err.message)
    return null
  } finally {
    state.libraryLoading = false
  }
}

// ---------- 分组下钻（F9） ----------

export async function openGroups(type) {
  try {
    const { groups } = await api.libraryGroups(type)
    state.libraryGroups = Array.isArray(groups) ? groups : []
    return state.libraryGroups
  } catch (err) {
    ElMessage.error(err.message)
    return []
  }
}

/** 点进某个分组：拉出组内曲目，进入 group 视图 */
export async function drillInto(type, key) {
  state.libraryDrill = { type, value: key }
  state.libraryGroupSongs = []
  state.selectMode = false
  state.selection = new Set()
  try {
    const res = await api.libraryGroupSongs(type, key)
    if (state.libraryDrill?.value !== key) return
    state.libraryGroupSongs = Array.isArray(res.songs) ? res.songs : []
  } catch (err) {
    ElMessage.error(err.message)
  }
}

/** 退出下钻，回到曲库列表 */
export function exitDrill() {
  state.libraryDrill = null
  state.libraryGroupSongs = []
}

// ---------- 元数据编辑（F10） ----------

/** 保存本地覆盖。空值表示恢复原标签 */
export async function saveMeta(song, patch) {
  try {
    const { song: updated } = await api.updateLibraryMeta(song.localId || stripLocal(song.bvid), patch)
    state.library = state.library.map((s) => s.bvid === updated.bvid ? updated : s)
    state.libraryGroupSongs = state.libraryGroupSongs.map((s) => s.bvid === updated.bvid ? updated : s)
    ElMessage.success('已更新标签')
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

/** 恢复原标签 */
export async function restoreMeta(song) {
  try {
    const { song: updated } = await api.clearLibraryMeta(song.localId || stripLocal(song.bvid))
    state.library = state.library.map((s) => s.bvid === updated.bvid ? updated : s)
    state.libraryGroupSongs = state.libraryGroupSongs.map((s) => s.bvid === updated.bvid ? updated : s)
    ElMessage.success('已恢复原标签')
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

function stripLocal(bvid) {
  return String(bvid || '').replace(/^local-/, '')
}

/**
 * 批量修正元数据（F28）。一次请求改一批；patch 里留空的字段不动。
 * 后端把选中的每首重算序列化，这里用返回的 updated/missing 提示，
 * 再本地把这几首从曲库列表里重拉一遍（顺序、分组都可能因歌手/专辑变了而变）。
 */
export async function saveMetaBatch(songs, patch) {
  // 本地曲目的 bvid 带 local- 前缀；B 站曲目没有标签可改，直接跳过
  const ids = (Array.isArray(songs) ? songs : [])
    .filter((s) => String(s.bvid || '').startsWith('local-'))
    .map((s) => stripLocal(s.bvid))
    .filter(Boolean)
  if (!ids.length) {
    ElMessage.info('选中的没有本地曲目')
    return false
  }
  try {
    const res = await api.updateLibraryMetaBatch(ids, patch)
    await refreshLibrary()
    if (state.libraryDrill) await drillInto(state.libraryDrill.type, state.libraryDrill.value)
    const skipped = res.skipped ? '（没有可修改的字段）' : ''
    ElMessage.success(`已更新 ${res.updated} 首的标签${res.missing ? `，${res.missing} 首未找到` : ''}${skipped}`)
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

// ---------- 批量移除（F28） ----------

export async function removeSongs(songs) {
  const ids = (Array.isArray(songs) ? songs : []).map((s) => s.bvid).filter(Boolean)
  if (!ids.length) return 0
  try {
    const res = await api.removeLibrarySongs(ids)
    const gone = new Set(ids)
    state.library = state.library.filter((s) => !gone.has(s.bvid))
    state.libraryGroupSongs = state.libraryGroupSongs.filter((s) => !gone.has(s.bvid))
    ElMessage.success(`已移出曲库 ${res.removed} 首（磁盘文件未删除）`)
    return res.removed
  } catch (err) {
    ElMessage.error(err.message)
    return 0
  }
}

// ---------- 重复检测（F15） ----------

export async function findDuplicates() {
  try {
    const { groups } = await api.libraryDuplicates()
    const list = Array.isArray(groups) ? groups : []
    ElMessage.success(list.length ? `发现 ${list.length} 组疑似重复` : '没有发现重复曲目')
    return list
  } catch (err) {
    ElMessage.error(err.message)
    return []
  }
}

// ---------- m3u 导入导出（F14） ----------

/** 导出为 m3u 并触发下载。ids 为空导出全部 */
export function exportM3U(ids = []) {
  const a = document.createElement('a')
  a.href = api.m3uExportUrl(ids)
  a.download = ''
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export async function importM3U(path) {
  if (!path) return false
  try {
    const res = await api.m3uImportPath(path)
    await refreshLibrary()
    ElMessage.success(`导入完成：新增 ${res.added} 首，失败 ${res.failed} 首`)
    return true
  } catch (err) {
    ElMessage.error(err.message)
    return false
  }
}

// ---------- 打开曲库视图 ----------

export async function openLibrary() {
  switchView('library')
  state.libraryDrill = null
  if (!state.library.length) await refreshLibrary()
}

/** 当前列表的总时长文案 */
export function listDurationText(list = currentList()) {
  const total = list.reduce((n, s) => n + (Number(s.durationSec) || 0), 0)
  if (!total) return ''
  const h = Math.floor(total / 3600)
  const m = Math.round((total % 3600) / 60)
  return h ? `${h} 小时 ${m} 分` : `${m} 分钟`
}

/** 当前列表的歌曲数 + 时长，供标题栏显示。
 *  参数是筛选/排序后的列表（SongList 传进来）——之前这里写死用 currentList()，
 *  筛到只剩 1 首时标题栏还挂着「5000 首」，注释里说要避免的正是这个 */
export function listMeta(list = currentList()) {
  const rows = Array.isArray(list) ? list : currentList()
  const dur = listDurationText(rows)
  return rows.length ? `${rows.length} 首${dur ? ` · ${dur}` : ''}` : ''
}
