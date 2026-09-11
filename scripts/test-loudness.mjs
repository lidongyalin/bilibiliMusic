/**
 * 音量均衡（F26）纯函数测试。离线跑，不联网、不碰音频设备。
 * 覆盖：RMS 平均、RMS↔dB 换算、补偿增益的夹取、存储的 LRU 与脏数据清洗。
 */

import assert from 'node:assert/strict';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const {
  TARGET_RMS, MIN_BLOCKS, averageRms, rmsToDb, normGainDb, createLoudnessStore,
} = await import('../client/src/loudness.js');

console.log('\naverageRms');
{
  ok('空数组 → 0', averageRms([]) === 0);
  ok('非数组 → 0', averageRms(null) === 0);
  ok('全 0 → 0', averageRms([0, 0, 0]) === 0);
  ok('过滤非法值', averageRms([0.1, NaN, undefined, -1, 0.1]) > 0);
  // 等值序列的平均就等于该值
  const flat = new Array(20).fill(0.2);
  ok('等值序列 = 该值', Math.abs(averageRms(flat) - 0.2) < 1e-9, `got ${averageRms(flat)}`);
  // 后面的块权重更高：尾部的大值会把平均往上拉
  const asc = [...new Array(20).fill(0.05), 0.5];
  ok('尾部权重更高', averageRms(asc) > 0.05, `got ${averageRms(asc)}`);
}

console.log('\nrmsToDb / normGainDb');
{
  ok('RMS 1.0 = 0 dBFS', Math.abs(rmsToDb(1)) < 1e-9);
  ok('RMS 0.1 = -20 dBFS', Math.abs(rmsToDb(0.1) + 20) < 1e-9);
  ok('RMS 0 → -90 替身', rmsToDb(0) === -90);
  ok('NaN → -90 替身', rmsToDb(NaN) === -90);

  // 目标响度的歌补偿为 0
  ok('等于目标 → 0', normGainDb(TARGET_RMS) === 0);
  // 比目标响一倍（+6dB）→ 补偿 -6
  ok('响一倍 → -6dB', Math.abs(normGainDb(0.2) + 6) < 0.1, `got ${normGainDb(0.2)}`);
  // 比目标轻一半 → +6
  ok('轻一半 → +6dB', Math.abs(normGainDb(0.05) - 6) < 0.1, `got ${normGainDb(0.05)}`);
  // 极端值夹在 ±12
  ok('极响夹到 -12', normGainDb(2.0) === -12, `got ${normGainDb(2.0)}`);
  ok('极轻夹到 +12', normGainDb(0.0001) === 12, `got ${normGainDb(0.0001)}`);
  ok('RMS 0 → 0', normGainDb(0) === 0);
  ok('NaN → 0', normGainDb(NaN) === 0);
  // 自定义上限
  ok('自定义上限', normGainDb(0.0001, TARGET_RMS, 6) === 6);
}

console.log('\ncreateLoudnessStore');
{
  let saved = {};
  const store = createLoudnessStore(() => saved, (m) => { saved = m; });

  ok('空存储 get → 0', store.get('a') === 0);

  // 采样不足不落库
  ok('块数不足不落库', store.learn('a', new Array(MIN_BLOCKS - 1).fill(0.1)) === 0);
  ok('落库后也查不到', store.get('a') === 0);

  const learned = store.learn('a', new Array(MIN_BLOCKS).fill(0.1));
  ok('够块数才落库', learned > 0, `got ${learned}`);
  ok('能读回来', Math.abs(store.get('a') - 0.1) < 1e-6);
  ok('size = 1', store.size() === 1);

  // 已有值时平滑而不是覆盖
  const again = store.learn('a', new Array(MIN_BLOCKS).fill(0.3));
  ok('二次学习做平滑', again > 0.1 && again < 0.3, `got ${again}`);

  // 脏数据清洗：read 返回乱七八糟的东西也不能炸
  saved = { b: { rms: 'abc' }, c: null, d: { rms: 99 }, e: { rms: 0.15 } };
  ok('非法条目被清洗', store.get('b') === 0 && store.get('c') === 0 && store.get('d') === 0);
  ok('合法条目保留', Math.abs(store.get('e') - 0.15) < 1e-6);

  // forget / clear
  store.forget('e');
  ok('forget 生效', store.get('e') === 0);
  store.learn('z', new Array(MIN_BLOCKS).fill(0.2));
  store.clear();
  ok('clear 清空', store.size() === 0 && store.get('z') === 0);
}

console.log('\nLRU 上限');
{
  let saved = {};
  // 把上限压到 3 便于测试：直接构造一个小的 store 不可行（STORE_MAX 是常量），
  // 所以这里只验证「写入大量条目后 map 不会无限膨胀」——上限 600
  const store = createLoudnessStore(() => saved, (m) => { saved = m; });
  for (let i = 0; i < 700; i += 1) {
    store.learn(`t${i}`, new Array(MIN_BLOCKS).fill(0.1));
  }
  ok('超过上限会被裁掉', store.size() <= 600, `got ${store.size()}`);
  // 最旧的被丢，最新的保留
  ok('最旧的被丢', store.get('t0') === 0);
  ok('最新的保留', store.get('t699') > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
