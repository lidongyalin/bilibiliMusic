import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

/**
 * 本地音频文件的标签与时长解析。零依赖——不引 ffmpeg 也不引 ID3 库。
 *
 * 支持：MP3（ID3v1/v2.2/v2.3/v2.4 + Xing/Info 帧头）、FLAC、M4A/MP4/M4B、
 * OGG Vorbis / Opus、WAV。每种格式都尽量给出精确时长；MP3 在既无 Xing 头
 * 也读不出 TBP 时退回逐帧扫描（正确处理 VBR），最后才退回文件体积估算。
 *
 * 一次 readFile 读整个文件，从同一个 Buffer 里取标签、封面和时长。
 * 封面不写回索引（一张 500KB 的 JPEG 会让 library.json 迅速膨胀），
 * 由 library.js 在内存里按需缓存，/api/local/cover 直接吐字节。
 */

const AUDIO_EXT = new Set([
  '.mp3', '.flac', '.m4a', '.m4b', '.aac', '.mp4',
  '.ogg', '.opus', '.wav', '.webm',
]);

/** 扫描时跳过明显不是音乐的文件（截屏录屏、空壳文件） */
export const MAX_SCAN_BYTES = 200 * 1024 * 1024;

export function isAudioFile(name) {
  const i = name.lastIndexOf('.');
  return i > 0 && AUDIO_EXT.has(name.slice(i).toLowerCase());
}

export function formatOf(name) {
  const e = extname(name);
  return e ? e.slice(1).toLowerCase() : '';
}

// ---------- 小工具 ----------

/** 交换 16 位字节序：Buffer 只有 utf16le，没有 utf16be */
function swap16(buf) {
  const len = buf.length - (buf.length % 2);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i + 1 < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

/**
 * ID3v2 文本帧解码。enc 是帧体第一个字节：
 * 0 = ISO-8859-1，1 = UTF-16(带 BOM)，2 = UTF-16BE，3 = UTF-8。
 */
function decodeTagText(buf, enc) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end -= 1;
  if (end === 0) return '';
  const b = buf.subarray(0, end);
  // 显式 BOM 优先于 enc 字节，很多工具写错 enc
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return b.toString('utf16le', 2);
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return swap16(b.subarray(2)).toString('utf16le');
  }
  switch (enc) {
    case 0x00: return b.toString('latin1');
    case 0x01: return b.toString('utf16le');
    case 0x02: return swap16(b).toString('utf16le');
    default: return b.toString('utf8');
  }
}

/** ID3v2.2/v2.3/v2.4 的同步安全整数 */
function synchsafe(buf, off) {
  return (
    ((buf[off] & 0x7f) << 21) |
    ((buf[off + 1] & 0x7f) << 14) |
    ((buf[off + 2] & 0x7f) << 7) |
    (buf[off + 3] & 0x7f)
  );
}

function readCStr(buf, off, end) {
  for (let i = off; i < end; i += 1) {
    if (buf[i] === 0) return buf.toString('utf8', off, i);
  }
  return buf.toString('utf8', off, end);
}

function cleanTag(s) {
  return String(s == null ? '' : s)
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- MP3 ----------

const MP3_BITRATES = {
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0], // 2.5 同 2
};

const MP3_SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  1: [22050, 24000, 16000],
};

/** MPEG version 字段：3=MPEG1, 2=MPEG2, 1=MPEG2.5（0 是保留值） */
const MP3_SAMPLES_PER_FRAME = { 3: 1152, 2: 576, 1: 576 };

function parseID3(buf) {
  if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'ID3') {
    return { tags: null, end: 0 };
  }
  const major = buf[3];
  const totalSize = synchsafe(buf, 6);
  const end = Math.min(10 + totalSize, buf.length);
  const tags = {
    title: '', artist: '', album: '', albumArtist: '',
    year: '', track: '', genre: '', picture: null, durationSec: 0,
  };

  let off = 10;
  // v2.4 的扩展头占额外空间，跳过
  if (major === 4 && (buf[5] & 0x40)) {
    off += 4 + synchsafe(buf, 6);
  }

  const is22 = major === 2;
  const idLen = is22 ? 3 : 4;

  while (off + 6 <= end) {
    const id = buf.toString('ascii', off, off + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;

    let fsize;
    if (is22) {
      fsize = (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5];
    } else {
      fsize = major === 4 ? synchsafe(buf, off + 4) : buf.readUInt32BE(off + 4);
    }
    if (!Number.isFinite(fsize) || fsize <= 0) break;

    const bodyStart = is22 ? off + 6 : off + 10;
    const bodyEnd = Math.min(bodyStart + fsize, end);
    if (bodyEnd > end) break;

    readID3Frame(tags, id, buf, bodyStart, bodyEnd);
    off = bodyEnd;
  }

  return { tags, end: is22 && buf[9] & 0x10 ? end : end };
}

/** 单个 ID3v2 帧。v2.2 的帧名是 3 位，语义与 v2.3/v2.4 对应 */
function readID3Frame(tags, id, buf, start, end) {
  const text = (f) => {
    if (start >= end) return '';
    const enc = buf[start];
    return cleanTag(decodeTagText(buf.subarray(start + 1, end), enc));
  };

  switch (id) {
    case 'TIT2': case 'TT2': tags.title = text(); break;
    case 'TPE1': case 'TP1': tags.artist = text(); break;
    case 'TPE2': tags.albumArtist = text(); break;
    case 'TALB': case 'TAL': tags.album = text(); break;
    case 'TDRC': case 'TYER': case 'TYE': tags.year = text(); break;
    case 'TRCK': case 'TRK': tags.track = text(); break;
    case 'TCON': case 'TCO': tags.genre = text(); break;
    // 极罕见，但有工具会写。TBP=比特率、TSOT=总时长（秒）
    case 'TSOT': tags.durationSec = Number(text()) || 0; break;
    case 'APIC': readAPIC(tags, buf, start, end); break;
    case 'PIC': readPIC(tags, buf, start, end); break;
    default: break;
  }
}

function readAPIC(tags, buf, start, end) {
  try {
    let p = start;
    if (p >= end) return;
    const enc = buf[p]; p += 1;
    let mimeEnd = p;
    while (mimeEnd < end && buf[mimeEnd] !== 0) mimeEnd += 1;
    const mime = buf.toString('utf8', p, mimeEnd);
    p = mimeEnd + 1;
    if (p + 1 > end) return;
    p += 1; // picture type
    let descEnd = p;
    while (descEnd < end && buf[descEnd] !== 0) descEnd += 1;
    p = descEnd + 1;
    if (p >= end) return;
    tags.picture = { mime: mime || 'image/jpeg', data: buf.subarray(p, end).slice() };
  } catch { /* 格式异常的封面帧直接丢弃 */ }
}

/** v2.2 的 PIC 帧：类型 + 描述(null 终止) + 图片 */
function readPIC(tags, buf, start, end) {
  try {
    let p = start + 1; // skip type
    let descEnd = p;
    while (descEnd < end && buf[descEnd] !== 0) descEnd += 1;
    p = descEnd + 1;
    if (p >= end) return;
    tags.picture = { mime: 'image/jpeg', data: buf.subarray(p, end).slice() };
  } catch { /* ignore */ }
}

/** ID3v1 是最后的兜底：写标签的老工具只留这个 */
function parseID3v1(buf) {
  if (buf.length < 128) return null;
  const t = buf.subarray(buf.length - 128);
  if (t.toString('ascii', 0, 3) !== 'TAG') return null;
  const read = (a, b) => t.toString('latin1', a, b).replace(/\0.*$/g, '').trim();
  return {
    title: read(3, 33),
    artist: read(33, 63),
    album: read(63, 93),
    year: read(93, 97),
    picture: null,
  };
}

/**
 * MPEG 帧头的位位置（ISO 11172-3）：
 *   byte1: [同步续 3][版本 2][层 2][保护 1][保留 1]
 *   byte2: [比特率 4][采样率 2][填充 1][私有 1]
 *   byte3: [声道模式 2][模式扩展 2][模式扩展 2][版权 1][原始 1]
 * 声道模式只影响 side info 的长度（单声道 17 字节 / 立体声 32 字节），
 * 所以它必须从 byte3 读，读错字节会让 Xing 定位整体偏移。
 */
/** Xing/Info 头：VBR 文件里最可靠的时长来源 */
function parseXing(buf, start) {
  if (start + 64 > buf.length) return 0;
  if (buf[start] !== 0xff) return 0;
  const ver = (buf[start + 1] >> 3) & 3;
  if (!MP3_BITRATES[ver]) return 0;
  const layer = (buf[start + 1] >> 1) & 3;
  if (layer !== 0) return 0; // 只看 Layer III
  const channels = ((buf[start + 3] >> 6) & 3) === 3 ? 1 : 2;
  const srIdx = (buf[start + 2] >> 2) & 3;
  const brIdx = (buf[start + 2] >> 4) & 15;
  const sampleRate = MP3_SAMPLE_RATES[ver][srIdx];
  const bitrate = MP3_BITRATES[ver][brIdx];
  if (!sampleRate || !bitrate) return 0;

  const markerOff = start + 4 + (channels === 1 ? 17 : 32);
  const marker = buf.toString('ascii', markerOff, markerOff + 4);
  if (marker !== 'Xing' && marker !== 'Info') return 0;

  const flags = buf.readUInt32BE(markerOff + 4);
  if (!(flags & 0x10)) return 0; // 没有 VBR 帧计数字段
  const frames = buf.readUInt32BE(markerOff + 8);
  if (!frames) return 0;

  const samplesPerFrame = MP3_SAMPLES_PER_FRAME[ver] || 1152;
  return (frames * samplesPerFrame) / sampleRate;
}

/**
 * 逐帧扫描。既没有 Xing 也没有 TBP 时用——正确处理 VBR。
 * 按帧长跳而不是逐字节找同步，大文件也很快。
 */
function scanMP3(buf, start) {
  let off = start;
  let totalSamples = 0;
  let sampleRate = 44100;
  let frames = 0;
  let bad = 0;

  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff || (buf[off + 1] & 0xe0) !== 0xe0) {
      // 找下一个同步字头
      let n = off + 1;
      while (n + 4 <= buf.length && buf[n] !== 0xff) n += 1;
      off = n;
      bad += 1;
      if (bad > 300) break;
      continue;
    }
    const ver = (buf[off + 1] >> 3) & 3;
    const layer = (buf[off + 1] >> 1) & 3;
    const brIdx = (buf[off + 2] >> 4) & 15;
    const srIdx = (buf[off + 2] >> 2) & 3;
    const padding = (buf[off + 2] >> 1) & 1;

    if (!MP3_BITRATES[ver] || layer !== 0 || brIdx === 0 || brIdx === 15) {
      off += 1; bad += 1; if (bad > 300) break; continue;
    }
    const sr = MP3_SAMPLE_RATES[ver][srIdx];
    const br = MP3_BITRATES[ver][brIdx];
    if (!sr || !br) { off += 1; bad += 1; if (bad > 300) break; continue; }

    const samplesPerFrame = MP3_SAMPLES_PER_FRAME[ver] || 1152;
    const bitsPerFrame = (ver === 3 ? 144000 : 72000) * br * 1000;
    const frameLen = Math.floor(bitsPerFrame / sr) + padding;
    if (frameLen < 4) { off += 1; bad += 1; if (bad > 300) break; continue; }

    totalSamples += samplesPerFrame;
    sampleRate = sr;
    frames += 1;
    bad = 0;
    off += frameLen;
  }

  return frames > 4 ? totalSamples / sampleRate : 0;
}

function parseMP3(buf) {
  const { tags: id3, end: id3End } = parseID3(buf);
  let mediaStart = id3End;

  // ID3v2 前面偶尔会有 TXXX 之类的额外头；这里保守地以 tag 结束为准
  const tags = id3 ? {
    title: id3.title, artist: id3.artist, album: id3.album,
    albumArtist: id3.albumArtist, year: id3.year, track: id3.track,
    genre: id3.genre, picture: id3.picture, durationSec: id3.durationSec,
  } : { title: '', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', picture: null, durationSec: 0 };

  let duration = tags.durationSec || 0;
  if (!duration) duration = parseXing(buf, mediaStart);
  if (!duration) duration = scanMP3(buf, mediaStart);
  if (!duration && buf.length > 0) {
    // 最后的估算：按 Xing 头的标称比特率折算。只有前面全读不出来才用
    if (mediaStart + 4 <= buf.length && buf[mediaStart] === 0xff) {
      const ver = (buf[mediaStart + 1] >> 3) & 3;
      const brIdx = (buf[mediaStart + 2] >> 4) & 15;
      const br = MP3_BITRATES[ver]?.[brIdx] || 192;
      duration = buf.length / (br * 1000 / 8);
    }
  }

  return { ...tags, durationSec: round(duration), mediaStart };
}

// ---------- FLAC ----------

function readU32LE(b, o) { return b.readUInt32LE(o); }

function parseFLAC(buf) {
  const tags = { title: '', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', picture: null, durationSec: 0 };
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'fLaC') return tags;

  let off = 4;
  while (off + 4 <= buf.length) {
    const hdr = buf[off];
    const isLast = (hdr & 0x80) !== 0;
    const type = hdr & 0x7f;
    const size = ((buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
    const bodyStart = off + 4;
    const bodyEnd = Math.min(bodyStart + size, buf.length);
    if (bodyStart > buf.length) break;

    if (type === 0) {
      // STREAMINFO：布局是 4+4+3+3 字节头，然后 8 字节 packed
      // （采样率 20 位 | 通道数-1 3 位 | 位深-1 5 位 | 总采样数 36 位），最后 16 字节 MD5
      if (bodyEnd - bodyStart >= 34) {
        const top = buf.readUInt32BE(bodyStart + 14);
        const bottom = buf.readUInt32BE(bodyStart + 18);
        const sampleRate = (top >>> 12) & 0xfffff;
        // 总采样数占 36 位：低 32 位全在 bottom，高 4 位是 top 的最低 4 位
        const totalSamples = Number(
          (BigInt(top & 0xf) << 32n) | BigInt(bottom)
        );
        if (sampleRate && totalSamples) tags.durationSec = totalSamples / sampleRate;
      }
    } else if (type === 4) {
      // VORBIS_COMMENT
      let p = bodyStart;
      const readComment = () => {
        if (p + 4 > bodyEnd) return null;
        const n = readU32LE(buf, p); p += 4;
        if (p + n > bodyEnd) return null;
        const s = buf.toString('utf8', p, p + n); p += n;
        return s;
      };
      readComment(); // vendor string
      let count = 0;
      if (p + 4 <= bodyEnd) { count = readU32LE(buf, p); p += 4; }
      for (let i = 0; i < count && p + 4 <= bodyEnd; i += 1) {
        const line = readComment();
        if (line == null) break;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const k = line.slice(0, eq).toUpperCase();
        const v = cleanTag(line.slice(eq + 1));
        if (!v) continue;
        switch (k) {
          case 'TITLE': tags.title = tags.title || v; break;
          case 'ARTIST': tags.artist = tags.artist || v; break;
          case 'ALBUM': tags.album = tags.album || v; break;
          case 'ALBUMARTIST': tags.albumArtist = tags.albumArtist || v; break;
          case 'DATE': tags.year = tags.year || v; break;
          case 'TRACKNUMBER': tags.track = tags.track || v.split('/')[0]; break;
          case 'GENRE': tags.genre = tags.genre || v; break;
          default: break;
        }
      }
    } else if (type === 6) {
      // PICTURE
      try {
        const p = bodyStart;
        if (bodyEnd - p < 32) continue;
        const mimeLen = readU32LE(buf, p + 24);
        const mime = buf.toString('utf8', p + 28, p + 28 + mimeLen);
        const dataStart = p + 28 + mimeLen;
        tags.picture = { mime: mime || 'image/jpeg', data: buf.subarray(dataStart, bodyEnd).slice() };
      } catch { /* ignore */ }
    }

    off = bodyEnd;
    if (isLast) break;
  }

  return { ...tags, durationSec: round(tags.durationSec), mediaStart: off };
}

// ---------- MP4 / M4A ----------

/**
 * MP4 是嵌套的 box 结构。这里只需要找三样东西：
 * moov/mvhd（时长）、moov/ilst（文本标签与封面）、moov/udta/meta/ilst（同上）。
 */
function parseMP4(buf) {
  const tags = { title: '', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', picture: null, durationSec: 0 };

  const walk = (start, end) => {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      let header = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        const hi = buf.readUInt32BE(p + 8);
        const lo = buf.readUInt32BE(p + 12);
        size = hi * 0x100000000 + lo;
        header = 16;
      } else if (size === 0) {
        size = end - p; // 到文件尾
      }
      if (!Number.isFinite(size) || size < header || p + size > end) break;

      // meta box 的 header 之后多 4 字节 version/flags
      const bodyStart = type === 'meta' ? p + header + 4 : p + header;
      readMP4Box(tags, type, buf, bodyStart, p + size);
      if (type === 'moov' || type === 'trak' || type === 'udta' || type === 'meta' || type === 'ilst') {
        walk(bodyStart, p + size);
      }
      p += size;
    }
  };

  walk(0, buf.length);
  return { ...tags, durationSec: round(tags.durationSec), mediaStart: 0 };
}

function readMP4Box(tags, type, buf, start, end) {
  if (start >= end) return;

  if (type === 'mvhd') {
    const ver = buf[start];
    const p = start + 4; // version + flags
    let timescale, duration;
    if (ver === 1) {
      if (p + 20 > end) return;
      timescale = buf.readUInt32BE(p + 16);
      duration = Number(buf.readBigUInt64BE(p + 20));
    } else {
      if (p + 8 > end) return;
      timescale = buf.readUInt32BE(p + 8);
      duration = buf.readUInt32BE(p + 12);
    }
    if (timescale) tags.durationSec = duration / timescale;
    return;
  }

  if (type === 'covr') {
    readMP4Data(tags, buf, start, end, (payload, kind) => {
      // kind 13 = JPEG，14 = PNG。少数文件标错，退回到 JPEG 由浏览器嗅探
      tags.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: payload };
    });
    return;
  }

  // 文本标签：©nam / ©ART / ©alb / aART / ©day / trkn / ©gen
  const TEXT_KEYS = {
    '©nam': 'title', '©ART': 'artist', 'aART': 'albumArtist',
    '©alb': 'album', '©day': 'year', '©gen': 'genre', 'trkn': 'track',
  };
  if (TEXT_KEYS[type]) readMP4Data(tags, buf, start, end, (payload) => {
    const v = cleanTag(payload.toString('utf8'));
    if (!v) return;
    if (type === 'trkn') tags.track = tags.track || v.split('/')[0];
    else if (!tags[TEXT_KEYS[type]]) tags[TEXT_KEYS[type]] = v;
  });
}

/** data box：flags 的低 8 位决定 payload 编码（1/2 = 文本，13/14 = 图片） */
function readMP4Data(tags, buf, start, end, onData) {
  let p = start;
  // 有些工具把 data box 写在 ilst 里嵌套一层
  while (p + 8 <= end) {
    const size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const boxEnd = p + Math.min(size, end - p);
    if (type === 'data' && boxEnd > p + 12) {
      const flags = buf.readUInt32BE(p + 8);
      // data type 在 flags 的低 8 位（1/2 = 文本，13/14 = JPEG/PNG）。
      // 少数工具把类型写在高字节，或者把 protected 位 OR 进来，两个位置都试一遍
      let kind = flags & 0xff;
      if (!(kind === 1 || kind === 2 || kind === 13 || kind === 14)) {
        const top = (flags >>> 24) & 0xff;
        if (top === 1 || top === 2 || top === 13 || top === 14) kind = top;
      }
      const body = buf.subarray(p + 12, boxEnd);
      if (kind === 1 || kind === 2) {
        // 文本按偶数字节截断：UTF-16 有半个字符时会解成乱码
        const trimmed = body.subarray(0, body.length - (body.length % 2));
        const text = kind === 2 ? swap16(trimmed).toString('utf16le') : body.toString('utf8');
        onData(text);
      } else if (kind === 13 || kind === 14) {
        // 图片一个字节都不能丢，按原样交出去
        onData(body.slice(), kind);
      }
      return;
    }
    p = boxEnd;
    if (size <= 8) break;
  }
}

// ---------- OGG (Vorbis / Opus) ----------

function parseOGG(buf) {
  const tags = { title: '', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', picture: null, durationSec: 0 };
  let sampleRate = 0;

  let off = 0;
  while (off + 27 <= buf.length) {
    if (buf.toString('ascii', off, off + 4) !== 'OggS') {
      const n = buf.indexOf(0x4f, off + 1); // 'O'
      if (n < 0) break;
      off = n;
      continue;
    }
    const numSegs = buf[off + 26];
    const segTableStart = off + 27;
    const segTableEnd = segTableStart + numSegs;
    if (segTableEnd > buf.length) break;

    // 段表 → 包边界。lacing value 255 表示包继续到下一段
    const packets = [];
    let curStart = segTableEnd;
    let curLen = 0;
    let packetStart = curStart;
    for (let i = 0; i < numSegs; i += 1) {
      const v = buf[segTableStart + i];
      curStart += v;
      curLen += v;
      if (v === 255) continue;
      packets.push([packetStart, curLen]);
      packetStart = curStart;
      curLen = 0;
    }
    if (curLen > 0) packets.push([packetStart, curLen]);

    for (const [pStart, pLen] of packets) {
      if (pLen < 4 || pStart + pLen > buf.length) continue;

      // 识别头：\x01vorbis 或 \x01OpusHead
      if (pLen >= 7 && buf[pStart] === 0x01 && buf.toString('ascii', pStart + 1, pStart + 7) === 'vorbis') {
        // 布局：1 标记 + 6 名字 + 4 版本 + 1 通道 + 4 采样率
        if (pLen >= 16) sampleRate = buf.readUInt32LE(pStart + 12);
      } else if (pLen >= 9 && buf[pStart] === 0x01 && buf.toString('ascii', pStart + 1, pStart + 9) === 'OpusHead') {
        sampleRate = 48000; // Opus 的 granule 恒为 48kHz
      } else if (pLen >= 7 && buf[pStart] === 0x03 && buf.toString('ascii', pStart + 1, pStart + 7) === 'vorbis') {
        // 评论头：1 标记 + 6 名字 + vendorLen + vendor + count + [len + 文本]*
        let p = pStart + 7;
        const readComment = () => {
          if (p + 4 > pStart + pLen) return null;
          const n = buf.readUInt32LE(p);
          p += 4;
          if (p + n > pStart + pLen) return null;
          const s = buf.toString('utf8', p, p + n);
          p += n;
          return s;
        };
        readComment(); // vendor string
        let count = 0;
        if (p + 4 <= pStart + pLen) count = buf.readUInt32LE(p);
        p += 4;
        for (let i = 0; i < count; i += 1) {
          const line = readComment();
          if (line == null) break;
          const eq = line.indexOf('=');
          if (eq < 0) continue;
          const k = line.slice(0, eq).toUpperCase();
          const v = cleanTag(line.slice(eq + 1));
          if (!v) continue;
          if (k === 'TITLE' && !tags.title) tags.title = v;
          else if (k === 'ARTIST' && !tags.artist) tags.artist = v;
          else if (k === 'ALBUM' && !tags.album) tags.album = v;
          else if (k === 'DATE' && !tags.year) tags.year = v;
          else if (k === 'TRACKNUMBER' && !tags.track) tags.track = v.split('/')[0];
          else if (k === 'GENRE' && !tags.genre) tags.genre = v;
        }
      } else if (pLen >= 16 && buf.toString('ascii', pStart, pStart + 4) === 'last') {
        // 「last」标记包：granule 位置就是整条流的总采样数
        const granule = Number(buf.readBigUInt64LE(pStart + 8));
        if (sampleRate && granule > 0) tags.durationSec = granule / sampleRate;
      }
    }

    // 页标志在偏移 5（偏移 2 还在 'OggS' 捕获模式里）
    const isLast = (buf[off + 5] & 0x02) !== 0;
    off += (curStart - off);
    if (isLast) break;
  }

  return { ...tags, durationSec: round(tags.durationSec), mediaStart: 0 };
}

// ---------- WAV ----------

function parseWAV(buf) {
  const tags = { title: '', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', picture: null, durationSec: 0 };
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return tags;

  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const bodyStart = p + 8;
    const bodyEnd = Math.min(bodyStart + size, buf.length);

    if (id === 'fmt ' && bodyEnd - bodyStart >= 16) {
      const channels = buf.readUInt16LE(bodyStart + 2);
      const sampleRate = buf.readUInt32LE(bodyStart + 4);
      const byteRate = buf.readUInt32LE(bodyStart + 8);
      const dataSize = tags._dataSize || 0;
      if (byteRate) tags.durationSec = dataSize / byteRate;
      else if (sampleRate && channels) {
        const bps = buf.readUInt16LE(bodyStart + 14);
        tags.durationSec = (dataSize * 8) / (sampleRate * channels * (bps || 16));
      }
    } else if (id === 'data') {
      tags._dataSize = size;
      if (!tags.durationSec) {
        // 顺序异常时先记下，等 fmt 后再算
      }
    }
    p = bodyEnd + (size % 2); // chunk 按偶数字节对齐
  }

  // fmt 出现在 data 之前的正常顺序：上面已经算好；
  // data 在前时补算一次
  if (!tags.durationSec) {
    const sr = buf.readUInt32LE(24);
    const br = buf.readUInt32LE(28);
    if (tags._dataSize && br) tags.durationSec = tags._dataSize / br;
  }

  return { ...tags, durationSec: round(tags.durationSec), mediaStart: 0 };
}

function round(v) {
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
}

// ---------- 入口 ----------

/**
 * 读取一个本地音频文件的标签与时长。
 * 返回 { tags, format, mediaStart }；tags.picture 只在内存里存活。
 */
export async function readAudioInfo(filePath) {
  const buf = await readFile(filePath);
  const format = formatOf(basename(filePath));

  let parsed;
  switch (format) {
    case 'mp3': parsed = parseMP3(buf); break;
    case 'flac': parsed = parseFLAC(buf); break;
    case 'ogg':
    case 'opus': parsed = parseOGG(buf); break;
    case 'wav': parsed = parseWAV(buf); break;
    default: parsed = parseMP4(buf); break;
  }

  // MP3 标签全空时再看 ID3v1
  if (format === 'mp3' && !parsed.title && !parsed.artist) {
    const v1 = parseID3v1(buf);
    if (v1) {
      if (!parsed.title) parsed.title = v1.title;
      if (!parsed.artist) parsed.artist = v1.artist;
      if (!parsed.album) parsed.album = v1.album;
      if (!parsed.year) parsed.year = v1.year;
      if (!parsed.picture && v1.picture) parsed.picture = v1.picture;
    }
  }

  return { tags: parsed, format };
}
