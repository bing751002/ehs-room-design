function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function round(n, digits = 4) {
  return Number(n.toFixed(digits))
}

function normPoint(point, width, height) {
  return {
    x: round(Math.max(0, Math.min(1, (point?.x ?? 0) / Math.max(1, width)))),
    y: round(Math.max(0, Math.min(1, (point?.y ?? 0) / Math.max(1, height)))),
  }
}

function lineStats(lines) {
  const stats = new Map()
  for (const line of lines || []) {
    const layer = line.layer || '(none)'
    const stat = stats.get(layer) || { layer, count: 0, horiz: 0, vert: 0 }
    stat.count += 1
    const dx = Math.abs((line.x2 ?? 0) - (line.x1 ?? 0))
    const dy = Math.abs((line.y2 ?? 0) - (line.y1 ?? 0))
    if (dx > dy * 4) stat.horiz += 1
    else if (dy > dx * 4) stat.vert += 1
    stats.set(layer, stat)
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
}

function compactTextItems(textItems, width, height) {
  return (textItems || [])
    .filter(item => String(item.text || '').trim())
    .filter(item => item.kind === 'room-label' || /\d+(?:\.\d+)?\s*P/i.test(item.text || ''))
    .slice(0, 40)
    .map(item => ({
      text: String(item.text || '').trim(),
      kind: item.kind || 'text',
      point: normPoint(item.pdfPoint, width, height),
    }))
}

function compactRooms(rooms, width, height) {
  return (rooms || [])
    .filter(room => room.matched && room.polygonPdf?.length >= 3)
    .slice(0, 35)
    .map(room => ({
      name: room.name || room.labelText,
      label: room.labelText || room.name,
      ping: finite(room.ping) ? round(room.ping, 2) : null,
      framePing: finite(room.framePing) ? round(room.framePing, 2) : null,
      vertices: room.polygonPdf.map(point => normPoint(point, width, height)),
    }))
}

export function buildGeminiDxfPdfHint(baseLayer) {
  if (baseLayer?.importMode !== 'dxf-pdf' || !baseLayer?.pdfImport?.crop) return ''

  const width = baseLayer.pdfImport.crop.width || baseLayer.width || 1
  const height = baseLayer.pdfImport.crop.height || baseLayer.height || 1
  const preview = baseLayer.pdfImport.preview || {}
  const payload = {
    coordinate_system: 'pdf-crop-normalized',
    instruction: [
      'Use this as geometry/OCR evidence, not as the final answer.',
      'Prefer PDF text labels for room names and ping values.',
      'Use matched_rooms as high-confidence room candidates.',
      'For open areas without matched_rooms, infer from furniture clusters and nearby labels in the image.',
      'Return every space in normalized 0-1 coordinates relative to the PDF crop image.',
    ],
    crop: { width, height },
    alignment: preview.meta || {},
    overlay_layers: lineStats(baseLayer.previewLines || []),
    pdf_text_labels: compactTextItems(baseLayer.pdfImport.textItems || [], width, height),
    matched_rooms: compactRooms(preview.rooms || [], width, height),
  }

  return [
    '# DXF/PDF structured hint',
    'coordinate_system: pdf-crop-normalized',
    'The image is the cropped PDF floor plan. The following data was extracted from the paired DXF and aligned to the same PDF crop.',
    JSON.stringify(payload, null, 2),
  ].join('\n')
}
