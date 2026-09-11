/** 临时脚本：造几首带标签的本地音乐，供 UI 验证用。跑完可删。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mp3File, flacFile, m4aFile } from './fixtures/audio.mjs';

const music = 'D:/tmp/bm-music';
const sub = join(music, '周杰伦');

await mkdir(sub, { recursive: true });

await writeFile(join(music, 'Adele - Hello.m4a'), m4aFile({ title: 'Hello', artist: 'Adele', album: '25', year: '2015', xingFrames: 12 }));
await writeFile(join(music, '周杰伦 - 晴天.mp3'), mp3File({ title: '晴天', artist: '周杰伦', album: '叶惠美', year: '2003', xingFrames: 120 }));
await writeFile(join(music, '周杰伦 - 稻香.mp3'), mp3File({ title: '稻香', artist: '周杰伦', album: '魔杰座', year: '2008', xingFrames: 100 }));
await writeFile(join(sub, '周杰伦 - 七里香.mp3'), mp3File({ title: '七里香', artist: '周杰伦', album: '七里香', year: '2004', xingFrames: 110 }));
await writeFile(join(sub, '邓紫棋 - 光年之外.flac'), flacFile({ title: '光年之外', artist: '邓紫棋', album: '电影《太空旅客》主题曲', year: '2016', xingFrames: 90 }));

// 造一份重复：同标题、同歌手、同时长
await writeFile(join(music, '周杰伦 - 晴天 (副本).mp3'), mp3File({ title: '晴天', artist: '周杰伦', xingFrames: 120 }));

// 一份带 lrc
await writeFile(join(sub, '周杰伦 - 七里香.lrc'), '[00:01.00]七里香\n[00:03.50]窗外的风吹进来\n');

console.log('fixture ready:', music);
