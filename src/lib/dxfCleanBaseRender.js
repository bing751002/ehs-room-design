function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function fmt(n) {
  if (!finite(n)) return '0'
  return Number(n.toFixed(3)).toString()
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function computeLineBbox(lines) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const line of lines || []) {
    if (!finite(line.x1) || !finite(line.y1) || !finite(line.x2) || !finite(line.y2)) continue
    minX = Math.min(minX, line.x1, line.x2)
    minY = Math.min(minY, line.y1, line.y2)
    maxX = Math.max(maxX, line.x1, line.x2)
    maxY = Math.max(maxY, line.y1, line.y2)
  }

  if (!finite(minX)) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function layerColor(layer) {
  const text = String(layer || '')
  if (text.includes('窗') || text.toLowerCase().includes('window') || text.includes('帷幕')) return '#0284c7'
  if (text.includes('門') || text.toLowerCase().includes('door')) return '#475569'
  if (text.includes('柱')) return '#111827'
  if (text.includes('牆') || text.includes('隔間') || text.toLowerCase().includes('wall')) return '#334155'
  return '#64748b'
}

function layerStrokeWidth(layer, baseStroke) {
  const text = String(layer || '')
  if (text.includes('柱')) return baseStroke * 2.2
  if (text.includes('牆') || text.includes('隔間') || text.toLowerCase().includes('wall')) return baseStroke * 1.6
  return baseStroke
}

export function renderLinesToSvg(lines, bbox = computeLineBbox(lines), options = {}) {
  const pad = options.padding ?? Math.max(bbox.width, bbox.height) * 0.02
  const viewMinX = bbox.minX - pad
  const viewMinY = bbox.minY - pad
  const viewWidth = bbox.width + pad * 2
  const viewHeight = bbox.height + pad * 2
  const maxDim = Math.max(viewWidth, viewHeight)
  const baseStroke = options.strokeWidth ?? Math.max(maxDim / 2400, 0.35)
  const y = value => bbox.maxY + pad - (value - bbox.minY)

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewMinX)} ${fmt(viewMinY)} ${fmt(viewWidth)} ${fmt(viewHeight)}" font-family="Arial, 'Noto Sans TC', sans-serif">`,
  ]

  if (options.title) parts.push(`<title>${escapeXml(options.title)}</title>`)
  parts.push(`<rect x="${fmt(viewMinX)}" y="${fmt(viewMinY)}" width="${fmt(viewWidth)}" height="${fmt(viewHeight)}" fill="#ffffff"/>`)
  parts.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">')

  for (const line of lines || []) {
    if (!finite(line.x1) || !finite(line.y1) || !finite(line.x2) || !finite(line.y2)) continue
    const layer = line.layer || ''
    parts.push(
      `<line x1="${fmt(line.x1)}" y1="${fmt(y(line.y1))}" x2="${fmt(line.x2)}" y2="${fmt(y(line.y2))}" stroke="${layerColor(layer)}" stroke-width="${fmt(layerStrokeWidth(layer, baseStroke))}" data-layer="${escapeXml(layer)}"/>`
    )
  }

  parts.push('</g>')

  for (const overlay of options.overlays || []) {
    const overlayLines = overlay.lines || []
    if (!overlayLines.length) continue
    const stroke = overlay.stroke || '#f59e0b'
    const strokeWidth = overlay.strokeWidth ?? baseStroke * 1.5
    const opacity = overlay.opacity ?? 0.5
    const name = overlay.name || 'overlay'
    parts.push(
      `<g fill="none" stroke="${escapeXml(stroke)}" stroke-width="${fmt(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmt(opacity)}" data-overlay="${escapeXml(name)}">`
    )
    for (const line of overlayLines) {
      if (!finite(line.x1) || !finite(line.y1) || !finite(line.x2) || !finite(line.y2)) continue
      const layer = line.layer || ''
      parts.push(
        `<line x1="${fmt(line.x1)}" y1="${fmt(y(line.y1))}" x2="${fmt(line.x2)}" y2="${fmt(y(line.y2))}" data-layer="${escapeXml(layer)}"/>`
      )
    }
    parts.push('</g>')
  }

  if (options.texts?.length) {
    const defaultTextHeight = Math.max(maxDim / 260, 180)
    parts.push('<g fill="#0f172a" stroke="none" text-anchor="middle">')
    for (const text of options.texts) {
      if (!finite(text.x) || !finite(text.y) || !text.text) continue
      const layer = text.layer || ''
      const size = Math.max(80, Math.min(defaultTextHeight, text.height || defaultTextHeight))
      const tx = fmt(text.x)
      const ty = fmt(y(text.y))
      const rotation = finite(text.rotation) ? text.rotation : 0
      const transform = rotation ? ` transform="rotate(${fmt(-rotation)} ${tx} ${ty})"` : ''
      parts.push(
        `<text x="${tx}" y="${ty}" font-size="${fmt(size)}" data-layer="${escapeXml(layer)}"${transform}>${escapeXml(text.text)}</text>`
      )
    }
    parts.push('</g>')
  }

  parts.push('</svg>')
  return parts.join('\n')
}

export function summarizeLines(lines, meta = {}, bbox = computeLineBbox(lines)) {
  const layers = {}
  const sourceTypes = {}

  for (const line of lines || []) {
    layers[line.layer || '(none)'] = (layers[line.layer || '(none)'] || 0) + 1
    sourceTypes[line.sourceType || '(unknown)'] = (sourceTypes[line.sourceType || '(unknown)'] || 0) + 1
  }

  return {
    lineCount: (lines || []).length,
    bbox,
    layers,
    sourceTypes,
    dropped: meta.dropped || {},
  }
}
