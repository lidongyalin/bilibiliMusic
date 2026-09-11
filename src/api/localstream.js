import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * 本地文件流。浏览器播放本地音频必须走后端——渲染进程没有文件系统权限，
 * 而 file:// URL 又过不了导航守卫。
 *
 * Range 必须支持：播放器的拖进度条就是靠它。
 * 与 src/api/stream.js 的区别是数据源是本机文件，没有上游超时和防盗链。
 *
 * 并发安全：每个请求各自持有自己的 Readable，不共享模块级引用。
 */

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

/** 解析 `bytes=start-end`。返回 { start, end } 或 null（格式不合法） */
export function parseRange(rangeHeader, total) {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  if (!m[1] && !m[2]) return null;

  let start;
  let end;
  if (m[1]) {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : total - 1;
  } else {
    // 后缀范围 bytes=-N 表示「最后 N 个字节」
    const n = Number(m[2]);
    start = Math.max(0, total - n);
    end = total - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  start = Math.max(0, Math.floor(start));
  end = Math.min(total - 1, Math.floor(end));
  if (start > end) return null;
  return { start, end };
}

export function mimeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export async function handleLocalFile(req, res, filePath) {
  if (!filePath) {
    res.status(404).json({ error: '曲目不存在' });
    return;
  }

  let st;
  try {
    st = await stat(filePath);
  } catch {
    res.status(404).json({ error: '文件不存在或已被移动' });
    return;
  }
  if (!st.isFile()) {
    res.status(400).json({ error: '该路径不是文件' });
    return;
  }

  const total = st.size;
  res.setHeader('Content-Type', mimeFor(filePath));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0');

  const range = parseRange(req.headers.range, total);
  const start = range ? range.start : 0;
  const end = range ? range.end : total - 1;

  res.status(range ? 206 : 200);
  if (range) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  }
  res.setHeader('Content-Length', String(end - start + 1));

  const stream = createReadStream(filePath, { start, end });
  let closed = false;
  req.on('close', () => {
    // 客户端切歌或关页面时会中止请求，主动销毁读流避免句柄泄漏
    if (!closed) {
      closed = true;
      stream.destroy();
    }
  });

  try {
    await pipeline(stream, res);
  } catch {
    // 客户端中止播放会抛 ERR_STREAM_PREMATURE_CLOSE，属正常情况
  } finally {
    closed = true;
  }
}
