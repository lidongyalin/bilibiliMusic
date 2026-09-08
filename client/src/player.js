import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'
import { MODE_LABELS } from './icons.js'

/**
 * 播放控制器。用 new Audio() 而不是 DOM 里的 <audio>，
 * 避免与 Vue 的 DOM 管理互相干扰。
 */

let audio = null
let pendingResume = 0
let saveTimer = 0
let lastErrorMsg = ''

function getAudio() {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'metadata'
    audio.volume = state.volume
    audio.muted = state.muted
    bindEvents()
    bindMediaSession()
  }
  return audio
}

function bindEvents() {
  const a = audio

  a.addEventListener('loadedmetadata', () => {
    state.duration = Number.isFinite(a.duration) ? a.duration : 0
    // 续播：切回听过的歌时回到上次位置
    if (pendingResume && pendingResume > 10 && pendingResume < state.duration - 5) {
      try { a.currentTime = pendingResume } catch { /* 某些格式不支持立即定位 */ }
    }
    pendingResume = 0
    updateMetadata()
  })

  a.addEventListener('durationchange', () => {
    state.duration = Number.isFinite(a.duration) ? a.duration : 0
  })

  a.addEventListener('timeupdate', () => {
    state.progress = a.currentTime
    scheduleSave()
  })

  a.addEventListener('playing', () => {
    state.status = 'playing'
    setPlaybackState('playing')
    clearErrorFlag()
  })

  a.addEventListener('waiting', () => {
    if (state.current) state.status = 'loading'
  })

  a.addEventListener('pause', () => {
    if (state.status === 'playing') state.status = 'paused'
    saveNow()
    setPlaybackState('paused')
  })

  a.addEventListener('ended', () => {
    if (state.current) prefs.clearPosition(state.current.bvid)
    next(true)
  })

  a.addEventListener('error', () => {
    if (!state.current || !a.src) return
    const codes = {
      1: '音频加载被中断',
      2: '音频获取失败，请检查网络',
      3: '音频解码失败',
      4: '音频地址失效或内容不可播放',
    }
    state.status = 'error'
    setPlaybackState('none')
    showError(codes[a.error?.code] || '播放失败，可能是付费或受版权限制的内容')
  })
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return
  const nav = navigator.mediaSession
  try {
    nav.setActionHandler('play', () => togglePlay())
    nav.setActionHandler('pause', () => togglePlay())
    nav.setActionHandler('previoustrack', () => prev())
    nav.setActionHandler('nexttrack', () => next())
    nav.setActionHandler('seekto', (d) => {
      if (d.seekTime != null) seekTo(d.seekTime)
    })
  } catch { /* 部分动作在旧浏览器不支持 */ }
}

function updateMetadata() {
  if (!('mediaSession' in navigator) || !state.current) return
  const song = state.current
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.author,
      album: 'B 站音乐播放器',
      artwork: song.cover
        ? [
            { src: song.cover, sizes: '52x52', type: 'image/jpeg' },
            { src: song.cover, sizes: '100x100', type: 'image/jpeg' },
            { src: song.cover, sizes: '250x250', type: 'image/jpeg' },
          ]
        : [],
    })
  } catch { /* ignore */ }
}

function setPlaybackState(v) {
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = v } catch { /* ignore */ }
  }
}

/** 错误提示去重，避免连续失败刷屏 */
function showError(message) {
  if (lastErrorMsg === message) return
  lastErrorMsg = message
  ElMessage.error(message)
  setTimeout(() => { lastErrorMsg = '' }, 5000)
}

function clearErrorFlag() {
  lastErrorMsg = ''
}

function scheduleSave() {
  if (!state.current) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 2000)
}

function saveNow() {
  if (!state.current || !audio) return
  // 尾部 8 秒不算"听过的位置"，避免下次从结尾开始
  if (state.duration > 0 && audio.currentTime < state.duration - 8) {
    prefs.setPosition(state.current.bvid, Math.floor(audio.currentTime))
  }
}

// ---------- 对外 API ----------

/** 播放一首，context 是它所在的列表，会成为播放队列 */
export async function playSong(song, context) {
  if (!song) return
  if (Array.isArray(context) && context.length) state.queue = context.slice()
  const idx = state.queue.findIndex((s) => s.bvid === song.bvid)
  await playAt(idx >= 0 ? idx : 0)
}

export async function playAt(index) {
  if (index < 0 || index >= state.queue.length) return
  const song = state.queue[index]
  if (!song) return

  state.queueIndex = index
  state.current = song
  state.status = 'loading'
  state.progress = 0
  state.duration = 0
  pendingResume = prefs.getPosition(song.bvid) || 0
  clearErrorFlag()

  const a = getAudio()
  try { a.currentTime = 0 } catch { /* ignore */ }
  a.src = api.streamUrl(song.bvid)
  a.load()
  updateMetadata()

  try {
    await a.play()
  } catch (err) {
    if (err?.name === 'AbortError') return // 切歌打断，正常
    if (err?.name === 'NotAllowedError') {
      state.status = 'paused'
      showError('浏览器阻止了自动播放，请点击播放按钮')
      return
    }
  }
  setPlaybackState('paused')
}

export async function togglePlay() {
  if (!state.current) return
  const a = getAudio()
  if (!a.paused) {
    a.pause()
    return
  }
  // 播完后按播放键，从头再来
  if (state.duration > 0 && a.currentTime >= state.duration - 0.6) {
    try { a.currentTime = 0 } catch { /* ignore */ }
  }
  try {
    await a.play()
  } catch (err) {
    if (err?.name !== 'AbortError') showError('播放失败，请重试')
  }
}

function pickRandomIndex(n, exclude) {
  if (n <= 1) return 0
  let idx
  do {
    idx = Math.floor(Math.random() * n)
  } while (idx === exclude)
  return idx
}

export function next(isAuto = false) {
  const n = state.queue.length
  if (!n) return
  let idx
  if (state.mode === 'single') idx = state.queueIndex
  else if (state.mode === 'shuffle') idx = pickRandomIndex(n, state.queueIndex)
  else idx = (state.queueIndex + 1) % n
  void playAt(idx)
}

export function prev() {
  const n = state.queue.length
  if (!n) return
  const a = getAudio()
  // 当前已经听过 3 秒以上时，先回到本曲开头
  if (a.currentTime > 3) {
    try { a.currentTime = 0 } catch { /* ignore */ }
    void a.play().catch(() => {})
    return
  }
  void playAt((state.queueIndex - 1 + n) % n)
}

export function seekTo(sec) {
  if (!state.current || !Number.isFinite(sec)) return
  const a = getAudio()
  sec = Math.max(0, Math.min(sec, state.duration || sec))
  try {
    a.currentTime = sec
    state.progress = sec
  } catch { /* 元数据未就绪时忽略 */ }
}

export function setVolume(v) {
  v = Math.max(0, Math.min(1, Number(v) || 0))
  state.volume = v
  if (v > 0 && state.muted) state.muted = false
  prefs.setVolume(v)
  const a = getAudio()
  a.volume = v
  a.muted = state.muted
}

export function toggleMute() {
  state.muted = !state.muted
  const a = getAudio()
  a.muted = state.muted
}

export function cycleMode() {
  const order = ['list', 'single', 'shuffle']
  state.mode = order[(order.indexOf(state.mode) + 1) % order.length]
  prefs.setMode(state.mode)
  ElMessage({ message: `播放模式：${MODE_LABELS[state.mode]}`, duration: 1400 })
}

export function isPlaying() {
  return state.status === 'playing'
}
