import { reactive } from 'vue'
import { prefs } from './prefs.js'

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

  // 播放
  queue: [],
  queueIndex: -1,
  current: null,
  mode: prefs.getMode(),
  status: 'idle', // idle | loading | playing | paused | error

  // 播放条显示
  progress: 0,
  duration: 0,
  volume: prefs.getVolume(),
  muted: false,

  // 歌词。lyricStatus: idle | loading | ok | empty
  lyricOpen: prefs.getLyricOpen(),
  lyrics: [],
  lyricStatus: 'idle',
  lyricMatch: null,
})

export const VIEWS = ['search', 'favorites']
