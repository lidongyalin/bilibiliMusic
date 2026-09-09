// 流代理的防御性逻辑回归测试：注入各种异常上游响应，确认代理层的行为。
// 上游（B 站）不会稳定地返回这些异常，无法靠真实网络回归，因此把整条链路
// （访客标识、视频页、CDN）全部换成假的，测试自身不依赖网络。
//
// 运行：node scripts/verify-stream-guard.mjs
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(here, '..', 'src', 'api', 'stream.js')).href);
const { handleStream, invalidate } = mod;

// ---------- 假上游 ----------

const BV = 'BV1TEST00000001';
const AUDIO_BYTES = 200_001;
const audioBody = Buffer.concat([Buffer.from('\u0000\u0000\u0000$ftypiso5', 'binary'), Buffer.alloc(AUDIO_BYTES - 12)]);
const htmlBody = '<html><body>访问被拒绝</body></html>';

const fakePlayinfo = {
  code: 0,
  data: {
    aid: 9001,
    cid: 9002,
    timelength: 243_000,
    tl_out: { title: '测试曲目' },
    dash: {
      audio: [
        { baseUrl: 'https://cdn.example.com/audio.m4s', bandwidth: 128_000, mimeType: 'audio/mp4' },
        { baseUrl: 'https://cdn.example.com/audio-hq.m4s', bandwidth: 190_000, mimeType: 'audio/mp4' },
      ],
    },
  },
};

let MODE = 'good';

/** 根据 MODE 构造 CDN 响应 */
function cdnResponse() {
  if (MODE === 'html206' || MODE === 'html200') {
    return new Response(htmlBody, {
      status: MODE === 'html206' ? 206 : 200,
      headers: { 'content-type': 'text/html; charset=UTF-8', 'content-length': String(htmlBody.length) },
    });
  }
  if (MODE === 'plain403') {
    return new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
  }
  if (MODE === 'no-length') {
    // CDN 偶尔不回 Content-Length / Content-Range，不能把它们设成字符串 "null"
    return new Response(audioBody, { status: 206, headers: { 'content-type': 'audio/mp4' } });
  }
  if (MODE === 'full200') {
    // CDN 忽略 Range 时会回 200 全量，此时不能伪装成 206
    return new Response(audioBody, {
      status: 200,
      headers: { 'content-type': 'audio/mp4', 'content-length': String(audioBody.length) },
    });
  }
  // good：CDN 把纯音频标成 video/mp4，代理应统一成 audio/mp4
  return new Response(audioBody, {
    status: 206,
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(audioBody.length),
      'content-range': `bytes 0-${AUDIO_BYTES - 1}/${AUDIO_BYTES + 4_700_000}`,
    },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (url) => {
  const u = String(url);
  if (/\/x\/frontend\/finger\/spi/.test(u)) {
    return new Response(JSON.stringify({ code: 0, data: { b_3: 'test-b3', b_4: 'test-b4' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (u.startsWith('https://www.bilibili.com/video/')) {
    return new Response(`<!DOCTYPE html><html><script>window.__playinfo__=${JSON.stringify(fakePlayinfo)}</script></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
  }
  if (/cdn\.example\.com/.test(u)) return cdnResponse();
  throw new Error('测试里不该出现真实网络请求：' + u);
};

// ---------- 记录型 res ----------

/** 真正的 Writable（pipeline 要能把它排空），同时记录响应头与 body */
function makeRes() {
  const store = { statusCode: 200, headers: new Map() };
  const written = [];
  const res = new Writable({
    write(chunk, _enc, cb) { written.push(chunk); cb(); },
  });
  res.headersSent = false;
  res.status = (c) => { store.statusCode = c; return res; };
  res.setHeader = (k, v) => {
    if (v === null || v === undefined) return res;
    store.headers.set(String(k).toLowerCase(), String(v)); // HTTP 头名大小写不敏感
    return res;
  };
  res.json = (obj) => { written.push(Buffer.from(JSON.stringify(obj))); return res; };
  res._payload = () => Buffer.concat(written);
  return { store, res };
}

// ---------- 用例 ----------

/** 每个用例的期望 */
const CASES = {
  good: {
    why: '正常 DASH 音轨；CDN 标成 video/mp4，应统一为 audio/mp4',
    check: (r) => r.status === 206 && r.type === 'audio/mp4' && r.range && r.length,
  },
  html206: {
    why: 'CDN 回 HTML 错误页却带 206（最阴险的一种）',
    check: (r) => r.status === 502 && r.json && /错误页/.test(r.message),
  },
  html200: {
    why: 'CDN 回 HTML 错误页且带 200',
    check: (r) => r.status === 502 && r.json && /错误页/.test(r.message),
  },
  plain403: {
    why: 'CDN 返回 403，不应转发正文',
    check: (r) => r.status === 502 && r.json && /HTTP 403/.test(r.message),
  },
  'no-length': {
    why: 'CDN 不回 Content-Length / Content-Range，不能设成 "null"',
    check: (r) => r.status === 206 && r.type === 'audio/mp4' && r.length === undefined && r.range === undefined,
  },
  full200: {
    why: 'CDN 忽略 Range 回 200 全量，不能伪装成 206',
    check: (r) => r.status === 200 && r.type === 'audio/mp4',
  },
};

const ok = (c) => (c ? 'PASS' : 'FAIL');
let allPass = true;

for (const [mode, spec] of Object.entries(CASES)) {
  MODE = mode;
  invalidate(BV);
  const { store, res } = makeRes();
  let r;
  try {
    await handleStream({ headers: { range: 'bytes=0-200000' } }, res, BV);
    const payload = res._payload();
    const text = payload.toString('utf8');
    const isJson = text.trimStart().startsWith('{');
    r = {
      status: store.statusCode,
      type: store.headers.get('content-type'),
      length: store.headers.get('content-length'),
      range: store.headers.get('content-range'),
      json: isJson,
      message: isJson ? (JSON.parse(text).error || '') : '',
      bytes: payload.length,
      ftyp: payload.subarray(4, 8).toString('binary') === 'ftyp',
    };
  } catch (err) {
    r = { thrown: err.message };
  }
  const pass = !r.thrown && spec.check(r);
  if (!pass) allPass = false;

  console.log(ok(pass) + '  ' + mode.padEnd(10) + '  ' +
    (r.thrown ? '抛异常: ' + r.thrown :
      `http=${String(r.status).padEnd(4)} ` +
      `type=${String(r.type || '（未设置）').padEnd(12)} ` +
      `len=${String(r.length ?? '—').padEnd(7)} ` +
      `range=${String(r.range || '—').slice(0, 24).padEnd(24)} ` +
      `${r.bytes}B` +
      (r.json ? '  JSON: ' + r.message.slice(0, 40) : (r.ftyp ? '  流首字节 ftyp ✓' : ''))));
  console.log('      ↳ ' + spec.why);
}

globalThis.fetch = realFetch;
console.log(allPass ? '\n全部通过' : '\n有失败项');
process.exit(allPass ? 0 : 1);
