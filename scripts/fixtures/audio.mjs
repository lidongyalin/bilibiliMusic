/**
 * 合成音频文件生成器。只造结构合法的容器头，不产码——
 * 目的是让解析器在真实布局上跑通，不依赖本机音频库或网络。
 */

export function synchsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

export function mp3Header(bitrateIdx = 9, srIdx = 0, channels = 2, padding = 0) {
  const b1 = 0xe0 | (3 << 3) | 0x01;
  // byte2 = 比特率 4 位 | 采样率 2 位 | 填充 1 位；声道模式在 byte3 的高 2 位
  const b2 = (bitrateIdx << 4) | (srIdx << 2) | (padding << 1);
  const b3 = ((channels === 1 ? 3 : 1) << 6);
  return Buffer.from([0xff, b1, b2, b3]);
}

export function mp3FrameLen(bitrateKbps, sr, padding = 0) {
  return Math.floor(144000 * bitrateKbps * 1000 / sr) + padding;
}

/** enc 默认 0x03（UTF-8）。默认用 ISO-8859-1 会让中文标签直接乱码 */
export function id3v23(textFrames, enc = 0x03) {
  const frames = Buffer.concat(textFrames.map(([id, text]) => {
    const body = Buffer.concat([
      Buffer.from([enc]),
      Buffer.from(text, 'utf8'),
      Buffer.from([0]),
    ]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(body.length);
    return Buffer.concat([Buffer.from(id, 'ascii'), size, Buffer.alloc(2), body]);
  }));
  return Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00, 0x00]),
    synchsafe(frames.length),
    frames,
  ]);
}

/** 生成一个 MP3：ID3v2.3 标签 + N 个帧（可带 Xing 头给精确时长） */
export function mp3File({ title = '', artist = '', album = '', year = '', frames = 0, xingFrames = 0, utf16 = false } = {}) {
  const frameBytes = mp3FrameLen(128, 44100, 0);
  const makeFrame = () => {
    const f = Buffer.alloc(frameBytes);
    mp3Header().copy(f, 0);
    if (xingFrames > 0) {
      const xing = Buffer.alloc(12);
      xing.write('Xing', 0, 'ascii');
      xing.writeUInt32BE(0x10, 4);
      xing.writeUInt32BE(xingFrames, 8);
      xing.copy(f, 4 + 32);
    }
    return f;
  };

  let tag;
  if (utf16) {
    const text = Buffer.from(title, 'utf16le');
    const fbody = Buffer.concat([Buffer.from([0x01]), text, Buffer.from([0, 0])]);
    const fsize = Buffer.alloc(4);
    fsize.writeUInt32BE(fbody.length);
    const frameAtom = Buffer.concat([Buffer.from('TIT2', 'ascii'), fsize, Buffer.alloc(2), fbody]);
    tag = Buffer.concat([
      Buffer.from('ID3', 'ascii'),
      Buffer.from([0x03, 0x00, 0x00]),
      synchsafe(frameAtom.length),
      frameAtom,
    ]);
  } else {
    tag = id3v23([
      ['TIT2', title], ['TPE1', artist], ['TALB', album], ['TYER', year],
    ]);
  }

  const n = Math.max(frames, xingFrames > 0 ? 1 : 0);
  return Buffer.concat([tag, ...Array.from({ length: n }, makeFrame)]);
}

export function flacFile({ title = '', artist = '', album = '', durationSec = 1 } = {}) {
  const sampleRate = 44100;
  const totalSamples = Math.round(durationSec * sampleRate);
  const packed = BigInt(sampleRate) << 44n | 1n << 41n | 15n << 36n | BigInt(totalSamples);
  const si = Buffer.alloc(34);
  si.writeUInt32BE(0, 0);
  si.writeUInt32BE(0, 4);
  si.writeUInt32BE(0, 8);
  si.writeUInt32BE(0, 11);
  const big = Buffer.alloc(16);
  big.writeBigUInt64BE(packed, 8);
  big.copy(si, 14, 8, 16);
  const siBlock = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x22]), si]);

  const comment = (s) => {
    const b = Buffer.from(s, 'utf8');
    const n = Buffer.alloc(4);
    n.writeUInt32LE(b.length);
    return Buffer.concat([n, b]);
  };
  const vc = Buffer.concat([
    (() => { const n = Buffer.alloc(4); n.writeUInt32LE(0); return n; })(),
    (() => { const n = Buffer.alloc(4); n.writeUInt32LE(3); return n; })(),
    comment(`TITLE=${title}`),
    comment(`ARTIST=${artist}`),
    comment(`ALBUM=${album}`),
  ]);
  const vcSize = Buffer.alloc(3);
  vcSize.writeUIntBE(vc.length, 0, 3);
  const vcBlock = Buffer.concat([Buffer.from([0x84]), vcSize, vc]);

  return Buffer.concat([Buffer.from('fLaC', 'ascii'), siBlock, vcBlock, Buffer.alloc(200)]);
}

function atom(type, ...children) {
  const payload = Buffer.concat(children);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length + 8);
  return Buffer.concat([size, Buffer.from(type, 'latin1'), payload]);
}

export function m4aFile({ title = '', artist = '', album = '', year = '', durationSec = 1, cover = false, nested = false } = {}) {
  const timescale = 44100;
  const duration = Math.round(durationSec * timescale);
  const mvhd = Buffer.concat([
    Buffer.from([0x00, 0, 0, 0]),
    Buffer.alloc(8),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(timescale); return b; })(),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(duration); return b; })(),
    Buffer.alloc(8),
  ]);
  const dataAtom = (text, type = 1) => {
    const flags = Buffer.alloc(4);
    flags.writeUInt32BE(0x00000001 | type);
    return atom('data', flags, Buffer.from(text, 'utf8'));
  };
  const boxes = [
    atom('©nam', dataAtom(title)),
    atom('©ART', dataAtom(artist)),
    atom('©alb', dataAtom(album)),
    atom('©day', dataAtom(year)),
  ];
  if (cover) {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1]);
    const covrData = Buffer.alloc(4);
    covrData.writeUInt32BE(14);
    boxes.push(atom('covr', atom('data', covrData, png)));
  }
  const ilst = atom('ilst', ...boxes);

  let moov;
  if (nested) {
    // meta box 的 header 后多 4 字节 version/flags
    moov = atom('moov', atom('mvhd', mvhd), atom('udta', atom('meta', Buffer.alloc(4), ilst)));
  } else {
    moov = atom('moov', atom('mvhd', mvhd), ilst);
  }
  return Buffer.concat([atom('ftyp', Buffer.from('M4A ', 'latin1'), Buffer.alloc(4)), moov]);
}

export function oggFile({ title = '', artist = '', durationSec = 1, sampleRate = 44100 } = {}) {
  const ident = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from('vorbis', 'ascii'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(0); return b; })(),
    Buffer.from([2]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(sampleRate); return b; })(),
    Buffer.alloc(4), Buffer.alloc(4), Buffer.from([0, 0]), Buffer.alloc(8), Buffer.alloc(8),
  ]);
  const comment = (s) => {
    const b = Buffer.from(s, 'utf8');
    const n = Buffer.alloc(4);
    n.writeUInt32LE(b.length);
    return Buffer.concat([n, b]);
  };
  const vc = Buffer.concat([
    Buffer.from([0x03]),
    Buffer.from('vorbis', 'ascii'),
    (() => { const n = Buffer.alloc(4); n.writeUInt32LE(0); return n; })(),
    (() => { const n = Buffer.alloc(4); n.writeUInt32LE(2); return n; })(),
    comment(`TITLE=${title}`),
    comment(`ARTIST=${artist}`),
  ]);
  const lastPkt = Buffer.concat([
    Buffer.from('last', 'ascii'),
    Buffer.alloc(4),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(Math.round(durationSec * sampleRate))); return b; })(),
  ]);

  const page = (seq, isLast, granule, packets) => {
    const segs = [];
    for (const p of packets) {
      for (let off = 0; off < p.length; off += 255) {
        const take = Math.min(255, p.length - off);
        segs.push(take);
        if (take < 255) break;
      }
    }
    const head = Buffer.concat([
      Buffer.from('OggS', 'ascii'),
      Buffer.from([0, isLast ? 0x02 : 0x00]),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(granule)); return b; })(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(0x1234); return b; })(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(seq); return b; })(),
      Buffer.alloc(4),
      Buffer.from([segs.length]),
      Buffer.from(segs),
    ]);
    return Buffer.concat([head, ...packets]);
  };

  return Buffer.concat([
    page(0, false, 0, [ident]),
    page(1, false, 0, [vc]),
    page(2, true, Math.round(durationSec * sampleRate), [lastPkt]),
  ]);
}

export function wavFile({ durationSec = 1, sampleRate = 44100 } = {}) {
  const byteRate = sampleRate * 2 * 2;
  const dataSize = Math.round(byteRate * durationSec);
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  const fmt = Buffer.concat([
    Buffer.from('fmt ', 'ascii'), u32(16), u16(1), u16(2),
    u32(sampleRate), u32(byteRate), u16(4), u16(16),
  ]);
  const data = Buffer.concat([Buffer.from('data', 'ascii'), u32(dataSize), Buffer.alloc(dataSize)]);
  const body = Buffer.concat([fmt, data]);
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'), u32(body.length + 4), Buffer.from('WAVE', 'ascii'), body,
  ]);
}
