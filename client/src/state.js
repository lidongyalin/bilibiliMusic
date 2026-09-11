import { reactive } from 'vue'
import { prefs } from './prefs.js'
import { EQ_BANDS, EQ_PRESETS } from './audio-engine.js'

/**
 * 全局状态。单例 reactive 对象，组件直接引用；
 * 播放与收藏逻辑放在独立模块里修改它，避免在组件间层层传 props。
 * favoriteIds 用 Set，Vue 3 的 reactive 会追踪集合变更。
 */
export const state = reactive({
  // 视图
  view: prefs.getView(),
  keyword: '',
  lastKeyword: prefs.getLastKeyword(),

  // 搜索
  songs: [],
  page: 0,
  hasMore: false,
  total: 0,
  loading: false,

  // 收藏
  favorites: [],
  favoriteIds: new Set(),
  favoriteCount: 0,
  favLoading: false,

  // 歌单。playlists 是摘要列表（侧栏用），currentPlaylist 是点开后的完整详情
  playlists: [],
  playlistLoading: false,
  currentPlaylistId: prefs.getLastPlaylist(),
  currentPlaylist: null,
  playlistDetailLoading: false,

  // 本地曲库
  library: [],
  libraryFolders: [],
  libraryLoading: false,
  scanProgress: null,   // { running, phase, current, total, added, failed, folder }
  libraryGroups: [],    // 歌手/专辑/目录分组列表
  libraryGroupSongs: [],
  libraryDrill: null,   // { type: 'artist'|'album'|'folder', value: '周杰伦' }
  librarySortKey: prefs.getSortKey(),
  librarySortDir: prefs.getSortDir(),
  libraryFilter: '',

  // 智能歌单 / 播放历史
  smartKind: prefs.getSmartKind(),
  smartSongs: [],
  smartLoading: false,
  historySongs: [],
  historyLoading: false,

  // 多选。selectMode 是「进入多选」这个动作开关；selection 存选中的 bvid
  selectMode: false,
  selection: new Set(),

  // 播放
  queue: [],
  queueIndex: -1,
  current: null,
  mode: prefs.getMode(),
  status: 'idle', // idle | loading | playing | paused | error
  speed: prefs.getSpeed(),
  gapless: prefs.getGapless(),

  // 队列面板
  queueOpen: false,

  // 睡眠定时：sleepEndsAt 是计划停止的时间戳，sleepCountdown 是剩余秒数。
  // sleepAfterCurrent 是另一种定时——不按时间，播完当前这首就停
  sleepEndsAt: 0,
  sleepCountdown: 0,
  sleepAfterCurrent: false,

  // 音量处理：EQ 九段、总增益（dB）、声道平衡、音量均衡（学习式响度归一）
  eq: prefs.getEq().length === EQ_BANDS.length
    ? prefs.getEq().slice()
    : EQ_PRESETS.flat.slice(),
  masterGain: prefs.getGain(),
  balance: prefs.getBalance(),
  normEnabled: prefs.getNormEnabled(),
  eqOpen: false,

  // 播放条显示
  progress: 0,
  duration: 0,
  volume: prefs.getVolume(),
  muted: false,

  // 歌词。lyricStatus: idle | loading | ok | empty
  // lyricOffset 是当前这首歌的校准偏移（秒，可为负）；每首歌切换时从 prefs 取一次
  lyricOpen: prefs.getLyricOpen(),
  lyrics: [],
  lyricStatus: 'idle',
  lyricMatch: null,
  lyricOffset: 0,

  // 沉浸式播放页 + 设置面板
  immersive: false,
  settingsOpen: false,

  // 主题：light / dark / system；accent 是强调色
  theme: prefs.getTheme(),
  accent: prefs.getAccent(),

  // 右键菜单。items 每项 {label, icon, danger, disabled, divider, onClick, children}
  contextMenu: null,   // { x, y, items }
  subMenu: null,       // { index } 当前展开的子菜单
  subMenuPos: { x: 0, y: 0 },

  // 标签编辑弹窗（F10）：null 表示没打开
  metaEditor: null,     // { song }
  // 批量标签编辑（F28）：null 表示没打开，打开时 { count }
  metaBatch: null,

  // 重复检测结果（F15）
  duplicates: [],
})

// 歌单视图用 'playlist'，具体是哪个歌单由 currentPlaylistId 决定。
// 存进 localStorage 的 view 是上次离开时的值，回来时直接还原（prefs.getView）。
export const VIEWS = ['search', 'favorites', 'playlist', 'library', 'smart', 'history']

// 曲库下钻用的分组类型，跟后端 /api/library/groups?type= 对齐
export const LIBRARY_GROUP_TYPES = ['artist', 'album', 'folder', 'year', 'genre']
