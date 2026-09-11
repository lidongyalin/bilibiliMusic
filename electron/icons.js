import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 缩略图工具栏（F20）需要上一首/播放/暂停/下一首四个单色图标。
 *
 * 不打包成资源、也不走 createFromBuffer：main.js 里有一条实测记录——
 * 这个环境里 createFromBuffer 和 createFromDataURL 对 PNG/ICO/BMP/GIF 全部返回
 * 空图，PNG 配 createFromPath 同样解不出来，只有 ICO + createFromPath 读真磁盘
 * 文件这条路是通的。所以这里把图标画成 ICO 写到临时目录，再交给 createFromPath。
 *
 * ICO 用 DIB（32bpp BGRA + 1bpp 透明度蒙版）而不是 PNG 压缩条目：这个版本的
 * Chromium 拒绝 PNG 压缩的 ICO，实测 createFromPath 返回空图；DIB 是最老也最稳的格式。
 */

/**
 * 16×16 字符画 → size×size 的 RGBA 缓冲（行优先，第一行是顶部）。
 * '#' 是不透明像素，其余透明。最近邻放大，形状保持锐利。
 */
export function rasterize(art, size, rgb = [255, 255, 255]) {
  const n = art.length;
  const out = Buffer.alloc(size * size * 4);
  const factor = size / n;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sy = Math.min(n - 1, Math.floor(y / factor));
      const sx = Math.min(n - 1, Math.floor(x / factor));
      if (art[sy][sx] === '#') {
        const o = (y * size + x) * 4;
        out[o] = rgb[0];
        out[o + 1] = rgb[1];
        out[o + 2] = rgb[2];
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** ICO 全部字段是小端。这里踩过一次坑：按 PNG 的大端习惯写出来，Chromium 一律拒收成空图 */
function encodeIco(width, height, rgba) {
  const rowBytes = width * 4;
  const xorSize = rowBytes * height;
  const andRowBytes = Math.ceil(width / 8);
  const andRowPadded = Math.ceil(andRowBytes / 4) * 4;
  const andSize = andRowPadded * height;

  // ICONDIR
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // ICONDIR
  dir.writeUInt16LE(1, 4);

  // ICONDIRENTRY：4 个字节位 + 2 个 WORD + 2 个 DWORD，共 16 字节
  const entry = Buffer.alloc(16);
  entry[0] = width > 255 ? 0 : width;
  entry[1] = height > 255 ? 0 : height;
  entry[2] = 0;   // bColorCount
  entry[3] = 0;   // bReserved
  entry.writeUInt16LE(1, 4);  // wPlanes
  entry.writeUInt16LE(32, 6); // wBitCount
  entry.writeUInt32LE(40 + xorSize + andSize, 8);
  entry.writeUInt32LE(22, 12);

  // BITMAPINFOHEADER
  const bmp = Buffer.alloc(40);
  bmp.writeUInt32LE(40, 0);
  bmp.writeInt32LE(width, 4);
  bmp.writeInt32LE(height * 2, 8); // XOR + AND 两块
  bmp.writeUInt16LE(1, 12);
  bmp.writeUInt16LE(32, 14);
  bmp.writeUInt32LE(0, 16); // BI_RGB
  bmp.writeUInt32LE(0, 20); // sizeImage，BI_RGB 允许留 0
  bmp.writeInt32LE(0, 24);
  bmp.writeInt32LE(0, 28);
  bmp.writeUInt32LE(0, 32);
  bmp.writeUInt32LE(0, 36);

  // XOR 位图：BGRA，自底向上（DIB 约定）
  const xor = Buffer.alloc(xorSize);
  for (let y = 0; y < height; y += 1) {
    const s = y * rowBytes;
    const d = (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const so = s + x * 4;
      const do_ = d + x * 4;
      xor[do_] = rgba[so + 2];   // B
      xor[do_ + 1] = rgba[so + 1]; // G
      xor[do_ + 2] = rgba[so];   // R
      xor[do_ + 3] = rgba[so + 3]; // A
    }
  }

  // AND 蒙版：全 0 = 完全依赖 Alpha 通道
  return Buffer.concat([dir, entry, bmp, xor, Buffer.alloc(andSize)]);
}

/** 把字符画写成 ICO 文件，返回绝对路径 */
export function writeIcon(dir, name, art, rgb = [255, 255, 255]) {
  const size = 32;
  const path = join(dir, `${name}.ico`);
  writeFileSync(path, encodeIco(size, size, rasterize(art, size, rgb)));
  return path;
}

export const GLYPHS = {
  prev: [
    '................',
    '................',
    '..#............#',
    '..#...........##',
    '..#..........###',
    '..#.........####',
    '..#........#####',
    '..#.......######',
    '..#.......######',
    '..#........#####',
    '..#.........####',
    '..#..........###',
    '..#...........##',
    '..#............#',
    '................',
    '................',
  ],
  play: [
    '................',
    '................',
    '...#............',
    '...##...........',
    '...###..........',
    '...####.........',
    '...#####........',
    '...######.......',
    '...######.......',
    '...#####........',
    '...####.........',
    '...###..........',
    '...##...........',
    '...#............',
    '................',
    '................',
  ],
  pause: [
    '................',
    '................',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '....###...###...',
    '................',
    '................',
  ],
  next: [
    '................',
    '................',
    '..#..........#..',
    '..##.........#..',
    '..###........#..',
    '..####.......#..',
    '..#####......#..',
    '..######.....#..',
    '..######.....#..',
    '..#####......#..',
    '..####.......#..',
    '..###........#..',
    '..##.........#..',
    '..#..........#..',
    '................',
    '................',
  ],
};

/** 自检：解回 ICO 结构，确认每个字节都落在预期位置，像素能还原 */
export function selfTest() {
  const art = GLYPHS.play;
  const size = 32;
  const rgba = rasterize(art, size, [255, 255, 255]);
  const ico = encodeIco(size, size, rgba);
  const xorSize = size * size * 4;
  const andSize = Math.ceil(Math.ceil(size / 8) / 4) * 4 * size;
  const problems = [];
  const check = (label, cond) => { if (!cond) problems.push(label); };

  check('总长', ico.length === 22 + 40 + xorSize + andSize);
  check('idType', ico.readUInt16LE(2) === 1);
  check('idCount', ico.readUInt16LE(4) === 1);
  check('宽高 32', ico[6] === 32 && ico[7] === 32);
  check('wPlanes=1', ico.readUInt16LE(10) === 1);
  check('wBitCount=32', ico.readUInt16LE(12) === 32);
  check('dwBytesInRes', ico.readUInt32LE(14) === 40 + xorSize + andSize);
  check('dwImageOffset=22', ico.readUInt32LE(18) === 22);

  const hdr = 22;
  check('biSize=40', ico.readUInt32LE(hdr) === 40);
  check('biWidth', ico.readInt32LE(hdr + 4) === size);
  check('biHeight=2x', ico.readInt32LE(hdr + 8) === size * 2);
  check('biPlanes', ico.readUInt16LE(hdr + 12) === 1);
  check('biBitCount', ico.readUInt16LE(hdr + 14) === 32);
  check('BI_RGB', ico.readUInt32LE(hdr + 16) === 0);
  check('sizeImage=0', ico.readUInt32LE(hdr + 20) === 0);

  const xorAt = hdr + 40;
  check('AND 蒙版全 0', ico.subarray(ico.length - andSize).every((b) => b === 0));

  // 把 XOR 块解回 RGBA，跟原始 rasterize 结果比
  const back = Buffer.alloc(xorSize);
  const rowBytes = size * 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = xorAt + (size - 1 - y) * rowBytes + x * 4;
      const s = (y * size + x) * 4;
      back[s] = ico[d + 2];
      back[s + 1] = ico[d + 1];
      back[s + 2] = ico[d];
      back[s + 3] = ico[d + 3];
    }
  }
  check('像素可还原', back.equals(rgba));

  for (const [name, g] of Object.entries(GLYPHS)) {
    check(`${name} 16 行`, g.length === 16);
    for (let i = 0; i < g.length; i += 1) check(`${name} 第 ${i} 行 16 列`, g[i].length === 16);
  }

  return problems;
}
