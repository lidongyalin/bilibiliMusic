import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAudioInfo } from '../src/api/localtags.js';
import { parseRange } from '../src/api/localstream.js';
import {
  mp3File, flacFile, m4aFile, oggFile, wavFile,
} from './fixtures/audio.mjs';

/**
 * 标签解析器的离线单测。
 *
 * 零依赖解析器最怕的是「在某个工具导出的文件上悄悄读错」，所以这里自己生成
 * 结构合法的容器头（见 fixtures/audio.mjs），逐个格式断言时长与标签。
 * 不联网、不依赖本机音频库。
 */

const tmp = await mkdtemp(join(tmpdir(), 'blm-tags-'));
let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function read(name, buf) {
  const p = join(tmp, name);
  await writeFile(p, buf);
  return readAudioInfo(p);
}

try {
  console.log('\nMP3（ID3v2.3 + Xing 头，精确时长）');
  {
    const { tags } = await read('a.mp3', mp3File({
      title: 'Test Song', artist: 'Test Artist', album: 'Test Album', year: '2024', xingFrames: 100,
    }));
    ok('标题', tags.title === 'Test Song', `got ${tags.title}`);
    ok('歌手', tags.artist === 'Test Artist', `got ${tags.artist}`);
    ok('专辑', tags.album === 'Test Album', `got ${tags.album}`);
    ok('年份', tags.year === '2024', `got ${tags.year}`);
    ok('时长（100 帧 @ 44100 = 2.6s）', Math.abs(tags.durationSec - 2.6) < 0.05, `got ${tags.durationSec}`);
    ok('mediaStart 跳过 ID3', tags.mediaStart > 10);
  }

  console.log('\nMP3（无 Xing，走逐帧扫描）');
  {
    const { tags } = await read('b.mp3', mp3File({ title: 'Scan Song', frames: 200 }));
    ok('标题', tags.title === 'Scan Song', `got ${tags.title}`);
    const expect = Math.round(200 * 1152 / 44100 * 10) / 10;
    ok(`时长（200 帧 = ${expect}s）`, Math.abs(tags.durationSec - expect) < 0.1, `got ${tags.durationSec}`);
  }

  console.log('\nMP3（UTF-16LE 中文标签）');
  {
    const { tags } = await read('c.mp3', mp3File({ title: '测试歌曲', frames: 1, utf16: true }));
    ok('中文标题', tags.title === '测试歌曲', `got ${tags.title}`);
  }

  console.log('\nFLAC（STREAMINFO + VORBIS_COMMENT）');
  {
    const { tags } = await read('d.flac', flacFile({
      title: 'FLAC Song', artist: 'FLAC Artist', album: 'FLAC Album', durationSec: 1,
    }));
    ok('时长 1.0s', Math.abs(tags.durationSec - 1) < 0.01, `got ${tags.durationSec}`);
    ok('标题', tags.title === 'FLAC Song', `got ${tags.title}`);
    ok('歌手', tags.artist === 'FLAC Artist', `got ${tags.artist}`);
    ok('专辑', tags.album === 'FLAC Album', `got ${tags.album}`);
  }

  console.log('\nM4A（moov/mvhd + ilst + covr 封面）');
  {
    const { tags } = await read('e.m4a', m4aFile({
      title: 'M4A Song', artist: 'M4A Artist', album: 'M4A Album', year: '2024', cover: true,
    }));
    ok('时长 1.0s', Math.abs(tags.durationSec - 1) < 0.01, `got ${tags.durationSec}`);
    ok('标题', tags.title === 'M4A Song', `got ${tags.title}`);
    ok('歌手', tags.artist === 'M4A Artist', `got ${tags.artist}`);
    ok('专辑', tags.album === 'M4A Album', `got ${tags.album}`);
    ok('年份', tags.year === '2024', `got ${tags.year}`);
    ok('封面是 PNG', tags.picture && tags.picture.data[1] === 0x50, `got ${tags.picture && tags.picture.mime}`);
  }

  console.log('\nM4A（ilst 嵌在 moov/udta/meta 里）');
  {
    const { tags } = await read('f.m4a', m4aFile({
      title: 'Nested Song', nested: true, durationSec: 2,
    }));
    ok('时长 2.0s', Math.abs(tags.durationSec - 2) < 0.01, `got ${tags.durationSec}`);
    ok('嵌套标题', tags.title === 'Nested Song', `got ${tags.title}`);
  }

  console.log('\nOGG Vorbis（识别头 + 评论头 + last 标记包）');
  {
    const { tags } = await read('g.ogg', oggFile({ title: 'OGG Song', artist: 'OGG Artist', durationSec: 1 }));
    ok('时长 1.0s', Math.abs(tags.durationSec - 1) < 0.01, `got ${tags.durationSec}`);
    ok('标题', tags.title === 'OGG Song', `got ${tags.title}`);
    ok('歌手', tags.artist === 'OGG Artist', `got ${tags.artist}`);
  }

  console.log('\nWAV');
  {
    const { tags } = await read('h.wav', wavFile({ durationSec: 1 }));
    ok('时长 1.0s', Math.abs(tags.durationSec - 1) < 0.02, `got ${tags.durationSec}`);
  }

  console.log('\nRange 解析');
  const r = parseRange('bytes=0-99', 1000);
  ok('完整范围', r && r.start === 0 && r.end === 99);
  const r2 = parseRange('bytes=100-', 1000);
  ok('开区间', r2 && r2.start === 100 && r2.end === 999);
  const r3 = parseRange('bytes=-50', 1000);
  ok('后缀范围', r3 && r3.start === 950 && r3.end === 999);
  const r4 = parseRange('bytes=50-99999', 1000);
  ok('越界自动夹到文件尾', r4 && r4.end === 999);
  ok('坏格式返回 null', parseRange('chunk=0-10', 1000) === null);
  ok('空返回 null', parseRange('', 1000) === null);
  ok('起大于止返回 null', parseRange('bytes=100-50', 1000) === null);

  console.log('\n垃圾输入');
  for (const [name, content] of [
    ['空文件', Buffer.alloc(0)],
    ['随机字节', Buffer.from(Array.from({ length: 200 }, () => Math.floor(Math.random() * 256)))],
    ['半个 MP3 头', Buffer.from([0xff, 0xfb, 0x90])],
    ['文本文件', Buffer.from('this is not audio', 'utf8')],
    ['只有 ID3 头', mp3File({ title: 'Only Tag' }).subarray(0, 10)],
  ]) {
    const p = join(tmp, `bad-${name}.mp3`);
    await writeFile(p, content);
    try {
      const { tags } = await readAudioInfo(p);
      ok(`${name} 不抛异常`, tags && typeof tags.durationSec === 'number', `got ${JSON.stringify(tags)}`);
    } catch (e) {
      ok(`${name} 不抛异常`, false, e.message);
    }
  }
} catch (e) {
  fail += 1;
  console.error('未捕获异常:', e);
}

await rm(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
