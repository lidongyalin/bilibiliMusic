import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG } from '../config.js';

/**
 * 收藏持久化：JSON 文件 + 原子写入（先写临时文件再 rename）。
 * 单曲目的量级下比 SQLite 更简单可靠，且零依赖；
 * 接口按增删改查设计，日后换成 node:sqlite 只改这一个文件。
 */

const FILE = join(CONFIG.DATA_DIR, 'favorites.json');

let cache = null;
let loadPromise = null;
let saveChain = Promise.resolve();

function emptyStore() {
  return { version: 1, updatedAt: null, items: [] };
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
      updatedAt: parsed.updatedAt || null,
      items: Array.isArray(parsed.items) ? parsed.items.filter((i) => i && i.id) : [],
    };
  } catch (err) {
    if (err.code === 'ENOENT') cache = emptyStore();
    else throw err;
  }
  return cache;
}

function persist() {
  // 串行化写入，避免并发请求互相覆盖
  saveChain = saveChain.then(async () => {
    await mkdir(CONFIG.DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await rename(tmp, FILE);
  });
  return saveChain;
}

function normalize(item) {
  return {
    id: String(item.id),
    type: item.type || 'video',
    bvid: item.bvid || String(item.id),
    aid: Number(item.aid) || 0,
    title: String(item.title || '未命名'),
    author: String(item.author || '未知 UP 主'),
    cover: item.cover || '',
    duration: item.duration || '',
    durationSec: Number(item.durationSec) || 0,
    play: Number(item.play) || 0,
    playText: item.playText || '',
    isPay: Boolean(item.isPay),
    favoriteAt: new Date().toISOString(),
  };
}

export const favorites = {
  async list() {
    const store = await load();
    return [...store.items].sort((a, b) => String(b.favoriteAt).localeCompare(String(a.favoriteAt)));
  },

  async ids() {
    const store = await load();
    return new Set(store.items.map((i) => i.id));
  },

  async get(id) {
    const store = await load();
    return store.items.find((i) => i.id === String(id)) || null;
  },

  async add(item) {
    const store = await load();
    if (store.items.some((i) => i.id === String(item.id))) return { ...normalize(item), already: true };
    const created = normalize(item);
    store.items.unshift(created);
    store.updatedAt = created.favoriteAt;
    await persist();
    return { ...created, already: false };
  },

  async remove(id) {
    const store = await load();
    const before = store.items.length;
    store.items = store.items.filter((i) => i.id !== String(id));
    if (store.items.length === before) return false;
    store.updatedAt = new Date().toISOString();
    await persist();
    return true;
  },

  async count() {
    return (await load()).items.length;
  },
};
