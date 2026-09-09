import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG } from '../config.js';

/**
 * 歌单持久化：一个 JSON 文件里存全部歌单，每首曲目在自己的歌单内独立存一份快照。
 * 与 favorites.js 同构（原子写入 + 串行化 saveChain），单曲目量级下比 SQLite 更简单可靠。
 *
 * 快照意味着「歌单里的歌是加进来那一刻的样子」——标题、封面、时长不会跟随 B 站后来改稿而变化。
 * 这也是歌单能脱离搜索结果独立存在的原因：删掉搜索结果，歌单里那首歌还在。
 */

const FILE = join(CONFIG.DATA_DIR, 'playlists.json');
const DEFAULT_NAME = '我喜欢的音乐';
const MAX_TITLE_LEN = 40;
const MAX_NAME_LEN = 40;
const MAX_SONGS_PER_PLAYLIST = 1000;
const MAX_BATCH = 500;

// ---------- 纯函数：不碰 IO，单测直接调 ----------

/** 把外部（前端提交）的数据规整成内部结构。id 一律转字符串，空值给安全默认 */
function normalizeSong(raw) {
  return {
    id: String(raw.id),
    type: raw.type || 'video',
    bvid: raw.bvid || String(raw.id),
    aid: Number(raw.aid) || 0,
    title: String(raw.title || '未命名'),
    author: String(raw.author || '未知 UP 主'),
    cover: raw.cover || '',
    duration: raw.duration || '',
    durationSec: Number(raw.durationSec) || 0,
    play: Number(raw.play) || 0,
    playText: raw.playText || '',
    isPay: Boolean(raw.isPay),
    addedAt: raw.addedAt || new Date().toISOString(),
  };
}

/** 歌名截断 + 去首尾空白；空名字回落到默认名 */
function normalizeName(name, fallback = DEFAULT_NAME) {
  const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!s) return fallback;
  return s.slice(0, MAX_NAME_LEN);
}

/**
 * 和已有歌单去重：名字被占了就加数字后缀（「华语经典 2」「华语经典 3」）。
 * create 和 rename 共用，否则改名能把两个歌单改成同名，前端就分不清了。
 */
function dedupName(base, taken) {
  let name = base;
  for (let i = 2; ; i += 1) {
    if (!taken.has(name)) return name;
    name = `${base} ${i}`.slice(0, MAX_NAME_LEN);
    if (i > 500) return name;
  }
}

function sortSongs(songs) {
  // 批量加歌时全部条目共用同一个时间戳，只比 addedAt 会退回插入顺序。
  // 索引只作为稳定兜底，不能反过来——否则用户拖出来的顺序也会被这个兜底改掉
  return songs
    .map((s, i) => [i, s])
    .sort((pa, pb) => String(pb[1].addedAt).localeCompare(String(pa[1].addedAt)) || pa[0] - pb[0])
    .map((p) => p[1]);
}

/** 在歌单里加歌：同 bvid 视为重复，保留原有位置与时间，不重复写 */
function addSongsToPlaylist(playlist, songs, now) {
  let added = 0;
  let skipped = 0;
  for (const raw of songs) {
    if (!raw || !raw.bvid) { skipped += 1; continue; }
    if (playlist.songs.some((s) => s.bvid === String(raw.bvid))) { skipped += 1; continue; }
    playlist.songs.push(normalizeSong({ ...raw, addedAt: now }));
    added += 1;
  }
  playlist.updatedAt = now;
  return { playlist, added, skipped };
}

function renamePlaylist(playlist, name, now) {
  const old = playlist.name;
  playlist.name = normalizeName(name);
  playlist.updatedAt = now;
  return { playlist, oldName: old };
}

/** 按给定 id 顺序重排；列表外的 id 直接丢弃（前端拖完只提交当前顺序） */
function reorderSongs(playlist, orderedIds, now) {
  const byId = new Map(playlist.songs.map((s) => [s.bvid, s]));
  const next = [];
  for (const id of orderedIds) {
    const hit = byId.get(String(id));
    if (hit) next.push(hit);
  }
  playlist.songs = next;
  playlist.updatedAt = now;
  return { playlist, count: next.length };
}

/** 按更新时间倒序返回歌单摘要。带 songCount，前端不用自己数。
 *  注意不能叫 serializePlaylists：那会把本文件末尾的 playlists 导出对象遮蔽掉 */
function serializeSummary(all) {
  return [...all]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((p) => ({
      id: p.id,
      name: p.name,
      songCount: p.songs.length,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
}

function serializePlaylist(playlist) {
  return {
    id: playlist.id,
    name: playlist.name,
    songCount: playlist.songs.length,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    songs: sortSongs(playlist.songs),
  };
}

// ---------- IO ----------

let cache = null;
let loadPromise = null;
let saveChain = Promise.resolve();

function emptyStore() {
  return { version: 1, playlists: [] };
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
    const raw = Array.isArray(parsed.playlists) ? parsed.playlists : [];
    cache = {
      version: 1,
      // 只保留有 id 的；没有 songs 字段的补空数组，容忍手改过的文件
      playlists: raw
        .filter((p) => p && p.id)
        .map((p) => ({
          id: String(p.id),
          name: normalizeName(p.name),
          createdAt: String(p.createdAt || new Date().toISOString()),
          updatedAt: String(p.updatedAt || p.createdAt || new Date().toISOString()),
          songs: Array.isArray(p.songs) ? p.songs.filter((s) => s && s.bvid).map(normalizeSong) : [],
        })),
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

export const playlists = {
  async list() {
    return serializeSummary((await load()).playlists);
  },

  async get(id) {
    const store = await load();
    const hit = store.playlists.find((p) => p.id === String(id));
    return hit ? serializePlaylist(hit) : null;
  },

  async create(name) {
    const store = await load();
    const now = new Date().toISOString();
    const created = {
      id: String(Date.now()),
      // 重名时加数字后缀而不是拒绝：用户想建第二个「华语经典」应该照样能建
      name: dedupName(normalizeName(name), new Set(store.playlists.map((p) => p.name))),
      createdAt: now,
      updatedAt: now,
      songs: [],
    };
    store.playlists.push(created);
    store.updatedAt = now;
    await persist();
    return serializePlaylist(created);
  },

  async rename(id, name) {
    const store = await load();
    const hit = store.playlists.find((p) => p.id === String(id));
    if (!hit) return null;
    const oldName = hit.name;
    // 排除自己：改名成和当前名字一样不算冲突
    const taken = new Set(store.playlists.filter((p) => p !== hit).map((p) => p.name));
    renamePlaylist(hit, dedupName(normalizeName(name), taken), new Date().toISOString());
    await persist();
    return { playlist: serializePlaylist(hit), oldName };
  },

  async remove(id) {
    const store = await load();
    const idx = store.playlists.findIndex((p) => p.id === String(id));
    if (idx < 0) return null;
    const [removed] = store.playlists.splice(idx, 1);
    await persist();
    return serializePlaylist(removed);
  },

  async addSongs(id, songs) {
    const store = await load();
    const hit = store.playlists.find((p) => p.id === String(id));
    if (!hit) return null;
    const batch = Array.isArray(songs) ? songs.slice(0, MAX_BATCH) : [];
    if (!batch.length) return { playlist: serializePlaylist(hit), added: 0, skipped: 0 };
    const { added, skipped } = addSongsToPlaylist(hit, batch, new Date().toISOString());
    await persist();
    return { playlist: serializePlaylist(hit), added, skipped };
  },

  async removeSong(id, bvid) {
    const store = await load();
    const hit = store.playlists.find((p) => p.id === String(id));
    if (!hit) return null;
    const before = hit.songs.length;
    hit.songs = hit.songs.filter((s) => s.bvid !== String(bvid));
    if (hit.songs.length === before) return { removed: false, playlist: serializePlaylist(hit) };
    hit.updatedAt = new Date().toISOString();
    await persist();
    return { removed: true, playlist: serializePlaylist(hit) };
  },

  async reorder(id, orderedIds) {
    const store = await load();
    const hit = store.playlists.find((p) => p.id === String(id));
    if (!hit) return null;
    const list = Array.isArray(orderedIds) ? orderedIds : [];
    if (!list.length) {
      // 空列表意味着清空歌单，这是有意义的操作而不是错误输入
      hit.songs = [];
      hit.updatedAt = new Date().toISOString();
      await persist();
      return { playlist: serializePlaylist(hit) };
    }
    const { playlist } = reorderSongs(hit, list, new Date().toISOString());
    await persist();
    return { playlist: serializePlaylist(playlist) };
  },
};
