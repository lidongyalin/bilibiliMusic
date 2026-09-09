/**
 * 歌词模块的离线单测（不联网）。
 * 跑法：node scripts/test-lyrics.mjs
 * 联网那条链路单独用 node scripts/probe-lyrics-live.mjs 验。
 */
import { cleanTitle, segments, parseLrc, lcsRatio, scoreCandidate } from '../src/api/lyrics.js';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       期望 ${e}\n       实际 ${a}`);
  }
}

function ok(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n       实际 ${JSON.stringify(actual)}`);
  }
}

// --- LRC 解析 ---

const LRC = `[00:00.000] 作词 : 周杰伦
[00:01.000] 作曲 : 周杰伦
[00:30.542]故事的小黄花
[00:34.165]从出生那年就飘着
[00:37.773]童年的荡秋千
[00:01.000] [00:30.542]同一行两个时间戳取第一个
[01:02.5]两位毫秒
[00:07]缺毫秒
[ti:晴天]
[ar:周杰伦]
[offset:420]
[intro]没有时间的行
`;

const parsed = parseLrc(LRC);
check('时间戳解析成秒', parsed.find((l) => l.text === '故事的小黄花').time, 30.542);
check('作词/作曲元信息行被剔除', parsed.some((l) => /作词|作曲/.test(l.text)), false);
check('指令行（ti/ar/offset）被剔除', parsed.some((l) => /^(ti|ar|offset)/i.test(l.text)), false);
check('没有时间戳的行被忽略', parsed.some((l) => l.text === '没有时间的行'), false);
check('同一行多个时间戳取第一个', parsed.find((l) => l.text === '同一行两个时间戳取第一个').time, 1);
check('两位毫秒补齐', parsed.find((l) => l.text === '两位毫秒').time, 62.5);
check('缺毫秒按 0', parsed.find((l) => l.text === '缺毫秒').time, 7);
check('按时间排序', parsed.every((l, i, a) => i === 0 || a[i - 1].time <= l.time), true);
check('空输入返回空数组', parseLrc(''), []);
check('非字符串输入返回空数组', parseLrc(null), []);
check('只有元信息的 LRC 返回空', parseLrc('[00:00.000] 作词 : 某人\n[00:01.000] 作曲 : 某人'), []);

// 字面量 \n 与多余空白
check('字面量 \\n 换成空格', parseLrc('[00:10.000]你好\\n世界')[0].text, '你好 世界');
check('连续空白折叠', parseLrc('[00:10.000]  你好   世界  ')[0].text, '你好 世界');

// --- 曲名清洗 ---

const cleaned = cleanTitle('【4K修复】周杰伦 - 晴天MV 2160P60 超高清');
ok('去【】方括号前缀', !cleaned.includes('4K') && !cleaned.includes('修复'), cleaned);
ok('去 MV 与分辨率修饰', !/MV|1080|2160|60/.test(cleaned), cleaned);
ok('保留曲名与歌手', cleaned.includes('晴天') && cleaned.includes('周杰伦'), cleaned);

check('去《》标记但保留内容', cleanTitle('《晴天》- 周杰伦').includes('晴天'), true);
ok('去引号内的歌词摘录', !cleanTitle('《晴天》"从前从前有个人爱你很久"').includes('从前从前'), cleanTitle('《晴天》"从前从前有个人爱你很久"'));

// 搜索接口会把命中词包在 <em> 里，属性值甚至没有引号
const withEm = cleanTitle('<em class= >海阔天空</em>- <em class= >BEYOND</em> -‘原谅我这一生不羁放纵爱自由’');
ok('剥掉 <em> 标签', !withEm.includes('<') && !withEm.includes('em'), withEm);
ok('剥掉弯单引号里的歌词', !withEm.includes('原谅我'), withEm);

// 版本标注与录音棚营销词：清掉后剩下的还能对上歌名
const VERSIONY = cleanTitle('原版起风了买辣椒也用券');
ok('去「原版」版本标注', !VERSIONY.includes('原版') && VERSIONY.startsWith('起风了'), VERSIONY);
const PROMO = cleanTitle('在百万豪装录音棚大声听买辣椒也用券起风了');
ok('去录音棚营销词', !/百万豪装|录音棚|大声听/.test(PROMO), PROMO);
ok('版本标注清干净后打分能过门槛',
  scoreCandidate(VERSIONY, segments(VERSIONY), { name: '起风了', artists: [{ name: '买辣椒也用券' }] }) >= 0.55,
  scoreCandidate(VERSIONY, segments(VERSIONY), { name: '起风了', artists: [{ name: '买辣椒也用券' }] }).toFixed(3));

const segs = segments(cleaned);
ok('拆成词段', segs.length >= 2, segs);
ok('无分隔符时保留整串', segments('晴天').length === 1, segments('晴天'));

// 长词段降权：整句歌词不该被当成歌名（真实标题里用 --- 分隔）
const QUOTE_TITLE = '我曾难自拔于世界之大 也沉溺于其中梦话---起风了';
const QUOTE_SEGS = segments(QUOTE_TITLE);
const wrong = scoreCandidate(QUOTE_TITLE, QUOTE_SEGS, { name: '世界之大', artists: [] });
const right = scoreCandidate(QUOTE_TITLE, QUOTE_SEGS, { name: '起风了', artists: [] });
ok('短歌名词段胜过整句歌词词段', right > wrong, { wrong: wrong.toFixed(3), right: right.toFixed(3) });
ok('整句歌词词段单独达不到门槛', wrong < 0.55, wrong.toFixed(3));

// 歌手括号别名
const ALIAS_TITLE = '起风了 - 买辣椒也用券';
const alias = scoreCandidate(ALIAS_TITLE, segments(ALIAS_TITLE), { name: '起风了', artists: [{ name: '冯沁苑(买辣椒也用券)' }] });
const noAlias = scoreCandidate(ALIAS_TITLE, segments(ALIAS_TITLE), { name: '起风了', artists: [{ name: '某位歌手' }] });
ok('括号里的别名也能对上歌手', alias > noAlias, { alias: alias.toFixed(3), noAlias: noAlias.toFixed(3) });

// --- 相似度 ---

check('完全相同', lcsRatio('晴天', '晴天'), 1);
check('候选更短、完全包含', Math.round(lcsRatio('周杰伦晴天', '晴天') * 100) / 100, 1);
check('候选更长、完全包含', Math.round(lcsRatio('晴天', '晴天深情版') * 100) / 100, 1);
check('完全不同的歌', lcsRatio('晴天', '七里香'), 0);
check('空串', lcsRatio('', '晴天'), 0);
check('部分重叠按比例', lcsRatio('晴天故事', '故事的天空') > 0.4, true);

// --- 候选打分 ---

const SCENES = [
  {
    name: '清洗后标题 vs 正主（应最高分）',
    cleaned: '周杰伦 晴天',
    candidates: [
      { name: '晴天', artists: [{ name: '周杰伦' }] },
      { name: '晴天(深情版)', artists: [{ name: 'Lucky小爱' }] },
      { name: '晴天钢琴版', artists: [{ name: '某人' }] },
    ],
    expectWinner: 0,
  },
  {
    name: '候选名相同时，标题里提到歌手的那首占优',
    cleaned: '周杰伦 晴天',
    candidates: [
      { name: '晴天', artists: [{ name: '路人甲' }] },
      { name: '晴天', artists: [{ name: '周杰伦' }] },
    ],
    expectWinner: 1,
  },
  {
    name: '标题里没有歌手信息时按搜索返回顺序取第一（同分不翻转）',
    cleaned: '晴天',
    candidates: [
      { name: '晴天', artists: [{ name: '先返回的' }] },
      { name: '晴天', artists: [{ name: '后返回的' }] },
    ],
    expectWinner: 0,
  },
  {
    name: '衍生版本被扣分',
    cleaned: '晴天',
    candidates: [{ name: '晴天', artists: [] }, { name: '晴天伴奏', artists: [] }],
    expectWinner: 0,
  },
];

for (const scene of SCENES) {
  const scored = scene.candidates.map((c) => scoreCandidate(scene.cleaned, segments(scene.cleaned), c));
  const winner = scored.indexOf(Math.max(...scored));
  check(`${scene.name}（分 ${scored.map((s) => s.toFixed(2)).join(' ')}）`, winner, scene.expectWinner);
}

// 门槛附近
const weak = scoreCandidate('晴天', segments('晴天'), { name: '七里香', artists: [{ name: '周杰伦' }] });
ok('完全不相关的候选分数很低', weak < 0.3, weak.toFixed(3));

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
