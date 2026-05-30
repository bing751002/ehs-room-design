export function countTextWidth(text) {
  let width = 0
  for (const ch of String(text || '')) {
    if (/[\u4e00-\u9fa5\u3000-\u303f]/.test(ch)) width += 1
    else width += 0.55
  }
  return width
}

export function formatDxfPing(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function formatDxfLabel(name, ping) {
  const roomName = String(name || '').trim()
  const pingText = formatDxfPing(ping)
  return pingText ? `${roomName} ${pingText}P` : roomName
}

export function measureDxfLabelBox(text, fontSize) {
  const size = Math.max(1, Number(fontSize) || 1)
  return {
    width: Math.max(size * 4.5, countTextWidth(text) * size * 0.64 + size * 1.6),
    height: size * 1.6,
    strokeWidth: Math.max(0.8, size * 0.055),
  }
}

export function resolveDxfLabelFontSize(fontMain) {
  const base = Number(fontMain)
  if (!Number.isFinite(base)) return 24
  return Math.max(22, Math.min(base * 0.55, 36))
}
