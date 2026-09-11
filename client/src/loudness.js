/**
 * 音量均衡（F26）：学习式响度归一。
 *
 * 真正的响度归一要整轨解码算 EBU R128 综合响度，本地播放器做不起——
 * 这里用「边播边学」的折中：播放时从 analyser 取 RMS 累计出这首的平均响度，
 * 存下来，下次播到它就直接套补偿增益，让曲与曲之间不再忽大忽小。
 *
 * 取舍（都写在注释里，改之前先看）：
 *   - 每首第一次播没有数据，不补偿；听完一小段之后数据才逐步可信
 *   - 补偿上限 ±12dB：安静的录音室专辑和响度战争时期的流行乐差距很大，
 *     无上限会把安静那首拉到削波失真
 *   - 目标响度取 RMS 0.10（约 -20dBFS），落在常见音乐的中间偏安静一档，
 *     这样多数歌是「往上提一点」而不是「往下压」，动态保留得更好
 *   - 记录按 bvid 存 localStorage，只存一个数字，不存音频、不存歌词
 */

/** 目标 RMS。0.1 ≈ -20 dBFS */
export const TARGET_RMS = 0.1

/** 单首至少要采到这么多块才认。256 采样/块，500ms 采一次 → 约 8 秒 */
export const MIN_BLOCKS = 16

/** 每首最多记多少块：整首都听也只留最近 600 块（5 分钟），避免长时间播放让数字漂移太慢 */
export const MAX_BLOCKS = 600

/** 本地记录最多存多少首，超了按插入顺序丢最旧的 */
const STORE_MAX = 600

/** 两块 RMS 之间的采样间隔（ms）。挂在 timeupdate 上，实际节奏跟随浏览器 */
export const SAMPLE_INTERVAL_MS = 500

/**
 * 一串 RMS 的加权平均。后面的块权重略高——曲子越往后越能代表整体响度，
 * 开头几秒常常是安静的前奏。
 */
export function averageRms(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return 0
  let num = 0
  let den = 0
  for (let i = 0; i < blocks.length; i += 1) {
    const v = Number(blocks[i])
    if (!Number.isFinite(v) || v <= 0) continue
    const w = 1 + i / blocks.length
    num += v * w
    den += w
  }
  return den ? num / den : 0
}

/** RMS → dBFS（RMS 为 0 时返回 -Infinity 的替身 -90） */
export function rmsToDb(rms) {
  const v = Number(rms)
  if (!Number.isFinite(v) || v <= 0) return -90
  return 20 * Math.log10(v)
}

/** 由 RMS 算补偿增益（dB），夹在 ±maxDb */
export function normGainDb(rms, target = TARGET_RMS, maxDb = 12) {
  const v = Number(rms)
  if (!Number.isFinite(v) || v <= 0) return 0
  const raw = 20 * Math.log10(target / v)
  if (!Number.isFinite(raw)) return 0
  return Math.max(-maxDb, Math.min(maxDb, Math.round(raw * 10) / 10))
}

/** 存储结构是否合法（读 localStorage 回来的东西不可信） */
function sanitize(map) {
  if (!map || typeof map !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    if (!k || !v || typeof v !== 'object') continue
    const rms = Number(v.rms)
    if (!Number.isFinite(rms) || rms <= 0 || rms > 2) continue
    out[k] = { rms: Math.round(rms * 10000) / 10000 }
  }
  return out
}

export function createLoudnessStore(read, write) {
  function load() {
    return sanitize(read())
  }
  function save(map) {
    const keys = Object.keys(map)
    if (keys.length > STORE_MAX) {
      for (const k of keys.slice(0, keys.length - STORE_MAX)) delete map[k]
    }
    write(map)
  }
  return {
    /** 已学到的 RMS；没有返回 0 */
    get(bvid) {
      const e = load()[bvid]
      return e ? e.rms : 0
    },
    /** 用一批新采样更新某首的响度。返回更新后的 RMS（0 表示还不够） */
    learn(bvid, blocks) {
      if (!bvid) return 0
      const usable = Array.isArray(blocks) ? blocks.filter((v) => Number.isFinite(v) && v > 0) : []
      if (usable.length < MIN_BLOCKS) return 0
      const map = load()
      const prev = map[bvid]?.rms || 0
      // 已有值时做平滑，别让某一次听得断断续续的结果把旧的可靠值整个冲掉
      const next = prev ? (prev * 0.5 + averageRms(usable) * 0.5) : averageRms(usable)
      const rounded = Math.round(next * 10000) / 10000
      if (!rounded) return 0
      // 触碰即视为最近使用：删掉再插回去，让 LRU 的「最旧」判断成立
      delete map[bvid]
      map[bvid] = { rms: rounded }
      save(map)
      return rounded
    },
    forget(bvid) {
      const map = load()
      if (!map[bvid]) return
      delete map[bvid]
      save(map)
    },
    clear() {
      write({})
    },
    size() {
      return Object.keys(load()).length
    },
  }
}
