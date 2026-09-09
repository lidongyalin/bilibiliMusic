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

  // 歌单。playlists 是摘要列表（侧栏用），currentPlaylist 是点开后的完整详情
  playlists: [],
  playlistLoading: false,
  currentPlaylistId: prefs.getLastPlaylist(),
  currentPlaylist: null,
  playlistDetailLoading: false,
  // 歌单内是否已含当前曲目：判断星标要不要显示成「已在歌单」
  // 不单独存 Set，直接按 currentPlaylist.songs 查——量级小，查一次不心疼

  // 多选。selectMode 是「进入多选」这个动作开关；selection 存选中的 bvid
  selectMode: false,
  selection: new Set(),

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

// 歌单视图用 'playlist'，具体是哪个歌单由 currentPlaylistId 决定。
// 存进 localStorage 的 view 是上次离开时的值，回来时直接还原（prefs.getView）。
export const VIEWS = ['search', 'favorites', 'playlist']
