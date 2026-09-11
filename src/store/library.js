import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { CONFIG } from '../config.js';
import { isAudioFile, readAudioInfo, MAX_SCAN_BYTES } from '../api/localtags.js';

/**
 * 本地曲库索引。跟 favorites/playlists 同构：JSON 文件 + 原子写入 + 串行 saveChain。
 *
 * 索引里存元数据（标题/歌手/专辑/时长/路径），不存歌词也不存音频本身——
 * 播放时后端按路径现场流式转发。封面同理：解析出来的 JPEG/PNG 只在内存里缓存，
 * 写进索引会让 library.json 迅速膨胀到几百 MB。
 *
 * 元数据编辑（PUT /api/library/:id）走 overrides 而不是改写原文件的标签：
 * 本地曲库的标签是用户自己的东西，播放器不该悄悄改动它。
 */

const FILE = join(CONFIG.DATA_DIR, 'library.json');
const SCAN_CONCURRENCY = 4;
const ART_CACHE_MAX = 60;

let cache = null;
let loadPromise = null;
let saveChain = Promise.resolve();
const artCache = new Map();

// 扫描进度：前端轮询用。放在内存里，扫描一结束就清空
let scanProgress = { running: false, phase: 'idle', current: 0, total: 0, added: 0, failed: 0 };

// ---------- 纯函数 ----------

function emptyStore() {
  return { version: 1, folders: [], songs: [], overrides: {}, removedPaths: [] };
}

// 「手动移出曲库」的路径黑名单上限。留着这些路径，重新扫描同一个文件夹时
// 才不会把用户主动删掉的歌又带回来；只影响磁盘上仍存在的文件。
const MAX_REMOVED_PATHS = 20000;

function idForPath(path) {
  // 路径本身做指纹：同名的文件在不同目录下 id 不同，文件移动后视为新歌
  return createHash('sha1').update(path.replace(/\\/g, '/')).digest('hex').slice(0, 16);
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return h ? `${h}:${mm}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** 估计比特率：标签里没有时按体积/时长反推 */
function estimateBitrate(bytes, durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || !bytes) return 0;
  const bps = Math.round((bytes * 8) / durationSec);
  return Math.round(bps / 1000);
}

function normalizeSong(raw) {
  return {
    id: String(raw.id),
    folderId: String(raw.folderId || ''),
    path: String(raw.path || ''),
    name: String(raw.name || basename(raw.path || '未命名')),
    format: String(raw.format || ''),
    size: Number(raw.size) || 0,
    durationSec: Number(raw.durationSec) || 0,
    bitrate: Number(raw.bitrate) || 0,
    title: String(raw.title || '').trim(),
    artist: String(raw.artist || '').trim(),
    album: String(raw.album || '').trim(),
    albumArtist: String(raw.albumArtist || '').trim(),
    year: String(raw.year || '').trim(),
    track: String(raw.track || '').trim(),
    genre: String(raw.genre || '').trim(),
    // 扫描时已经解析过封面，直接记一个布尔值。
    // 不记这个的话前端只能靠打 404 来发现「没有封面」，大曲库会发一堆注定失败的请求
    hasArt: Boolean(raw.hasArt),
    addedAt: String(raw.addedAt || new Date().toISOString()),
    broken: Boolean(raw.broken),
  };
}

/** 前端拿到的 id 带 local- 前缀，store 内部用裸 id。两种形式都接受 */
function normId(v) {
  const s = String(v || '');
  return s.startsWith('local-') ? s.slice(6) : s;
}

function defaultArtist() {
  return '未知歌手';
}
function defaultAlbum() {
  return '未知专辑';
}

/**
 * 索引里的曲目序列化成前端可以直接渲染的形状。
 * bvid 一律用 local-<id>，这样收藏/歌单的去重、右键菜单、播放入口都不用分叉。
 */
function serializeSong(song, override) {
  const o = override || {};
  const title = (o.title ?? song.title) || song.name.replace(/\.[^.]+$/, '');
  const artist = (o.artist ?? song.artist) || defaultArtist();
  const album = (o.album ?? song.album) || defaultAlbum();
  const bvid = `local-${song.id}`;
  return {
    id: bvid,
    bvid,
    type: 'local',
    source: 'local',
    title,
    author: artist,
    album,
    albumArtist: (o.albumArtist ?? song.albumArtist) || '',
    year: (o.year ?? song.year) || '',
    track: (o.track ?? song.track) || '',
    genre: (o.genre ?? song.genre) || '',
    cover: song.hasArt ? `/api/local/cover/${encodeURIComponent(song.id)}` : '',
    localId: song.id,
    duration: formatDuration(song.durationSec),
    durationSec: song.durationSec,
    play: 0,
    playText: '',
    isPay: false,
    format: song.format,
    size: song.size,
    sizeText: formatSize(song.size),
    bitrate: song.bitrate,
    path: song.path,
    folderId: song.folderId,
    addedAt: song.addedAt,
    broken: Boolean(song.broken),
    hasMetaOverride: Boolean(override && Object.keys(override).length),
  };
}

// ---------- IO ----------

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
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.filter((f) => f && f.id && f.path).map((f) => ({
            id: String(f.id), path: String(f.path), name: String(f.name || ''),
            addedAt: String(f.addedAt || ''), songCount: Number(f.songCount) || 0,
          }))
        : [],
      songs: Array.isArray(parsed.songs)
        ? parsed.songs.filter((s) => s && s.id).map(normalizeSong)
        : [],
      overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
      removedPaths: Array.isArray(parsed.removedPaths)
        ? parsed.removedPaths.filter((p) => typeof p === 'string' && p).slice(-MAX_REMOVED_PATHS)
        : [],
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

// ---------- 扫描 ----------

/** 递归收集音频文件路径。跳过隐藏目录与常见无关目录 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information', 'lost+found',
]);

async function walk(dir, out, depth) {
  if (depth > 12) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 权限不够 / 目录被删，跳过这一支
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      await walk(full, out, depth + 1);
    } else if (e.isFile() && isAudioFile(e.name)) {
      out.push(full);
    }
  }
}

async function scanFile(filePath, folderId) {
  const id = idForPath(filePath);
  let st;
  try {
    st = await stat(filePath);
  } catch {
    throw new Error('无法读取文件');
  }
  if (st.size === 0) throw new Error('空文件');
  if (st.size > MAX_SCAN_BYTES) throw new Error('文件过大');

  const { tags, format } = await readAudioInfo(filePath);
  return normalizeSong({
    id,
    folderId,
    path: filePath,
    name: basename(filePath),
    format,
    size: st.size,
    durationSec: tags.durationSec || 0,
    bitrate: tags.bitrate || estimateBitrate(st.size, tags.durationSec || 0),
    title: tags.title || '',
    artist: tags.artist || '',
    album: tags.album || '',
    albumArtist: tags.albumArtist || '',
    year: tags.year || '',
    track: tags.track || '',
    genre: tags.genre || '',
    hasArt: Boolean(tags.picture),
    addedAt: new Date().toISOString(),
  });
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  const jobs = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k += 1) {
    jobs.push((async () => {
      for (;;) {
        const idx = i;
        i += 1;
        if (idx >= items.length) return;
        await worker(items[idx], idx);
      }
    })());
  }
  await Promise.all(jobs);
}

// ---------- 对外 API ----------

export const library = {
  progress() {
    return { ...scanProgress };
  },

  async list() {
    const store = await load();
    return {
      folders: store.folders.map((f) => ({ ...f })),
      songs: store.songs.map((s) => serializeSong(s, store.overrides[s.id] || null)),
      total: store.songs.length,
    };
  },

  async songs() {
    const store = await load();
    return store.songs.map((s) => serializeSong(s, store.overrides[s.id] || null));
  },

  /** 分组浏览：artist / album / folder / genre / year */
  async groups(type) {
    const store = await load();
    const rows = store.songs.filter((s) => !s.broken);
    const map = new Map();

    const push = (key, song) => {
      const k = key || '';
      if (!map.has(k)) {
        map.set(k, {
          key: k, name: key || '未命名', songCount: 0, durationSec: 0,
          firstAddedAt: song.addedAt,
        });
      }
      const g = map.get(k);
      g.songCount += 1;
      g.durationSec += song.durationSec || 0;
      if (String(song.addedAt) < String(g.firstAddedAt)) g.firstAddedAt = song.addedAt;
    };

    for (const s of rows) {
      const o = store.overrides[s.id] || {};
      switch (type) {
        case 'album': push((o.album ?? s.album) || defaultAlbum(), s); break;
        case 'genre': push((o.genre ?? s.genre) || '未知流派', s); break;
        case 'year': push((o.year ?? s.year) || '未知年份', s); break;
        case 'folder': push(dirname(s.path), s); break;
        case 'artist':
        default:
          // 专辑歌手优先，没写就用歌曲歌手
          push((o.artist ?? s.artist) || defaultArtist(), s);
      }
    }

    return [...map.values()]
      .map((g) => ({ ...g, duration: formatDuration(g.durationSec) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  },

  async groupSongs(type, key) {
    const store = await load();
    const rows = store.songs.filter((s) => {
      if (s.broken) return false;
      const o = store.overrides[s.id] || {};
      let value;
      switch (type) {
        case 'album': value = (o.album ?? s.album) || defaultAlbum(); break;
        case 'genre': value = (o.genre ?? s.genre) || '未知流派'; break;
        case 'year': value = (o.year ?? s.year) || '未知年份'; break;
        case 'folder': value = dirname(s.path); break;
        case 'artist':
        default: value = (o.artist ?? s.artist) || defaultArtist();
      }
      return value === key;
    });
    return rows.map((s) => serializeSong(s, store.overrides[s.id] || null));
  },

  /** 扫描一个文件夹。已存在的曲目只刷新时长与标签，不重复入库 */
  async scanFolder(path) {
    const store = await load();
    if (!path || typeof path !== 'string') throw new Error('请指定文件夹路径');

    let st;
    try {
      st = await stat(path);
    } catch {
      throw new Error('文件夹不存在或无法访问');
    }
    if (!st.isDirectory()) throw new Error('该路径不是文件夹');

    let folder = store.folders.find((f) => f.path === path);
    if (!folder) {
      folder = {
        id: createHash('sha1').update(path.replace(/\\/g, '/')).digest('hex').slice(0, 12),
        path,
        name: basename(path),
        addedAt: new Date().toISOString(),
        songCount: 0,
      };
      store.folders.push(folder);
    }

    scanProgress = {
      running: true, phase: '发现文件', current: 0, total: 0,
      added: 0, failed: 0, folder: folder.path,
    };

    const files = [];
    await walk(path, files, 0);
    // 用户手动移出曲库的文件不再扫进来（文件还在磁盘上，只是不进曲库）
    const ignored = new Set(store.removedPaths);
    const targets = files.filter((f) => !ignored.has(f));
    scanProgress.total = targets.length;
    scanProgress.phase = '读取标签';

    const byId = new Map(store.songs.map((s) => [s.id, s]));
    const byPath = new Map(store.songs.map((s) => [s.path, s.id]));
    let touched = 0;

    await runPool(targets, async (file) => {
      scanProgress.current += 1;
      try {
        const song = await scanFile(file, folder.id);
        const existingId = byPath.get(file);
        if (existingId) {
          const prev = byId.get(existingId);
          // 保留原 addedAt 与 override 关联的 id，只刷新内容字段
          byId.set(song.id, { ...song, id: existingId, addedAt: prev.addedAt, broken: false });
          byPath.set(file, existingId);
        } else {
          byId.set(song.id, song);
          byPath.set(file, song.id);
          scanProgress.added += 1;
        }
        touched += 1;
      } catch {
        scanProgress.failed += 1;
      }
    }, SCAN_CONCURRENCY);

    // 用 byId 重建数组，保持原有顺序 + 新条目追加
    store.songs = [...byId.values()];
    folder.songCount = store.songs.filter((s) => s.folderId === folder.id).length;
    await persist();

    scanProgress = { ...scanProgress, running: false, phase: '完成' };
    return {
      folder: { ...folder },
      scanned: files.length,
      added: scanProgress.added,
      failed: scanProgress.failed,
      touched,
      songCount: folder.songCount,
      total: store.songs.length,
    };
  },

  /**
   * 追加单个文件（不走文件夹扫描）。m3u 导入用：文件可以散在不同目录，
   * 给它们建一个以 m3u 文件为名的「来源」记录，便于整批移除。
   */
  async addFiles(paths, sourceName) {
    const store = await load();
    if (!Array.isArray(paths) || !paths.length) return { added: 0, failed: 0 };

    // source 可以只给名字（字符串），也可以给 {name, path}：
    // 名字用于展示，path 记录来源文件的所在目录。
    const meta = sourceName && typeof sourceName === 'object' ? sourceName : { name: sourceName };
    const sourceKey = String(meta.name || '').trim() || '导入的曲目';
    let folder = store.folders.find((f) => f.name === sourceKey && f.id.startsWith('m3u-'));
    if (!folder) {
      folder = {
        id: `m3u-${createHash('sha1').update(sourceKey + Date.now()).digest('hex').slice(0, 8)}`,
        path: meta.path || '',
        name: sourceKey,
        addedAt: new Date().toISOString(),
        songCount: 0,
      };
      store.folders.push(folder);
    }

    const byPath = new Map(store.songs.map((s) => [s.path, s.id]));
    let added = 0;
    let failed = 0;

    for (const p of paths) {
      if (typeof p !== 'string' || !p || byPath.has(p)) continue;
      try {
        const song = await scanFile(p, folder.id);
        store.songs.push(song);
        byPath.set(p, song.id);
        added += 1;
      } catch {
        failed += 1;
      }
    }

    folder.songCount = store.songs.filter((s) => s.folderId === folder.id).length;
    await persist();
    return { folder: { ...folder }, added, failed, total: store.songs.length };
  },

  async removeFolder(id) {
    const store = await load();
    const idx = store.folders.findIndex((f) => f.id === String(id));
    if (idx < 0) return null;
    const [folder] = store.folders.splice(idx, 1);
    const removed = store.songs.filter((s) => s.folderId === folder.id).map((s) => s.id);
    const idSet = new Set(removed);
    store.songs = store.songs.filter((s) => !idSet.has(s.id));
    for (const sid of removed) {
      delete store.overrides[sid];
      artCache.delete(sid);
    }
    await persist();
    return { folder, removed: removed.length, total: store.songs.length };
  },

  /**
   * 修库：重新检查已监控文件夹下的文件是否还在。
   * 被删/移动的文件标成 broken 而不是直接删掉——用户可能是临时挪走了。
   */
  async repair() {
    const store = await load();
    let missing = 0;
    let restored = 0;
    let added = 0;

    for (const folder of store.folders) {
      const files = [];
      await walk(folder.path, files, 0);
      const found = new Set(files);
      let folderTotal = 0;

      for (const song of store.songs) {
        if (song.folderId !== folder.id) continue;
        folderTotal += 1;
        if (found.has(song.path)) {
          if (song.broken) { song.broken = false; restored += 1; }
        } else {
          song.broken = true;
          missing += 1;
        }
      }

      // 新出现的文件补进来。手动移出曲库的除外——
      // 否则「修库」会把用户刚删掉的歌全部带回来。
      const known = new Set(store.songs.filter((s) => s.folderId === folder.id).map((s) => s.path));
      const ignored = new Set(store.removedPaths);
      const fresh = files.filter((f) => !known.has(f) && !ignored.has(f));
      await runPool(fresh, async (file) => {
        try {
          const song = await scanFile(file, folder.id);
          store.songs.push(song);
          added += 1;
          folderTotal += 1;
        } catch { /* 单个文件失败不影响其他 */ }
      }, SCAN_CONCURRENCY);

      folder.songCount = folderTotal;
    }

    await persist();
    return { missing, restored, added, total: store.songs.length };
  },

  async get(id) {
    const store = await load();
    const hit = store.songs.find((s) => s.id === normId(id));
    if (!hit) return null;
    return serializeSong(hit, store.overrides[hit.id] || null);
  },

  /** 原始记录（未套本地覆盖）。给 .lrc 匹配用：歌词文件名常按标签里的歌名取 */
  async raw(id) {
    const store = await load();
    return store.songs.find((s) => s.id === normId(id)) || null;
  },

  async rawPath(id) {
    const store = await load();
    const hit = store.songs.find((s) => s.id === normId(id));
    return hit ? hit.path : null;
  },

  /** 元数据本地覆盖（不改动原文件的标签） */
  async updateMeta(id, patch) {
    const store = await load();
    const hit = store.songs.find((s) => s.id === normId(id));
    if (!hit) return null;
    const cur = store.overrides[hit.id] || {};
    const next = { ...cur };
    const KEYS = ['title', 'artist', 'album', 'albumArtist', 'year', 'track', 'genre'];
    for (const k of KEYS) {
      if (patch[k] !== undefined) {
        const v = String(patch[k]).replace(/\s+/g, ' ').trim().slice(0, 200);
        // 空值，或填回了和原标签一样的值，都算「恢复原标签」。
        // 不留一条等于原值的覆盖，否则 hasMetaOverride 会一直是 true，
        // 前端就一直提示「标签已修改」而实际上什么都没变。
        if (v && v !== (hit[k] || '')) next[k] = v;
        else delete next[k];
      }
    }
    if (Object.keys(next).length) store.overrides[hit.id] = next;
    else delete store.overrides[hit.id];
    await persist();
    artCache.delete(hit.id);
    return serializeSong(hit, store.overrides[hit.id] || null);
  },

  async clearOverrides(id) {
    const store = await load();
    const hit = store.songs.find((s) => s.id === normId(id));
    if (!hit) return null;
    delete store.overrides[hit.id];
    await persist();
    return serializeSong(hit, null);
  },

  async removeSongs(ids) {
    const store = await load();
    const set = new Set((Array.isArray(ids) ? ids : []).map((i) => normId(i)));
    if (!set.size) return { removed: 0 };
    const before = store.songs.length;
    const removed = store.songs.filter((s) => set.has(s.id));
    store.songs = store.songs.filter((s) => !set.has(s.id));
    for (const f of store.folders) {
      f.songCount = store.songs.filter((s) => s.folderId === f.id).length;
    }
    // 记到黑名单：重新扫描/修库时这些文件不会被再扫进来
    for (const s of removed) {
      if (!store.removedPaths.includes(s.path)) store.removedPaths.push(s.path);
    }
    store.removedPaths = store.removedPaths.slice(-MAX_REMOVED_PATHS);
    await persist();
    return { removed: before - store.songs.length, total: store.songs.length };
  },

  /** 疑似重复：标题 + 歌手 + 时长三者一致 */
  async duplicates() {
    const store = await load();
    const groups = new Map();
    for (const s of store.songs) {
      if (s.broken) continue;
      const o = store.overrides[s.id] || {};
      const key = [
        ((o.title ?? s.title) || s.name.replace(/\.[^.]+$/, '')).toLowerCase(),
        ((o.artist ?? s.artist) || '').toLowerCase(),
        Math.round(s.durationSec),
      ].join('\u0001');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(serializeSong(s, o || null));
    }
    return [...groups.values()].filter((g) => g.length > 1);
  },

  /** 内存缓存封面字节；命中不了就现读文件 */
  async art(id) {
    const key = normId(id);
    const cached = artCache.get(key);
    if (cached) return cached;
    const store = await load();
    const hit = store.songs.find((s) => s.id === key);
    if (!hit) return null;
    try {
      const { tags } = await readAudioInfo(hit.path);
      if (!tags.picture) return null;
      artCache.set(key, tags.picture);
      if (artCache.size > ART_CACHE_MAX) {
        const first = artCache.keys().next().value;
        artCache.delete(first);
      }
      return tags.picture;
    } catch {
      return null;
    }
  },

  async count() {
    return (await load()).songs.length;
  },

  /**
   * 仅测试用：丢弃内存缓存，让下一次访问重新读盘。
   * 没有它没法在同一个进程里验证「进程重启后从文件恢复」这条路。
   */
  _resetForTest() {
    cache = null;
    loadPromise = null;
    saveChain = Promise.resolve();
    for (const k of artCache.keys()) artCache.delete(k);
  },
};
