import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG } from '../config.js';

/**
 * 应用设置。跨进程共享：Electron 主进程要读「关闭窗口行为」来决定
 * close 事件怎么放行，渲染进程要读同一份来显示设置面板。
 *
 * 走后端而不是写死在主进程，这样 CLI 模式也能改，两个进程永远看同一份。
 * 主进程在需要决策时现取一次（/api/settings），不轮询。
 */

const FILE = join(CONFIG.DATA_DIR, 'settings.json');

/** 允许写入的键与取值。未知键直接丢弃，避免把调试残留持久化下来 */
const SCHEMA = {
  /** 点窗口关闭按钮时的行为 */
  closeBehavior: { type: 'enum', values: ['ask', 'tray', 'quit'], default: 'ask' },
  /** 关闭窗口时是否再次确认（closeBehavior 是 tray/quit 时无意义） */
  confirmClose: { type: 'bool', default: true },
  /** 迷你模式窗口几何 */
  miniWidth: { type: 'int', min: 320, max: 900, default: 460 },
  miniHeight: { type: 'int', min: 220, max: 500, default: 280 },
  /** 桌面歌词窗口几何 */
  desktopLyricsWidth: { type: 'int', min: 320, max: 1200, default: 640 },
  desktopLyricsHeight: { type: 'int', min: 180, max: 700, default: 260 },
};

let cache = null;
let loadPromise = null;
let saveChain = Promise.resolve();

function defaults() {
  const out = {};
  for (const [k, def] of Object.entries(SCHEMA)) out[k] = def.default;
  return out;
}

/**
 * 把传入值规整成该键的合法值；整型会夹到 [min,max]。
 *
 * 返回 null 表示「这个值不合法，应该丢弃」——而不是回落成默认值。
 * 区别很重要：用户把 关闭行为 从 tray 改成打错的字符串时，
 * 回落成 ask 会把上一个设置悄悄改掉，丢弃才能保住原值。
 */
function coerce(key, raw) {
  const def = SCHEMA[key];
  if (!def) return undefined;
  switch (def.type) {
    case 'bool': return Boolean(raw);
    case 'int': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return Math.max(def.min, Math.min(def.max, Math.round(n)));
    }
    case 'enum': return def.values.includes(raw) ? raw : null;
    default: return null;
  }
}

function load() {
  if (cache) return Promise.resolve(cache);
  if (!loadPromise) loadPromise = doLoad().finally(() => (loadPromise = null));
  return loadPromise;
}

async function doLoad() {
  const base = defaults();
  try {
    const text = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(text);
    for (const [k, v] of Object.entries(parsed || {})) {
      const c = coerce(k, v);
      if (c !== undefined && c !== null) base[k] = c;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[settings] 读取失败，用默认值：${err.message}`);
  }
  cache = base;
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

export const settings = {
  schema() {
    return Object.fromEntries(
      Object.entries(SCHEMA).map(([k, v]) => [k, { ...v }])
    );
  },

  async all() {
    return { ...(await load()) };
  },

  async get(key) {
    const s = await load();
    const v = s[key];
    return v === undefined ? SCHEMA[key] ? SCHEMA[key].default : undefined : v;
  },

  async set(key, value) {
    const s = await load();
    const c = coerce(key, value);
    if (c === undefined || c === null) return null;
    if (s[key] === c) return s[key];
    s[key] = c;
    await persist();
    return c;
  },

  async update(patch) {
    const s = await load();
    const next = { ...s };
    const changed = {};
    for (const [k, v] of Object.entries(patch || {})) {
      const c = coerce(k, v);
      // null = 值不合法，跳过而不是回落成默认值
      if (c === undefined || c === null) continue;
      if (c !== s[k]) {
        next[k] = c;
        changed[k] = c;
      }
    }
    if (Object.keys(changed).length) {
      cache = next;
      await persist();
    }
    return { ...next };
  },
};
