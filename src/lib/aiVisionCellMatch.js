import { callGeminiVision } from './aiVisionGemini.js'

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function parsePing(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*P/i)
  return match ? Number(match[1]) : null
}

function parseMultiplier(text) {
  const match = String(text || '').match(/\*\s*(\d+)/)
  return match ? Math.max(1, Number(match[1]) || 1) : 1
}

function bboxOf(points) {
  const xs = points.map(point => point.x).filter(finite)
  const ys = points.map(point => point.y).filter(finite)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

function boxCenter(box) {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

function boxDistance(a, b) {
  const ac = boxCenter(a)
  const bc = boxCenter(b)
  return Math.hypot(ac.x - bc.x, ac.y - bc.y)
}

function labelBox(label) {
  const p = label.pdfPoint || {}
  return { minX: p.x - 1, minY: p.y - 1, maxX: p.x + 1, maxY: p.y + 1 }
}

function cropSelection(labels, cells, crop) {
  const points = [
    ...labels.map(label => label.pdfPoint).filter(Boolean),
    ...cells.flatMap(cell => cell.polygonPdf || []),
  ]
  if (!points.length) return { sx: 0, sy: 0, sw: crop.width, sh: crop.height }
  const box = bboxOf(points)
  const pad = 90
  const sx = Math.max(0, Math.floor(box.minX - pad))
  const sy = Math.max(0, Math.floor(box.minY - pad))
  const ex = Math.min(crop.width, Math.ceil(box.maxX + pad))
  const ey = Math.min(crop.height, Math.ceil(box.maxY + pad))
  return { sx, sy, sw: Math.max(1, ex - sx), sh: Math.max(1, ey - sy) }
}

function normalizeMatches(payload) {
  const raw = Array.isArray(payload) ? payload : (payload?.matches || [])
  return raw
    .map(item => ({
      label: String(item.label || item.labelText || '').trim(),
      cellIds: (item.cellIds || item.cells || item.cellId || [])
        ? Array.isArray(item.cellIds || item.cells || item.cellId)
          ? (item.cellIds || item.cells || item.cellId)
          : [item.cellIds || item.cells || item.cellId]
        : [],
      confidence: Number(item.confidence ?? 0),
    }))
    .map(item => ({
      ...item,
      cellIds: item.cellIds.map(id => String(id).trim()).filter(Boolean),
    }))
    .filter(item => item.label && item.cellIds.length && item.confidence >= 0.55)
}

function cellMatchesLabelPing(cell, label) {
  if (!finite(cell?.framePing) || !finite(label?.ping)) return false
  return cell.framePing >= label.ping * 0.45 && cell.framePing <= label.ping * 1.65
}

export async function matchSmallRoomCellsVision({
  imageUrl,
  labels,
  candidateCells,
  crop,
  maxPing = 6,
}) {
  if (!imageUrl || !crop || !labels?.length || !candidateCells?.length) return []
  const smallLabels = labels
    .map(label => ({
      ...label,
      labelText: label.labelText || label.text || label.name || '',
      ping: finite(label.ping) ? label.ping : parsePing(label.labelText || label.text || label.name),
      multiplier: parseMultiplier(label.labelText || label.text || label.name),
    }))
    .filter(label => finite(label.ping) && label.ping <= maxPing && label.pdfPoint)
  if (!smallLabels.length) return []

  const nearbyCells = []
  const seen = new Set()
  for (const label of smallLabels) {
    const candidates = candidateCells
      .filter(cell => cell.polygonPdf?.length >= 3 && cellMatchesLabelPing(cell, label))
      .map(cell => ({ cell, distance: boxDistance(labelBox(label), cell.bboxPdf || bboxOf(cell.polygonPdf)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(4, label.multiplier + 3))
    for (const { cell } of candidates) {
      if (seen.has(cell.id)) continue
      seen.add(cell.id)
      nearbyCells.push(cell)
    }
  }
  if (!nearbyCells.length) return []

  const bitmap = await fetch(imageUrl).then(res => {
    if (!res.ok) throw new Error('底圖下載失敗 ' + res.status)
    return res.blob()
  }).then(blob => createImageBitmap(blob))
  const { sx, sy, sw, sh } = cropSelection(smallLabels, nearbyCells, crop)
  const maxDim = 1600
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  const toCanvas = point => ({ x: (point.x - sx) * scale, y: (point.y - sy) * scale })
  const toNorm = point => ({ x: (point.x - sx) / sw, y: (point.y - sy) / sh })
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dw, dh)
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)

  ctx.save()
  ctx.lineWidth = Math.max(3, Math.round(Math.min(dw, dh) * 0.004))
  ctx.font = `${Math.max(18, Math.round(Math.min(dw, dh) * 0.026))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  nearbyCells.forEach((cell, index) => {
    const pts = cell.polygonPdf.map(toCanvas)
    ctx.beginPath()
    pts.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(239,68,68,0.08)'
    ctx.strokeStyle = '#ef4444'
    ctx.fill()
    ctx.stroke()
    const box = bboxOf(pts)
    const label = String(index + 1)
    cell._visionId = label
    ctx.fillStyle = '#ef4444'
    ctx.fillRect((box.minX + box.maxX) / 2 - 16, (box.minY + box.maxY) / 2 - 16, 32, 32)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2)
  })
  smallLabels.forEach((label, index) => {
    const p = toCanvas(label.pdfPoint)
    const text = String.fromCharCode(65 + index)
    label._visionId = text
    ctx.fillStyle = '#2563eb'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, p.x, p.y)
  })
  ctx.restore()

  const prompt = `你正在看辦公室平面圖局部圖。

紅框數字是程式已經從 DXF 算好的候選小房間格子，藍色英文字母是 PDF 文字標籤位置。

任務：
請把每個藍色標籤配對到正確的紅框格子。這是連連看，不要畫框。
如果標籤文字包含 *2，代表同一標籤要配到兩個紅框格子。
只輸出看得到且合理的配對；不確定就降低 confidence，但不要自己創造 cell。

標籤清單：
${smallLabels.map(label => `- ${label._visionId}: "${label.labelText}", ping=${label.ping}, needCells=${label.multiplier}`).join('\n')}

候選格子：
${nearbyCells.map(cell => {
    const box = cell.bboxPdf || bboxOf(cell.polygonPdf)
    const center = toNorm(boxCenter(box))
    return `- ${cell._visionId}: framePing=${cell.framePing}, center=[${center.x.toFixed(3)},${center.y.toFixed(3)}]`
  }).join('\n')}

請只輸出 JSON：
{
  "matches": [
    {"label":"主管辦公室B 2.7P*2","cellIds":["1","6"],"confidence":0.9}
  ]
}`
  const parsed = await callGeminiVision(canvas.toDataURL('image/png').split(',')[1], 'image/png', prompt, {
    systemInstruction: '你是 CAD 平面圖房間標籤配對器。只能做標籤到候選格子的配對，不要輸出座標。'
  })
  const labelByText = new Map(smallLabels.map(label => [label.labelText, label]))
  const cellByVisionId = new Map(nearbyCells.map(cell => [cell._visionId, cell]))
  return normalizeMatches(parsed)
    .flatMap(match => {
      const label = labelByText.get(match.label)
      if (!label) return []
      return match.cellIds
        .map(cellId => cellByVisionId.get(cellId))
        .filter(cell => cell && cellMatchesLabelPing(cell, label))
        .slice(0, label.multiplier)
        .map((cell, index) => ({
          label,
          cell,
          name: label.multiplier > 1 ? `${label.labelText} #${index + 1}` : label.labelText,
          confidence: match.confidence,
        }))
    })
}
