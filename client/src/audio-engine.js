/**
 * Web Audio 处理链：均衡器 + 增益 + 声道平衡 + 频谱分析。
 *
 * 图结构：
 *   <audio> ── MediaElementSource ── [EQ 9 段] ── masterGain ── panner ── destination
 *                                └─────────────────────────────── analyser（旁路，只监听）
 *
 * 几个必须小心的点：
 *
 * 1. MediaElementAudioSourceNode 对同一个 <audio> 元素只能创建一次。
 *    再调一次 createMediaElementSource 会抛 InvalidStateError，
 *    所以 attach() 必须幂等，audio 换了才重建。
 *
 * 2. 一旦接入 createMediaElementSource，这个 <audio> 的出声就不再直接走扬声器，
 *    必须靠我们这条链。所以 init 失败（老浏览器没 AudioContext）要退回
 *    「什么都不做」，让 <audio> 维持原来的直连播放路径，不能把声音弄丢。
 *
 * 3. AudioContext 在非用户手势里创建会被静音锁住（autoplay policy），
 *    需要拿到点击事件时再 resume()。
 *
 * 不引入任何依赖，纯 Web Audio API。
 */

/** 九段均衡器。两端用 shelf（低频架/高频架），中间全用 peaking。 */
export const EQ_BANDS = [
  { freq: 60, type: 'lowshelf' },
  { freq: 120, type: 'peaking' },
  { freq: 250, type: 'peaking' },
  { freq: 500, type: 'peaking' },
  { freq: 1000, type: 'peaking' },
  { freq: 2000, type: 'peaking' },
  { freq: 4000, type: 'peaking' },
  { freq: 8000, type: 'peaking' },
  { freq: 16000, type: 'highshelf' },
]

/** 段位置展示名，跟 EQ_BANDS 一一对应 */
export const EQ_LABELS = ['60', '120', '250', '500', '1k', '2k', '4k', '8k', '16k']

/** 单段增益范围（dB），跟常见播放器的 ±12 一致 */
export const EQ_RANGE = { min: -12, max: 12 }

/** 总增益范围（dB）：±15，超出这个值再拉只会失真 */
export const GAIN_RANGE = { min: -15, max: 15 }

/** 常见预设：值对应 EQ_BANDS 的顺序 */
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [4, 2, 1, -1, -2, 2, 4, 4, 3],
  rock: [5, 4, 2, -1, -1, 2, 4, 5, 4],
  jazz: [3, 2, 1, 1, -1, -1, 2, 3, 3],
  classical: [4, 2, 1, 0, -1, -1, 1, 2, 4],
  vocal: [-2, -1, 0, 1, 3, 4, 3, 1, 0],
  bass: [6, 5, 3, 1, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 1, 2, 4, 5, 6],
}

export const EQ_PRESET_NAMES = {
  flat: '平直',
  pop: '流行',
  rock: '摇滚',
  jazz: '爵士',
  classical: '古典',
  vocal: '人声',
  bass: '低音',
  treble: '高音',
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

let ctx = null
let source = null
let eqNodes = []
let masterGain = null
let panner = null
let analyser = null
let attachedTo = null

function supported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
}

/** 建上下文并 resume。非手势上下文里 resume 会被拒绝，属于正常现象 */
function ensureContext() {
  if (ctx) return ctx
  if (!supported()) return null
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * 把 <audio> 接到处理链上。幂等：同一个元素重复调用不重建。
 * 返回 false 表示环境不支持 Web Audio，此时 <audio> 保持直连播放。
 */
export function attach(audio) {
  if (!audio || !supported()) return false
  if (attachedTo === audio && source && masterGain) return true
  rebuild(audio)
  return attachedTo === audio
}

/** 重新建一条链（audio 元素换了，或者上次建失败） */
function rebuild(audio) {
  try {
    ctx = ensureContext()
    if (!ctx) return
    source = ctx.createMediaElementSource(audio)

    masterGain = ctx.createGain()
    panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8

    eqNodes = EQ_BANDS.map((band) => {
      const node = ctx.createBiquadFilter()
      node.type = band.type
      node.frequency.value = band.freq
      node.Q.value = band.type === 'peaking' ? 0.9 : 1
      node.gain.value = 0
      return node
    })

    // EQ 级联
    for (let i = 0; i < eqNodes.length; i += 1) {
      if (i < eqNodes.length - 1) eqNodes[i].connect(eqNodes[i + 1])
      else eqNodes[i].connect(masterGain)
    }
    source.connect(eqNodes[0])

    // masterGain → panner（或直接出）→ destination
    if (panner) {
      masterGain.connect(panner)
      panner.connect(ctx.destination)
    } else {
      masterGain.connect(ctx.destination)
    }

    // analyser 旁路挂在 EQ 链的输入端
    source.connect(analyser)

    attachedTo = audio
  } catch {
    // 建链失败就退回直连播放，不能因为特效组件挂掉而不出声
    ctx = null
    source = null
    eqNodes = []
    masterGain = null
    panner = null
    analyser = null
    attachedTo = null
  }
}

/** 请求恢复上下文。播放按钮、拖滑杆这类手势里调一次 */
export async function resume() {
  if (ctx && ctx.state === 'suspended') {
    try { await ctx.resume() } catch { /* ignore */ }
  }
}

/**
 * 应用九段增益（dB 数组，长度不足或越界都按平直处理）。
 * 返回规整后的数组，方便调用方回写状态。
 */
export function applyEq(gains) {
  const out = EQ_BANDS.map((_, i) => {
    const raw = Array.isArray(gains) ? gains[i] : 0
    const n = Number(raw)
    return Number.isFinite(n) ? clamp(Math.round(n * 10) / 10, EQ_RANGE.min, EQ_RANGE.max) : 0
  })
  if (!eqNodes.length) return out
  eqNodes.forEach((node, i) => {
    // setTargetAtTime 比直接赋值平滑，避免拖动时爆音
    try {
      node.gain.setTargetAtTime(out[i], ctx.currentTime, 0.02)
    } catch {
      node.gain.value = out[i]
    }
  })
  return out
}

/** 总增益（dB）。0 = 原音量，负数衰减，正数放大 */
export function setMasterGain(db) {
  const n = Number(db)
  const v = Number.isFinite(n) ? clamp(n, GAIN_RANGE.min, GAIN_RANGE.max) : 0
  if (!masterGain) return v
  try {
    masterGain.gain.setTargetAtTime(Math.pow(10, v / 20), ctx.currentTime, 0.03)
  } catch {
    masterGain.gain.value = Math.pow(10, v / 20)
  }
  return v
}

/** 声道平衡：-1 全左，0 居中，1 全右 */
export function setBalance(v) {
  const n = Number(v)
  const out = Number.isFinite(n) ? clamp(n, -1, 1) : 0
  if (panner) {
    try { panner.pan.setTargetAtTime(out, ctx.currentTime, 0.02) }
    catch { panner.pan.value = out }
  }
  return out
}

/** 频谱可视化用的 AnalyserNode；不可用时返回 null，调用方要兜住 */
export function getAnalyser() {
  return analyser
}

/** 是否已建成链（不支持的环境一直是 false） */
export function isReady() {
  return Boolean(source && masterGain && attachedTo)
}

/** 环境是否支持 Web Audio */
export function isSupported() {
  return supported()
}

/** 全部复位：EQ 归零、增益归零、平衡居中 */
export function reset() {
  applyEq(EQ_PRESETS.flat)
  setMasterGain(0)
  setBalance(0)
}
