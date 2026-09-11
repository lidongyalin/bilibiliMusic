import { ElMessage } from 'element-plus'
import { api } from './api.js'
import { prefs } from './prefs.js'
import { state } from './state.js'
import { MODE_LABELS } from './icons.js'
import { clip } from './utils.js'
import {
  attach as attachEngine, resume as resumeEngine, applyEq, setMasterGain, setBalance,
  setNormGain, sampleRms,
} from './audio-engine.js'
import {
  MIN_BLOCKS, SAMPLE_INTERVAL_MS, createLoudnessStore, normGainDb, rmsToDb,
} from './loudness.js'

/**
 * 播放控制器。用 new Audio() 而不是 DOM 里的 <audio>，
 * 避免与 Vue 的 DOM 管理互相干扰。
 */

let audio = null
let pendingResume = 0
let saveTimer = 0
let lastErrorMsg = ''

// 播放失败的自动恢复状态：失败先原地重试一次，仍失败就切下一首，
// 连续失败过多则停下——否则断网时会自动把整个队列高速过完
let consecutiveFailures = 0
let retryTarget = null
let retryTimer = 0
const MAX_CONSECUTIVE_FAILURES = 3
const RETRY_DELAY_MS = 1200

// 睡眠定时的计时器句柄（淡出参数在下面的「睡眠定时」小节里）
let sleepTimer = 0

// 音量均衡（F26）：当前这首的 RMS 采样。块数够 MIN_BLOCKS 才落库，
// 落库间隔用节流控制，别每首歌都写一次 localStorage
const loudness = createLoudnessStore(
  () => prefs.getLoudnessMap(),
  (m) => prefs.setLoudnessMap(m)
)
let normBlocks = []
let normLastSample = 0
let normSaved = false

// 无缝播放：提前用第二个 Audio 元素把下一首的请求发出去，
// 真正切换时数据已经在浏览器缓存里，交接空档从「一次网络往返」缩到「一次解码」
let preloaded = null

function getAudio() {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'metadata'
    audio.volume = state.volume
    audio.muted = state.muted
    // 接均衡器/增益/声道平衡这条链。不支持 Web Audio 的环境返回 false，
    // 此时 <audio> 保持直连播放，声音不受影响。
    attachEngine(audio)
    // 恢复上次保存的音效：链刚建好时所有 gain 都是 0，不补一次就会
    // 出现「打开面板调了 EQ，第一次播放却听不出来」
    applyEq(state.eq)
    setMasterGain(state.masterGain)
    setBalance(state.balance)
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
    tickSleepTimer()
    tickLoudness()
    // 离结尾 30 秒时开始预取下一首，让交接尽量无感
    if (state.duration - a.currentTime < 30) preloadNext()
  })

  a.addEventListener('playing', () => {
    state.status = 'playing'
    setPlaybackState('playing')
    clearErrorFlag()
    resetFailureState()
    // AudioContext 可能在非手势里创建后被挂起，出声前再试一次恢复
    void resumeEngine()
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
    // 「播完当前曲后停止」：自然播完就停在这里，不往下切
    if (state.sleepAfterCurrent) {
      state.sleepAfterCurrent = false
      state.status = 'paused'
      setPlaybackState('paused')
      saveNow()
      ElMessage({ message: '已播完当前曲目，播放停止', type: 'success', duration: 2400 })
      return
    }
    next(true)
  })

  a.addEventListener('error', onPlaybackError)
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

// ---------- 播放失败自动恢复 ----------

function resetFailureState() {
  consecutiveFailures = 0
  retryTarget = null
}

/** 连续失败过多，停止自动切换 */
function stopAutoSkip() {
  state.status = 'error'
  setPlaybackState('none')
  resetFailureState()
  showError(
    `连续 ${MAX_CONSECUTIVE_FAILURES} 首播放失败，已停止自动切换。` +
    '常见原因：网络异常或 CDN 限流，也可能这些曲目是付费/受限内容'
  )
}

/** 原地重播当前曲目 */
function scheduleRetry(song) {
  state.status = 'loading'
  setPlaybackState('none')
  retryTimer = setTimeout(() => {
    retryTimer = 0
    // 期间用户可能已经切走，别覆盖用户的选择
    if (state.current !== song) return
    void playAt(state.queueIndex)
  }, RETRY_DELAY_MS)
}

/**
 * 播放失败：先原地重试一次，仍失败就切下一首，连续失败过多则停下。
 *
 * 先重试而不是直接跳过，是因为上游最常见的失败（CDN 限流、音轨地址过期）是暂时的，
 * 后端在失败时已经清掉音轨地址缓存，重试会重新解析出一个新地址。
 */
function onPlaybackError() {
  const song = state.current
  if (!song || !audio) return
  // 1（ABORTED）是我们自己切歌打断产生的，不算失败
  if (audio.error?.code === 1) return
  // 已经在正常播放时收到的 error 是旧资源遗留的事件，此时 state.current 已是新歌，
  // 按它处理会打断正在播放的曲目
  // 注意不能用 audio.paused 判断：加载失败时元素处于「无媒体」状态，paused 返回 false
  if (state.status === 'playing') return
  // 已有重试在排队时忽略，避免同一次失败被计两次
  if (retryTimer) return

  // 单曲循环是用户明确的选择，不切歌，只原地重试
  if (state.mode === 'single') {
    if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return stopAutoSkip()
    return scheduleRetry(song)
  }

  if (retryTarget !== song.bvid) {
    retryTarget = song.bvid
    return scheduleRetry(song)
  }

  if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return stopAutoSkip()
  ElMessage({
    message: `「${clip(song.title)}」播放失败，已切到下一首`,
    type: 'warning',
    duration: 2400,
  })
  next()
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
  // 「播完当前曲后停止」跟着上一首走：用户主动切歌就是新意图
  if (state.sleepAfterCurrent) state.sleepAfterCurrent = false
  pendingResume = prefs.getPosition(song.bvid) || 0
  clearErrorFlag()

  const a = getAudio()
  applySpeed(a)
  normBeginTrack(song)
  try { a.currentTime = 0 } catch { /* ignore */ }
  a.src = api.streamUrl(song.bvid)
  a.load()
  updateMetadata()

  // 上报播放历史（智能歌单靠它算「最近播放 / 最常播放」）。
  // 失败静默——历史记录不应该影响播放
  void api.recordPlay(song)

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
  preloadNext()
}

export async function togglePlay() {
  if (!state.current) return
  // 失败后按播放键要重新发起加载，只调 a.play() 不会重新请求。
  // 必须放在 !a.paused 判断之前：加载失败时元素处于「无媒体」状态，paused 返回 false，
  // 会被误判为正在播放而走成 pause()
  if (state.status === 'error') {
    resetFailureState()
    void playAt(state.queueIndex)
    return
  }
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

// ---------- 倍速 ----------

/** 允许的倍速档位 */
export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function applySpeed(a) {
  if (a) a.playbackRate = state.speed
}

/** 设置倍速。非法值回落 1.0，不报错——调用方一般来自下拉选择 */
export function setSpeed(v) {
  const n = Number(v)
  state.speed = SPEED_OPTIONS.includes(n) ? n : 1
  prefs.setSpeed(state.speed)
  applySpeed(getAudio())
  return state.speed
}

/** 上一档 / 下一档。返回 -1 / 0 / 1 表示方向，0 是到头了 */
export function stepSpeed(dir = 1) {
  const i = SPEED_OPTIONS.indexOf(state.speed)
  const next = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, (i < 0 ? 2 : i) + dir))
  setSpeed(SPEED_OPTIONS[next])
  return next === i ? 0 : dir
}

/** 倍速展示文案：1 显示「原速」 */
export function speedLabel(v = state.speed) {
  return Number(v) === 1 ? '原速' : `${v}×`
}

// ---------- 播放队列 ----------

/** 本地曲库曲目。bvid 是 local-<id>，和 B 站 vid 走不同的代理路由 */
export function isLocalSong(song) {
  return String(song?.bvid || '').startsWith('local-')
}

function dedupe(songs, extra) {
  const have = new Set(state.queue.map((s) => s.bvid))
  for (const s of Array.isArray(extra) ? extra : []) if (s?.bvid) have.add(s.bvid)
  return songs.filter((s) => s?.bvid && !have.has(s.bvid))
}

/** 追加到队列末尾，不去播放 */
export function addToQueue(songs) {
  const add = dedupe(Array.isArray(songs) ? songs : [])
  if (!add.length) return 0
  state.queue = [...state.queue, ...add]
  return add.length
}

/** 插到当前曲目的后面。传多首时保持相对顺序 */
export function playNext(songs) {
  const add = dedupe(Array.isArray(songs) ? songs : [])
  if (!add.length) return 0
  const at = Math.min(state.queueIndex + 1, state.queue.length)
  state.queue = [...state.queue.slice(0, at), ...add, ...state.queue.slice(at)]
  return add.length
}

/** 从队列移除一首（用 bvid）。当前曲目被移除时自动接上邻居 */
export function removeFromQueue(bvid) {
  const i = state.queue.findIndex((s) => s.bvid === bvid)
  if (i < 0) return false
  const cur = state.current
  state.queue = state.queue.filter((s) => s.bvid !== bvid)
  if (cur && cur.bvid === bvid) {
    if (!state.queue.length) {
      state.queueIndex = -1
      state.current = null
      state.status = 'idle'
      state.progress = 0
      state.duration = 0
      try { if (audio) { audio.pause(); audio.removeAttribute('src') } } catch { /* ignore */ }
    } else {
      void playAt(Math.min(i, state.queue.length - 1))
    }
  } else if (i < state.queueIndex) {
    state.queueIndex -= 1
  }
  return true
}

/** 清空队列，保留当前曲目 */
export function clearQueue() {
  if (!state.current) {
    state.queue = []
    state.queueIndex = -1
    return
  }
  state.queue = [state.current]
  state.queueIndex = 0
}

/** 拖动重排：把 from 位置的曲目移到 to 位置 */
export function moveInQueue(from, to) {
  if (from === to) return
  if (from < 0 || from >= state.queue.length || to < 0 || to >= state.queue.length) return
  const next = state.queue.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  state.queue = next
  const cur = state.current
  if (cur) {
    const ni = next.findIndex((s) => s.bvid === cur.bvid)
    if (ni >= 0) state.queueIndex = ni
  }
}

/** 当前队列里第 index 首的歌 */
export function queueSong(index) {
  return state.queue[index] || null
}

// ---------- 睡眠定时 ----------

/** 可选的定时档位（分钟）。0 表示「立即停止」，不进这个列表 */
export const SLEEP_OPTIONS = [15, 30, 45, 60, 90, 120]

/** 到点前先淡出多少秒：硬切太突兀 */
const SLEEP_FADE_SEC = 20
const FLOOR_VOL = 0.01
/** 淡出起点：0 表示还没开始淡出 */
let fadeStart = 0
/** 淡出开始时的音量，之后按比例往地板压 */
let fadeFrom = 0.8

/** 当前剩余秒数 */
export function sleepRemaining() {
  return Math.max(0, Math.ceil((state.sleepEndsAt - Date.now()) / 1000))
}

/** 设置睡眠定时。传 0 关闭 */
export function startSleepTimer(minutes) {
  const n = Math.round(Number(minutes) || 0)
  if (n <= 0) return cancelSleepTimer()
  state.sleepAfterCurrent = false
  state.sleepEndsAt = Date.now() + n * 60000
  state.sleepCountdown = sleepRemaining()
  prefs.setSleepMinutes(n)
  if (!sleepTimer) sleepTimer = setInterval(tickSleepTimer, 250)
  return true
}

/**
 * 「播完当前曲后停止」：不定时刻，等自然播完就停。
 * 和分钟定时互斥——两种意图同时挂着没有意义。
 * 用户手动切歌会清掉它（playAt 里），因为「这首播完就停」跟着那首歌走。
 */
export function startSleepAfterCurrent() {
  cancelSleepTimer()
  state.sleepAfterCurrent = true
  return true
}

export function cancelSleepTimer() {
  state.sleepEndsAt = 0
  state.sleepCountdown = 0
  state.sleepAfterCurrent = false
  fadeStart = 0
  if (sleepTimer) {
    clearInterval(sleepTimer)
    sleepTimer = 0
  }
}

/**
 * 每 tick 检查一次。到点后不是立刻静音，而是把音量从当时的值线性压到地板再暂停——
 * 直接在副歌里硬切太突兀。
 *
 * 暂停状态下也照常推进：用户中途暂停定时不该失效。
 */
function tickSleepTimer() {
  if (!state.sleepEndsAt) return
  const remain = sleepRemaining()
  state.sleepCountdown = remain
  if (remain > 0) return

  const a = audio
  if (!a) return cancelSleepTimer()
  if (!fadeStart) {
    fadeStart = Date.now()
    fadeFrom = state.volume || 0.8
  }
  const t = Math.min(1, (Date.now() - fadeStart) / (SLEEP_FADE_SEC * 1000))
  a.volume = Math.max(FLOOR_VOL, fadeFrom * (1 - t))
  if (t >= 1) {
    const m = state.sleepEndsAt
    cancelSleepTimer()
    a.pause()
    state.status = 'paused'
    setPlaybackState('paused')
    ElMessage({ message: '睡眠定时已到，播放已停止', type: 'success', duration: 2400 })
  }
}

// ---------- 均衡器 / 增益 / 声道平衡 ----------

/** 应用九段 EQ（dB 数组）。返回规整后的值 */
export function setEq(gains) {
  state.eq = applyEq(gains)
  prefs.setEq(state.eq)
  return state.eq
}

/** 总增益（dB），对应「音量均衡/增益」 */
export function setGain(db) {
  state.masterGain = setMasterGain(db)
  prefs.setGain(state.masterGain)
  return state.masterGain
}

/** 声道平衡：-1 全左 / 0 居中 / 1 全右 */
export function setBalanceValue(v) {
  state.balance = setBalance(v)
  prefs.setBalance(state.balance)
  return state.balance
}

/** EQ 与增益全部归零 */
export function resetAudioFx() {
  setEq([0, 0, 0, 0, 0, 0, 0, 0, 0])
  setGain(0)
  setBalanceValue(0)
}

// ---------- 音量均衡（F26）：学习式响度归一 ----------

/**
 * 切到某首时调用：丢掉上一首的采样，套上已学到的补偿。
 * 没学过的这首不补偿——宁可前几秒不齐，也别拿猜的值乱拉。
 */
function normBeginTrack(song) {
  normBlocks = []
  normLastSample = 0
  normSaved = false
  if (!state.normEnabled || !song) {
    setNormGain(0)
    return
  }
  const rms = loudness.get(song.bvid)
  setNormGain(rms ? normGainDb(rms) : 0)
}

/** 播放中采样。挂在 timeupdate 上，浏览器实际回调节奏比 500ms 略密，这里自己节流 */
function tickLoudness() {
  if (!state.normEnabled || !state.current || state.status !== 'playing') return
  const now = Date.now()
  if (now - normLastSample < SAMPLE_INTERVAL_MS) return
  normLastSample = now
  const rms = sampleRms()
  if (rms == null || rms <= 0) return
  normBlocks.push(rms)
  if (normBlocks.length > 600) normBlocks.shift()
  // 采够了就学一次并立刻把补偿套上（首次播放也能在后半段开始起作用）
  if (!normSaved && normBlocks.length >= MIN_BLOCKS) {
    normSaved = true
    const learned = loudness.learn(state.current.bvid, normBlocks)
    if (learned) setNormGain(normGainDb(learned))
  }
}

/** 开关音量均衡。关掉时把补偿归零，已学到的响度数据保留 */
export function setNormEnabled(v) {
  state.normEnabled = Boolean(v)
  prefs.setNormEnabled(state.normEnabled)
  if (!state.normEnabled) {
    setNormGain(0)
    return state.normEnabled
  }
  const rms = state.current ? loudness.get(state.current.bvid) : 0
  setNormGain(rms ? normGainDb(rms) : 0)
  return state.normEnabled
}

/** 忘掉全部学到的响度（设置里的「重新学习」） */
export function clearLoudnessData() {
  loudness.clear()
  setNormGain(0)
  return true
}

/** 当前这首已学到的响度（dBFS），没有返回 null。设置面板展示用 */
export function currentLoudnessDb() {
  if (!state.current) return null
  const rms = loudness.get(state.current.bvid)
  return rms ? rmsToDb(rms) : null
}

/** 已学到响度的歌曲数（设置面板展示用） */
export function loudnessCount() {
  return loudness.size()
}

export function setGapless(v) {
  state.gapless = Boolean(v)
  prefs.setGapless(state.gapless)
  if (!state.gapless) discardPreload()
}

/** 无缝播放：提前把下一首的请求发出去 */
function preloadNext() {
  if (!state.gapless || state.mode === 'single') return
  if (state.queue.length < 2 || !audio) return
  const idx = (state.queueIndex + 1) % state.queue.length
  const song = state.queue[idx]
  if (!song || song.bvid === state.current?.bvid) return
  if (preloaded && preloaded.bvid === song.bvid) return

  discardPreload()
  try {
    const el = new Audio()
    el.preload = 'auto'
    el.src = api.streamUrl(song.bvid)
    el.addEventListener('loadedmetadata', () => { el.pause() }, { once: true })
    // 只发请求、不解析整个文件：abort 掉解码，保留 HTTP 缓存
    el.addEventListener('error', () => discardPreload(), { once: true })
    el.load()
    preloaded = { el, bvid: song.bvid }
  } catch {
    preloaded = null
  }
}

function discardPreload() {
  if (!preloaded) return
  try {
    preloaded.el.pause()
    preloaded.el.removeAttribute('src')
    preloaded.el.load()
  } catch { /* ignore */ }
  preloaded = null
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
