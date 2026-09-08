/**
 * 内联 SVG 图标（仅存 <svg> 内的路径）。
 * Element Plus 图标集缺少「列表循环 / 单曲循环 / 随机 / 带波纹的音量」这几款语义精确的图形，
 * 播放控制用自绘 SVG，界面控件（搜索、星标、上下曲、播放暂停）继续用 Element Plus 图标。
 */

export const ICON_PATHS = {
  // 顺序播放：整列表循环
  listRepeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>' +
    '<path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',

  // 单曲循环
  singleRepeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>' +
    '<path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>' +
    '<path d="M11 10.4h1.5v4.9"/><path d="M9.6 12.1h4.3"/>',

  // 随机播放
  shuffle:
    '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/>' +
    '<path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/>' +
    '<path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',

  // 音量：高 / 低 / 静音
  volumeHigh:
    '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>' +
    '<path d="M19 5a10 10 0 0 1 0 14"/>',
  volumeLow:
    '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  volumeMute:
    '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',

  // 空状态的音符
  music:
    '<path d="M9 18V7l11-2v11"/><circle cx="6.5" cy="18" r="2.5"/>' +
    '<circle cx="17.5" cy="16" r="2.5"/>',
}

export const MODE_ICONS = {
  list: ICON_PATHS.listRepeat,
  single: ICON_PATHS.singleRepeat,
  shuffle: ICON_PATHS.shuffle,
}

export const MODE_LABELS = {
  list: '顺序播放',
  single: '单曲循环',
  shuffle: '随机播放',
}

export function volumeIconPath(muted, volume) {
  if (muted || volume === 0) return ICON_PATHS.volumeMute
  return volume < 0.55 ? ICON_PATHS.volumeLow : ICON_PATHS.volumeHigh
}
