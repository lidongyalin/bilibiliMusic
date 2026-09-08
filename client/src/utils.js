/** 秒数 → "4:03" / "1:02:03" */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  sec = Math.floor(sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

export function debounce(fn, wait = 300) {
  let timer = 0
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => clearTimeout(timer)
  return wrapped
}

/** 提示文案里的长标题截断 */
export function clip(text, max = 16) {
  const s = String(text || '')
  return s.length > max ? s.slice(0, max) + '…' : s
}
