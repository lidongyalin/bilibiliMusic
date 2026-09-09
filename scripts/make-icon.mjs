/**
 * 生成应用图标（B 站小电视），零依赖、可离线重跑。
 * 跑法：node scripts/make-icon.mjs
 *
 * 不引 sharp/canvas/ImageMagick 的原因：这些包体积大且要下二进制，
 * 而图标只需要几十种图形的抗锯齿填充。用有向距离场（SDF）直接算
 * 覆盖率比超采样更干净，也省去 4 倍的算力。
 *
 * 输出：
 *   build/icon.ico  Windows（≤48px 用经典 32bpp DIB，64px+ 用 PNG 压缩，两者兼容）
 *   build/icon.png  Linux 桌面项用的 512×512
 *   build/icon.icns macOS
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build')

// B 站品牌色
const BLUE = [0, 174, 236]
const WHITE = [255, 255, 255]

// ---------- 矢量定义（100×100 设计空间） ----------

// 小电视：蓝色圆角方块底，白色机身 + 两根向外撇的天线，眼睛挖空透出底色。
// 顺序即绘制顺序（后画的盖前面的）。
const LAYERS = [
  {
    name: 'background',
    box: [3, 3, 94, 94],
    color: BLUE,
    d: (x, y) => sdRoundedRect(x, y, 50, 50, 47, 47, 21),
  },
  {
    name: 'antenna-left',
    box: [17, 9, 40, 61],
    color: WHITE,
    d: (x, y) => sdCapsule(x, y, 33, 56, 22, 14, 3.4),
  },
  {
    name: 'antenna-right',
    box: [60, 9, 83, 61],
    color: WHITE,
    d: (x, y) => sdCapsule(x, y, 67, 56, 78, 14, 3.4),
  },
  {
    name: 'body',
    box: [10, 45, 90, 93],
    color: WHITE,
    d: (x, y) => sdRoundedRect(x, y, 50, 69, 37, 21, 13),
  },
  {
    name: 'eye-left',
    box: [30, 58, 45, 74],
    color: BLUE,
    d: (x, y) => sdCircle(x, y, 37.5, 66, 6),
  },
  {
    name: 'eye-right',
    box: [55, 58, 70, 74],
    color: BLUE,
    d: (x, y) => sdCircle(x, y, 62.5, 66, 6),
  },
]

function sdRoundedRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r)
  const qy = Math.abs(py - cy) - (hy - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

function sdCapsule(px, py, ax, ay, bx, by, r) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const lenSq = vx * vx + vy * vy
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0
  return Math.hypot(wx - t * vx, wy - t * vy) - r
}

/**
 * 渲染成 RGBA 像素数组。
 * d < 0 在形状内部；覆盖范围跨 1px，边界即抗锯齿，不需要超采样。
 */
function render(size) {
  const s = size / 100
  const px = new Float32Array(size * size * 4)

  for (const layer of LAYERS) {
    const [bx0, by0, bx1, by1] = layer.box
    const x0 = Math.max(0, Math.floor(bx0 * s - 2))
    const y0 = Math.max(0, Math.floor(by0 * s - 2))
    const x1 = Math.min(size - 1, Math.ceil(bx1 * s + 2))
    const y1 = Math.min(size - 1, Math.ceil(by1 * s + 2))
    const [cr, cg, cb] = layer.color

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
      const cov = Math.max(0, Math.min(1, 0.5 - layer.d((x + 0.5) / s, (y + 0.5) / s)))
      if (cov <= 0) continue
      const o = (y * size + x) * 4
      // 画家算法：每层覆盖下面 cov 的比例。注意不能用 cov*(1-alpha) 做门控——
      // 背景铺满后 alpha 就是 1，后面所有层都会被乘成 0，白色机身画不出来。
      px[o] += (cr - px[o]) * cov
      px[o + 1] += (cg - px[o + 1]) * cov
      px[o + 2] += (cb - px[o + 2]) * cov
      px[o + 3] += (1 - px[o + 3]) * cov
      }
    }
  }

  // 注意：缓冲里 RGB 是 0..255，alpha 是 0..1，量化时不能一视同仁
  const out = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    out[o] = Math.round(px[o])
    out[o + 1] = Math.round(px[o + 1])
    out[o + 2] = Math.round(px[o + 2])
    out[o + 3] = Math.round(px[o + 3] * 255)
  }
  return out
}

const pixel = (rgba, size, x, y) => {
  const o = (y * size + x) * 4
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]
}

/** 精确采样自检：每个关键特征点必须落在预期颜色上，画错位置/颜色能立刻报出来。 */
function verify(rgba, size) {
  const s = size / 100
  const checks = [
    ['圆角外透明', [0, 0], (p) => p[3] < 8],
    // 取样点要避开天线与机身：(20,20) 正好压在左天线上
    ['背景内为品牌蓝', [8, 42], (p) => near(p, BLUE, 6)],
    ['机身白色', [50, 86], (p) => near(p, WHITE, 6)],
    ['左眼挖空成蓝', [37.5, 66], (p) => near(p, BLUE, 6)],
    ['右眼挖空成蓝', [62.5, 66], (p) => near(p, BLUE, 6)],
    ['左天线白色', [27, 35], (p) => near(p, WHITE, 6)],
    ['右天线白色', [73, 35], (p) => near(p, WHITE, 6)],
  ]
  return checks
    .filter(([, [dx, dy], ok]) => !ok(pixel(rgba, size, clampI(Math.round(dx * s), size), clampI(Math.round(dy * s), size))))
    .map(([label]) => label)
}

/**
 * 小尺寸自检。天线宽 3.4 设计单位，在 16px 下不到 1px，抗锯齿必然把它和底色
 * 混在一起，这是图标的固有行为不是缺陷，所以小尺寸只做存在性检查。
 */
function coarseCheck(rgba, size) {
  const out = []
  if (pixel(rgba, size, 0, 0)[3] >= 8) out.push('圆角外未透明')
  let blue = 0
  let white = 0
  let opaque = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue
    opaque++
    if (rgba[i] < 60 && rgba[i + 1] > 140 && rgba[i + 2] > 200) blue++
    if (rgba[i] > 200 && rgba[i + 1] > 200 && rgba[i + 2] > 200) white++
  }
  if (!blue) out.push('缺品牌蓝像素')
  if (!white) out.push('缺白色像素')
  if (opaque / (size * size) < 0.5) out.push('有效像素过少')
  return out
}

function clampI(n, size) {
  return Math.max(0, Math.min(size - 1, n))
}

function near(p, c, tol) {
  return p[3] > 240 && Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol
}

/** 没有截图能力时用来肉眼确认图形对不对：按亮度打成 ASCII。 */
function preview(rgba, size, cols = 40) {
  // 终端字符宽高比约 2:1，行数控在列数一半才能看出正方形的比例
  const rows = Math.round(cols * 0.5)
  const chars = ' .:-=+*#%@'
  const lines = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      let lum = 0
      let n = 0
      const bx = Math.floor((c / cols) * size)
      const by = Math.floor((r / rows) * size)
      const ex = Math.max(bx + 1, Math.floor(((c + 1) / cols) * size))
      const ey = Math.max(by + 1, Math.floor(((r + 1) / rows) * size))
      for (let y = by; y < ey && y < size; y++) {
        for (let x = bx; x < ex && x < size; x++) {
          const o = (y * size + x) * 4
          if (rgba[o + 3] < 128) continue
          lum += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]
          n++
        }
      }
      line += n === 0 ? ' ' : chars[Math.min(chars.length - 1, Math.floor((lum / n / 255) * chars.length))]
    }
    lines.push(line)
  }
  return lines.join('\n')
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), out.length - 4)
  return out
}

function encodePng(size, rgba) {
  const stride = size * 4 + 1
  // 每行前置一个 filter 字节（恒用 0 = None），这是 PNG 规范要求的原始扫描线格式
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    const row = y * stride
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      raw[row + 1 + x * 4] = rgba[i]
      raw[row + 2 + x * 4] = rgba[i + 1]
      raw[row + 3 + x * 4] = rgba[i + 2]
      raw[row + 4 + x * 4] = rgba[i + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型：RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 反向解码 PNG 并与源像素逐字节比对，证明块结构、CRC 和编码都正确。 */
function decodePng(buf, expectSize, expectRgba) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PNG 签名不对')
  let pos = 8
  let width = 0
  let height = 0
  const idats = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (buf.readUInt32BE(pos + 8 + len) !== crc32(buf.subarray(pos + 4, pos + 8 + len))) {
      throw new Error(`PNG ${type} 块 CRC 不符`)
    }
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error(`IHDR 位深/颜色类型不对：${data[8]}/${data[9]}`)
    } else if (type === 'IDAT') idats.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idats))
  const stride = width * 4 + 1
  const out = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error(`不支持的 filter：${raw[y * stride]}`)
    raw.copy(out, y * width * 4, y * stride + 1, (y + 1) * stride)
  }
  if (width !== expectSize || height !== expectSize) throw new Error(`PNG 尺寸不对：${width}×${height}`)
  if (Buffer.compare(out, Buffer.from(expectRgba)) !== 0) throw new Error(`${expectSize}×${expectSize} PNG 往返不一致`)
}

// ---------- ICO ----------

/** 经典 32bpp DIB，老一点的图标读取器只认这个格式 */
function encodeBmpIcon(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeUInt32LE(size, 4)
  header.writeUInt32LE(size * 2, 8) // XOR + AND 两张位图
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // DIB 行序自下而上
      const s = ((size - 1 - y) * size + x) * 4
      const d = (y * size + x) * 4
      xor[d] = rgba[s + 2] // B
      xor[d + 1] = rgba[s + 1] // G
      xor[d + 2] = rgba[s] // R
      xor[d + 3] = rgba[s + 3] // A
    }
  }
  // AND 掩码行补齐到 32 位；全 0 表示完全不透明，透明交给 alpha 通道
  const andStride = Math.ceil(size / 32) * 4
  return Buffer.concat([header, xor, Buffer.alloc(andStride * size)])
}

function encodeIco(images) {
  const count = images.length
  const dir = Buffer.alloc(6 + count * 16)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(count, 4)
  let offset = dir.length
  for (let i = 0; i < count; i++) {
    const { size, data } = images[i]
    const at = 6 + i * 16
    // 0 表示 256，因为该字段是单字节
    const w = size >= 256 ? 0 : size
    dir.writeUInt8(w, at)
    dir.writeUInt8(w, at + 1)
    dir.writeUInt8(0, at + 2)
    dir.writeUInt8(0, at + 3)
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += data.length
  }
  return Buffer.concat([dir, ...images.map((i) => i.data)])
}

// ---------- ICNS ----------

const ICNS_SIZES = [
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]

function encodeIcns(pngs) {
  const chunks = pngs.map(({ type, data }) => {
    const chunk = Buffer.alloc(data.length + 8)
    chunk.write(type, 0, 'ascii')
    chunk.writeUInt32BE(data.length + 8, 4)
    data.copy(chunk, 8)
    return chunk
  })
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// ---------- 主流程 ----------

mkdirSync(OUT, { recursive: true })

// ICO：小尺寸用 DIB（兼容老读取器），大尺寸用 PNG（体积更小）
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]

const cache = new Map()
function rgbaFor(size) {
  if (!cache.has(size)) {
    const rgba = render(size)
    const bad = size >= 64 ? verify(rgba, size) : coarseCheck(rgba, size)
    if (bad.length) throw new Error(`${size}×${size} 自检失败：${bad.join('、')}`)
    cache.set(size, rgba)
  }
  return cache.get(size)
}

function pngFor(size) {
  const buf = encodePng(size, rgbaFor(size))
  decodePng(buf, size, rgbaFor(size))
  return buf
}

/** 校验 ICO 目录结构与每条数据，避免偏移量算错导致 Windows 读不出来 */
function checkIco(buf, expectSizes) {
  if (buf.readUInt16LE(0) !== 0) throw new Error('ICO reserved 不为 0')
  if (buf.readUInt16LE(2) !== 1) throw new Error('ICO type 不为 1')
  const count = buf.readUInt16LE(4)
  if (count !== expectSizes.length) throw new Error(`ICO 条目数不对：${count}`)
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16
    const w = buf.readUInt8(at) || 256
    const h = buf.readUInt8(at + 1) || 256
    if (buf.readUInt16LE(at + 4) !== 1 || buf.readUInt16LE(at + 6) !== 32) {
      throw new Error(`ICO 第 ${i} 条 planes/bpp 不对`)
    }
    if (w !== h || w !== expectSizes[i]) throw new Error(`ICO 第 ${i} 条尺寸不对：${w}×${h}`)
    const off = buf.readUInt32LE(at + 12)
    const size = buf.readUInt32LE(at + 8)
    if (off + size > buf.length) throw new Error(`ICO 第 ${i} 条数据越界`)
    if (w >= 64) decodePng(buf.subarray(off, off + size), w, rgbaFor(w))
  }
}

const icoBuf = encodeIco(
  ICON_SIZES.map((size) => ({
    size,
    data: size < 64 ? encodeBmpIcon(size, rgbaFor(size)) : pngFor(size),
  }))
)
checkIco(icoBuf, ICON_SIZES)
writeFileSync(join(OUT, 'icon.ico'), icoBuf)

writeFileSync(join(OUT, 'icon.png'), pngFor(512))

writeFileSync(
  join(OUT, 'icon.icns'),
  encodeIcns(ICNS_SIZES.map(([type, size]) => ({ type, data: pngFor(size) })))
)

const files = ['icon.ico', 'icon.png', 'icon.icns']
  .map((n) => `${n} ${(statSync(join(OUT, n)).size / 1024).toFixed(1)}KB`)
  .join('，')
console.log(`图标已生成到 build/：${files}`)
console.log(`ICO 含 ${ICON_SIZES.join('/')}px，ICNS 含 ${ICNS_SIZES.map(([, s]) => s).join('/')}px`)
console.log('\nASCII 预览（.png 可另存查看真实效果）：')
console.log(preview(rgbaFor(256), 256))
