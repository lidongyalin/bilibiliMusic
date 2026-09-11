import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG } from '../config.js';

/**
 * 播放历史 + 播放次数。
 *
 * 只存曲目元数据快照和播放时刻，不存任何内容类数据。
 * 智能歌单（最近播放 / 最常播放）就是从这里算出来的。
 */

const FILE = join(CONFIG.DATA_DIR, 'history.json');
const MAX_RECORDS = 500;
const MAX_PLAYLIST = 300;

let cache = null;
let loadPromise = null;
let saveChain = Promise.resolve();

function emptyStore() {
  return { version: 1, records: [], playCounts: {} };
}

function load() {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) loadPromise = doLoad().finally(() => (loadPromise = null));
  return loadPromise;
}

async function doLoad() {
  try {
    const text = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(text);
    cache = {
      version: 1,
      records: Array.isArray(parsed.records)
        ? parsed.records.filter((r) => r && r.id).slice(0, MAX_RECORDS)
        : [],
      playCounts: parsed.playCounts && typeof parsed.playCounts === 'object' ? parsed.playCounts : {},
    };
  } catch (err) {
    if (err.code === 'ENOENT') cache = emptyStore();
    else throw err;
  }
  return cache;
}

function persist() {
  saveChain = saveChain.then(async () => {
    await mkdir(CONFIG.DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await rename(tmp, FILE);
  });
  return saveChain;
}

export const history = {
  /** 记一次播放。同一曲目重复播放时把记录挪到最前，播放次数 +1 */
  async record(song) {
    if (!song || !song.bvid) return;
    const store = await load();
    const now = new Date().toISOString();

    const key = String(song.bvid);
    store.playCounts[key] = (Number(store.playCounts[key]) || 0) + 1;

    store.records = store.records.filter((r) => r.id !== key);
    store.records.unshift({
      id: key,
      bvid: key,
      source: song.source || 'remote',
      title: String(song.title || '').slice(0, 200),
      artist: String(song.author || song.artist || '').slice(0, 200),
      album: String(song.album || '').slice(0, 200),
      cover: song.cover || '',
      durationSec: Number(song.durationSec) || 0,
      at: now,
    });
    store.records = store.records.slice(0, MAX_RECORDS);
    await persist();
    return store.records[0];
  },

  async list(limit = 200) {
    const store = await load();
    return store.records.slice(0, Math.max(1, Math.min(Number(limit) || 200, MAX_RECORDS)));
  },

  async playCounts() {
    const store = await load();
    return { ...store.playCounts };
  },

  /** 最常播放：按次数倒序，取前 N */
  async mostPlayed(limit = 100) {
    const store = await load();
    const counts = Object.entries(store.playCounts)
      .map(([id, n]) => ({ id, plays: Number(n) || 0 }))
      .filter((x) => x.plays > 0)
      .sort((a, b) => b.plays - a.plays || String(b.id).localeCompare(String(a.id)))
      .slice(0, limit);
    const byId = new Map(store.records.map((r) => [r.id, r]));
    return counts.map((c) => byId.has(c.id) ? { ...byId.get(c.id), plays: c.plays } : { id: c.id, bvid: c.id, title: '', artist: '', plays: c.plays });
  },

  async remove(id) {
    const store = await load();
    const key = String(id);
    const before = store.records.length;
    store.records = store.records.filter((r) => r.id !== key);
    // 播放次数一起清掉：留着的话，最常播放会回落到一条没有标题的占位记录
    delete store.playCounts[key];
    if (store.records.length !== before) await persist();
    return true;
  },

  async clear() {
    const store = await load();
    store.records = [];
    store.playCounts = {};
    await persist();
    return true;
  },

  async count() {
    return (await load()).records.length;
  },
};

/** 智能歌单的最大条数，避免一次拉太多 */
export const SMART_LIMIT = MAX_PLAYLIST;
