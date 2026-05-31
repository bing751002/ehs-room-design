import { extractDxfPreviewContent } from './dxfPreview.js'
import { extractOpeningObjects } from './dxfSpaceExtract.js'

const PING_M2 = 3.305785

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function parsePing(text) {
  const match = cleanText(text).match(/(\d+(?:\.\d+)?)\s*P/i)
  return match ? Number(match[1]) : null
}

function parsePingOptions(text) {
  const value = cleanText(text)
  const match = value.match(/(\d+(?:\.\d+)?)\s*P(?:\s*\*\s*(\d+))?/i)
  if (!match) return []
  const base = Number(match[1])
  const multiplier = match[2] ? Number(match[2]) : 1
  const options = [base]
  if (finite(base) && finite(multiplier) && multiplier > 1) {
    const total = Number((base * multiplier).toFixed(3))
    if (Math.abs(total - base) > 0.001) options.push(total)
  }
  return options.filter(finite)
}

function roomName(text) {
  return cleanText(text).replace(/\s*\d+(?:\.\d+)?\s*P.*$/i, '').trim()
}

function isRoomNameOnly(text) {
  const value = cleanText(text)
  if (parsePing(value) != null) return false
  return /[\u4e00-\u9fff]/.test(value) && /(室|區|辦公|會議|顧問|茶水|洽談|金庫|等候|休息)/.test(value)
}

function isPingOnly(text) {
  return /^\d+(?:\.\d+)?\s*P(?:\s*\*\s*\d+)?$/i.test(cleanText(text))
}

function centerOfPdfBox(item) {
  const box = item.pdfBox || {}
  return {
    x: ((box.x0 ?? 0) + (box.x1 ?? 0)) / 2,
    y: ((box.y0 ?? 0) + (box.y1 ?? 0)) / 2,
  }
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

function bboxDistance(point, box) {
  const dx = point.x < box.minX ? box.minX - point.x : point.x > box.maxX ? point.x - box.maxX : 0
  const dy = point.y < box.minY ? box.minY - point.y : point.y > box.maxY ? point.y - box.maxY : 0
  return Math.hypot(dx, dy)
}

function shoelace(points) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

function centroid(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function pointInPolygon(point, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x
    const yi = points[i].y
    const xj = points[j].x
    const yj = points[j].y
    const crosses = (yi > point.y) !== (yj > point.y)
    if (crosses && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function normalizePdfRoomLabels(textItems) {
  const labels = []
  const pingOnly = (textItems || [])
    .filter(item => isPingOnly(item.text))
    .map((item, index) => ({ ...item, index, center: centerOfPdfBox(item), used: false }))

  for (const item of textItems || []) {
    const text = cleanText(item.text)
    const ping = parsePing(text)
    if (ping != null && /[\u4e00-\u9fff]/.test(text)) {
      labels.push({
        labelText: text,
        name: roomName(text),
        ping,
        pingOptions: parsePingOptions(text),
        pdfPoint: item.pdfPoint || centerOfPdfBox(item),
        cleanPoint: item.dxfPoint,
        source: 'embedded-ping',
      })
      continue
    }

    if (!isRoomNameOnly(text)) continue
    const center = centerOfPdfBox(item)
    let best = null
    for (const candidate of pingOnly) {
      if (candidate.used) continue
      const dx = Math.abs(candidate.center.x - center.x)
      const dy = candidate.center.y - center.y
      if (dx > 45 || dy < 4 || dy > 32) continue
      const distance = Math.hypot(dx, dy)
      if (!best || distance < best.distance) best = { candidate, distance }
    }
    if (!best) continue
    best.candidate.used = true
    const mergedPing = parsePing(best.candidate.text)
      labels.push({
        labelText: `${text} ${cleanText(best.candidate.text)}`,
        name: text,
        ping: mergedPing,
        pingOptions: parsePingOptions(best.candidate.text),
        pdfPoint: {
        x: ((item.pdfPoint?.x ?? center.x) + (best.candidate.pdfPoint?.x ?? best.candidate.center.x)) / 2,
        y: ((item.pdfPoint?.y ?? center.y) + (best.candidate.pdfPoint?.y ?? best.candidate.center.y)) / 2,
      },
      cleanPoint: item.dxfPoint && best.candidate.dxfPoint ? {
        x: (item.dxfPoint.x + best.candidate.dxfPoint.x) / 2,
        y: (item.dxfPoint.y + best.candidate.dxfPoint.y) / 2,
      } : item.dxfPoint,
      source: 'merged-name-ping',
    })
  }

  return labels
    .filter(label => finite(label.ping) && label.ping >= 1 && label.ping <= 120 && label.cleanPoint)
    .sort((a, b) => b.ping - a.ping || a.pdfPoint.y - b.pdfPoint.y || a.pdfPoint.x - b.pdfPoint.x)
}

function localInsertTransform(insertEntity, block, parentTransform) {
  const bx = block.position?.x || 0
  const by = block.position?.y || 0
  const px = insertEntity.position?.x || 0
  const py = insertEntity.position?.y || 0
  const sx = insertEntity.xScale ?? 1
  const sy = insertEntity.yScale ?? 1
  const r = (insertEntity.rotation || 0) * Math.PI / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return (x, y) => {
    const ax = (x - bx) * sx
    const ay = (y - by) * sy
    return parentTransform(px + ax * cos - ay * sin, py + ax * sin + ay * cos)
  }
}

function walkClosedPolylines(entities, blocks, transform, depth, out) {
  if (!entities || depth > 8) return
  for (const entity of entities) {
    if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices?.length >= 3) {
      if (!(entity.shape || (entity.flag & 1))) continue
      const vertices = entity.vertices.map(vertex => transform(vertex.x, vertex.y))
      out.push({ layer: entity.layer || '', vertices, area: shoelace(vertices) })
    } else if (entity.type === 'INSERT' && blocks[entity.name]) {
      const block = blocks[entity.name]
      walkClosedPolylines(block.entities || [], blocks, localInsertTransform(entity, block, transform), depth + 1, out)
    }
  }
}

function isRoomFrameLayer(layer) {
  return !/(出圖範圍|圖說|圖例|文字|尺寸|標註|HATCH)/i.test(String(layer || ''))
}

function extractFrameCandidates(dxf, previewBbox) {
  const raw = []
  walkClosedPolylines(dxf?.entities || [], dxf?.blocks || {}, (x, y) => ({ x, y }), 0, raw)
  // Y 翻轉軸 = maxY,把 DXF model space (Y-up) 翻成跟牆 overlay 對齊的方向。
  // 不可加 pad:框與牆同源於原始 DXF 座標,牆走 transform.point 無 pad;框若多加
  // pad 會抬高翻轉軸 → 框整體往畫面下方偏 (實測 pad≈1012mm ≈ 29px 下偏)。2026-05-31 修。
  const toClean = point => ({
    x: point.x,
    y: previewBbox.maxY - (point.y - previewBbox.minY),
  })

  return raw
    .map((frame, index) => {
      const ping = frame.area / 1e6 / PING_M2
      const polygonClean = frame.vertices.map(toClean)
      return {
        id: `frame-${index}`,
        layer: frame.layer,
        ping,
        polygonClean,
        centerClean: centroid(polygonClean),
        bboxClean: bboxOf(polygonClean),
      }
    })
    .filter(frame => (
      frame.ping >= 1 &&
      frame.ping <= 120 &&
      isRoomFrameLayer(frame.layer) &&
      frame.bboxClean.maxX >= previewBbox.minX &&
      frame.bboxClean.minX <= previewBbox.maxX
    ))
}

function boxWidth(box) {
  return Math.max(1, box.maxX - box.minX)
}

function boxHeight(box) {
  return Math.max(1, box.maxY - box.minY)
}

function horizontalOverlapRatio(a, b) {
  const overlap = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  return overlap / Math.max(1, Math.min(boxWidth(a), boxWidth(b)))
}

function hasStackedRoomFrameAbove(label, frame, frames, pingError) {
  if (!finite(label.ping) || label.ping > 8) return false
  const box = frame.bboxClean
  const h = boxHeight(box)
  return (frames || []).some(other => {
    if (other.id === frame.id) return false
    if (horizontalOverlapRatio(box, other.bboxClean) < 0.62) return false
    const verticalGap = box.minY - other.bboxClean.maxY
    if (verticalGap < -h * 0.08 || verticalGap > h * 0.35) return false
    const otherPingError = Math.abs(other.ping - label.ping) / label.ping
    return otherPingError <= Math.max(0.2, pingError + 0.14)
  })
}

function frameScore(label, frame, frames = [], labels = []) {
  const pingOptions = (label.pingOptions?.length ? label.pingOptions : [label.ping])
    .filter(value => finite(value) && value > 0)
  const matchedPing = pingOptions.reduce((best, value) => {
    const error = Math.abs(frame.ping - value) / value
    return !best || error < best.pingError ? { value, pingError: error } : best
  }, null)
  if (!matchedPing) return null
  const pingError = matchedPing.pingError
  if (pingError > 0.25) return null
  const contains = pointInPolygon(label.cleanPoint, frame.polygonClean)
  const boxDistance = bboxDistance(label.cleanPoint, frame.bboxClean)
  const centerDistance = Math.hypot(label.cleanPoint.x - frame.centerClean.x, label.cleanPoint.y - frame.centerClean.y)
  const smallRoom = finite(label.ping) && label.ping <= 8
  const frameW = boxWidth(frame.bboxClean)
  const frameH = boxHeight(frame.bboxClean)
  const frameAspect = Math.max(frameW / frameH, frameH / frameW)
  if (smallRoom && frameAspect > 4.2) return null
  const containsOtherSmallLabel = smallRoom && !contains && (labels || []).some(other => (
    other !== label &&
    finite(other.ping) &&
    other.ping <= label.ping &&
    other.cleanPoint &&
    pointInPolygon(other.cleanPoint, frame.polygonClean)
  ))
  if (containsOtherSmallLabel) return null
  const horizontalMiss = label.cleanPoint.x < frame.bboxClean.minX
    ? frame.bboxClean.minX - label.cleanPoint.x
    : label.cleanPoint.x > frame.bboxClean.maxX
      ? label.cleanPoint.x - frame.bboxClean.maxX
      : 0
  const horizontalPenalty = smallRoom ? Math.min(0.9, (horizontalMiss / frameW) * 0.8) : 0
  const distancePenalty = contains
    ? 0
    : smallRoom
      ? Math.min(1.35, boxDistance / 5600 + centerDistance / 72000)
      : Math.min(2, boxDistance / 3500 + centerDistance / 36000)
  const containmentPenalty = contains ? 0 : (smallRoom ? 0.5 : 0.35)
  const layerPenalty = String(frame.layer || '').includes('地面造型') ? 0 : 0.08
  const labelBelowFrame = label.cleanPoint.y > frame.bboxClean.maxY
  const adjacentLabelFramePenalty =
    smallRoom &&
    !contains &&
    labelBelowFrame &&
    (label.cleanPoint.y - frame.bboxClean.maxY) <= boxHeight(frame.bboxClean) * 0.55 &&
    hasStackedRoomFrameAbove(label, frame, frames, pingError)
      ? 1.15
      : 0
  const pingWeight = smallRoom && !contains ? 8 : 4.5
  return {
    score: pingError * pingWeight + distancePenalty + containmentPenalty + layerPenalty + adjacentLabelFramePenalty + horizontalPenalty,
    pingError,
    contains,
    boxDistance,
    centerDistance,
    adjacentLabelFramePenalty,
    horizontalPenalty,
    matchedPing: matchedPing.value,
  }
}

function makeDxfToPdfTransform(previewBbox, crop) {
  const sx = crop.width / previewBbox.width
  const sy = crop.height / previewBbox.height
  const scale = Math.min(sx, sy)
  const offsetX = (crop.width - previewBbox.width * scale) / 2
  const offsetY = (crop.height - previewBbox.height * scale) / 2
  return {
    scale,
    offsetX,
    offsetY,
    point(point) {
      return this.basePoint(point)
    },
    basePoint(point) {
      return {
        x: offsetX + (point.x - previewBbox.minX) * scale,
        y: offsetY + (point.y - previewBbox.minY) * scale,
      }
    },
    inversePoint(point) {
      return {
        x: (point.x - offsetX) / scale + previewBbox.minX,
        y: (point.y - offsetY) / scale + previewBbox.minY,
      }
    },
    method: 'bbox',
    columnAnchorCount: 0,
    columnPairs: [],
    pdfColumns: [],
    dxfColumns: [],
  }
}

function isColumnLayer(layer) {
  return String(layer || '').includes('承重')
}

function groupedBoxesFromLineBoxes(lineBoxes, eps = 4) {
  if (!lineBoxes.length) return []
  const parent = lineBoxes.map((_, index) => index)
  const find = index => {
    let current = index
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }
  const close = (a, b) => !(
    a.x1 + eps < b.x0 ||
    b.x1 + eps < a.x0 ||
    a.y1 + eps < b.y0 ||
    b.y1 + eps < a.y0
  )
  for (let i = 0; i < lineBoxes.length; i++) {
    for (let j = i + 1; j < lineBoxes.length; j++) {
      if (close(lineBoxes[i], lineBoxes[j])) union(i, j)
    }
  }
  const groups = new Map()
  lineBoxes.forEach((box, index) => {
    const root = find(index)
    const group = groups.get(root) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, lineCount: 0 }
    group.x0 = Math.min(group.x0, box.x0)
    group.y0 = Math.min(group.y0, box.y0)
    group.x1 = Math.max(group.x1, box.x1)
    group.y1 = Math.max(group.y1, box.y1)
    group.lineCount += 1
    groups.set(root, group)
  })
  return [...groups.values()].map(box => {
    const width = box.x1 - box.x0
    const height = box.y1 - box.y0
    return {
      ...box,
      width,
      height,
      cx: (box.x0 + box.x1) / 2,
      cy: (box.y0 + box.y1) / 2,
    }
  })
}

function detectDxfColumnBoxes(lines, baseTransform) {
  const lineBoxes = (lines || [])
    .filter(line => isColumnLayer(line.layer))
    .map(line => {
      const a = baseTransform.basePoint({ x: line.x1, y: line.y1 })
      const b = baseTransform.basePoint({ x: line.x2, y: line.y2 })
      return {
        x0: Math.min(a.x, b.x),
        y0: Math.min(a.y, b.y),
        x1: Math.max(a.x, b.x),
        y1: Math.max(a.y, b.y),
      }
    })
  return groupedBoxesFromLineBoxes(lineBoxes)
    .filter(box => box.width >= 10 && box.width <= 80 && box.height >= 10 && box.height <= 80)
    .filter(box => box.width / Math.max(1, box.height) >= 0.5 && box.width / Math.max(1, box.height) <= 1.8)
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
}

function normalizeColumnBoxes(pdfColumns) {
  return (pdfColumns || [])
    .map(box => {
      const x0 = Number(box.x0)
      const y0 = Number(box.y0)
      const x1 = Number(box.x1)
      const y1 = Number(box.y1)
      const cx = finite(box.cx) ? box.cx : (x0 + x1) / 2
      const cy = finite(box.cy) ? box.cy : (y0 + y1) / 2
      return {
        ...box,
        x0,
        y0,
        x1,
        y1,
        width: finite(box.width) ? box.width : Math.abs(x1 - x0),
        height: finite(box.height) ? box.height : Math.abs(y1 - y0),
        cx,
        cy,
      }
    })
    .filter(box => finite(box.cx) && finite(box.cy))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
}

function pairColumnAnchors(pdfColumns, dxfColumns, maxDistance = 65) {
  const pairs = []
  const used = new Set()
  for (const pdf of normalizeColumnBoxes(pdfColumns)) {
    let best = null
    dxfColumns.forEach((dxf, index) => {
      if (used.has(index)) return
      const distance = Math.hypot(pdf.cx - dxf.cx, pdf.cy - dxf.cy)
      if (distance <= maxDistance && (!best || distance < best.distance)) best = { index, pdf, dxf, distance }
    })
    if (!best) continue
    used.add(best.index)
    pairs.push({
      pdf: { x: best.pdf.cx, y: best.pdf.cy },
      dxf: { x: best.dxf.cx, y: best.dxf.cy },
      distance: best.distance,
    })
  }
  return pairs
}

function linearFit(src, dst) {
  if (src.length < 2) return null
  const meanSrc = src.reduce((sum, value) => sum + value, 0) / src.length
  const meanDst = dst.reduce((sum, value) => sum + value, 0) / dst.length
  let covariance = 0
  let variance = 0
  for (let i = 0; i < src.length; i++) {
    covariance += (src[i] - meanSrc) * (dst[i] - meanDst)
    variance += (src[i] - meanSrc) ** 2
  }
  if (variance === 0) return null
  const scale = covariance / variance
  return { scale, offset: meanDst - scale * meanSrc }
}

function fitAxisTransformFromPairs(pairs) {
  if ((pairs || []).length < 4) return null
  const fitX = linearFit(pairs.map(pair => pair.dxf.x), pairs.map(pair => pair.pdf.x))
  const fitY = linearFit(pairs.map(pair => pair.dxf.y), pairs.map(pair => pair.pdf.y))
  if (!fitX || !fitY) return null
  return {
    scaleX: fitX.scale,
    scaleY: fitY.scale,
    offsetX: fitX.offset,
    offsetY: fitY.offset,
  }
}

function transformResidualStats(pairs, axis) {
  if (!axis || !(pairs || []).length) return null
  const distances = pairs.map(pair => {
    const x = pair.dxf.x * axis.scaleX + axis.offsetX
    const y = pair.dxf.y * axis.scaleY + axis.offsetY
    return Math.hypot(pair.pdf.x - x, pair.pdf.y - y)
  }).sort((a, b) => a - b)
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length
  return {
    mean,
    median: distances[Math.floor(distances.length / 2)],
    max: distances[distances.length - 1],
  }
}

function isPlausibleColumnAxis(axis, residuals) {
  if (!axis || !residuals) return false
  return (
    axis.scaleX >= 0.94 &&
    axis.scaleX <= 1.08 &&
    axis.scaleY >= 0.94 &&
    axis.scaleY <= 1.08 &&
    Math.abs(axis.offsetX) <= 90 &&
    Math.abs(axis.offsetY) <= 90 &&
    residuals.median <= 18 &&
    residuals.max <= 55
  )
}

function makeColumnAwareDxfToPdfTransform(previewBbox, crop, lines, pdfColumns) {
  const base = makeDxfToPdfTransform(previewBbox, crop)
  const normalizedPdfColumns = normalizeColumnBoxes(pdfColumns)
  if (!normalizedPdfColumns.length) return base
  const dxfColumns = detectDxfColumnBoxes(lines, base)
  const pairs = pairColumnAnchors(normalizedPdfColumns, dxfColumns)
  const axis = fitAxisTransformFromPairs(pairs)
  const residuals = transformResidualStats(pairs, axis)
  if (!axis || !isPlausibleColumnAxis(axis, residuals)) {
    return {
      ...base,
      pdfColumns: normalizedPdfColumns,
      dxfColumns,
      columnPairs: pairs,
      columnResiduals: residuals,
      rejectedColumnAlignment: !!axis,
    }
  }
  return {
    ...base,
    method: 'columns',
    columnAnchorCount: pairs.length,
    columnPairs: pairs,
    columnResiduals: residuals,
    pdfColumns: normalizedPdfColumns,
    dxfColumns,
    axis,
    point(point) {
      const basePoint = base.basePoint(point)
      return {
        x: basePoint.x * axis.scaleX + axis.offsetX,
        y: basePoint.y * axis.scaleY + axis.offsetY,
      }
    },
    inversePoint(point) {
      const basePoint = {
        x: (point.x - axis.offsetX) / axis.scaleX,
        y: (point.y - axis.offsetY) / axis.scaleY,
      }
      return base.inversePoint(basePoint)
    },
  }
}

function matchRooms(labels, frames, transform, crop) {
  const used = new Set()
  const preliminary = []
  for (const label of labels) {
    let best = null
    for (const frame of frames) {
      if (used.has(frame.id)) continue
      const scoring = frameScore(label, frame, frames, labels)
      if (!scoring) continue
      if (!best || scoring.score < best.score) best = { frame, ...scoring }
    }
    if (!best) {
      preliminary.push({ ...label, matched: false, geometrySource: 'unresolved', unresolvedBecause: 'no-frame-match' })
      continue
    }
    used.add(best.frame.id)
    preliminary.push({
      ...label,
      matched: true,
      frameId: best.frame.id,
      frameLayer: best.frame.layer,
      framePing: Number(best.frame.ping.toFixed(2)),
      matchedPing: Number((best.matchedPing ?? label.ping).toFixed(3)),
      pingError: Number(best.pingError.toFixed(3)),
      score: Number(best.score.toFixed(3)),
      containsLabel: best.contains,
      labelToFrameDistance: Number(best.boxDistance.toFixed(1)),
      horizontalPenalty: Number((best.horizontalPenalty || 0).toFixed(3)),
      adjacentLabelFramePenalty: Number((best.adjacentLabelFramePenalty || 0).toFixed(3)),
      polygonClean: best.frame.polygonClean.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })),
      polygonPdf: best.frame.polygonClean.map(point => {
        const pdf = transform.point(point)
        return { x: Number(pdf.x.toFixed(1)), y: Number(pdf.y.toFixed(1)) }
      }),
    })
  }

  return preliminary.map(room => {
    const nearSmallRoom =
      room.matched &&
      room.ping <= 8 &&
      room.pingError <= 0.16 &&
      room.score <= 2.05 &&
      (room.horizontalPenalty || 0) <= 0.45 &&
      room.labelToFrameDistance <= 5600
    const reliable =
      room.matched &&
      ((room.containsLabel && room.score <= 1.25) || nearSmallRoom)
    const reliableOpenZone =
      room.matched &&
      room.ping >= 10 &&
      room.pingError <= 0.12 &&
      room.score <= 2.8 &&
      room.labelToFrameDistance <= 5600 &&
      /(討論|休息|共享|辦公區|等候|會議室)/.test(room.labelText)
    const generalOpenZone =
      room.matched &&
      room.ping >= 10 &&
      room.pingError <= 0.12 &&
      room.score <= 2.8 &&
      room.labelToFrameDistance <= 5600
    if (reliable) {
      return {
        ...room,
        matched: true,
        geometrySource: 'dxf-frame',
        labelPlacement: room.containsLabel ? 'inside-frame' : 'outside-near-frame',
      }
    }
    if (reliableOpenZone || generalOpenZone) {
      return {
        ...room,
        matched: true,
        geometrySource: 'dxf-frame',
        labelPlacement: 'open-zone-near-frame',
      }
    }
    return {
      ...room,
      matched: false,
      geometrySource: 'unresolved',
      unresolvedBecause: room.matched ? 'low-frame-confidence' : 'no-frame-match',
      candidateFrameId: room.frameId || null,
      candidateFramePing: room.framePing ?? null,
      polygonPdf: [],
      polygonClean: [],
    }
  })
}

function pdfPolygonFromClean(points, transform) {
  return points.map(point => {
    const pdf = transform.point(point)
    return { x: Number(pdf.x.toFixed(1)), y: Number(pdf.y.toFixed(1)) }
  })
}

function combinedFrameCandidate(labels, frames) {
  const largeLabels = (labels || []).filter(label => finite(label.ping) && label.ping >= 10 && label.cleanPoint)
  let best = null
  for (const frame of frames || []) {
    const contained = largeLabels.filter(label => pointInPolygon(label.cleanPoint, frame.polygonClean))
    if (contained.length < 2) continue
    const pingSum = contained.reduce((sum, label) => sum + label.ping, 0)
    const pingError = Math.abs(frame.ping - pingSum) / Math.max(1, pingSum)
    if (pingError > 0.16) continue
    const score = pingError + contained.length * -0.04 + Math.abs(frame.ping - pingSum) / 200
    if (!best || score < best.score) best = { frame, labels: contained, pingSum, pingError, score }
  }
  return best
}

function applyCombinedFunctionalZoneFrame(rooms, labels, frames, transform) {
  const candidate = combinedFrameCandidate(labels, frames)
  if (!candidate) return rooms || []

  const zoneLabelTexts = candidate.labels.map(label => label.labelText)
  const zoneTextSet = new Set(zoneLabelTexts)
  const primary = [...candidate.labels].sort((a, b) => b.ping - a.ping)[0]
  const pdfPoint = {
    x: Number((candidate.labels.reduce((sum, label) => sum + label.pdfPoint.x, 0) / candidate.labels.length).toFixed(1)),
    y: Number((candidate.labels.reduce((sum, label) => sum + label.pdfPoint.y, 0) / candidate.labels.length).toFixed(1)),
  }
  const combinedRoom = {
    ...primary,
    labelText: zoneLabelTexts.join(' / '),
    name: zoneLabelTexts.map(text => roomName(text)).join(' / '),
    ping: Number(candidate.pingSum.toFixed(2)),
    matchedPing: Number(candidate.pingSum.toFixed(2)),
    pdfPoint,
    matched: true,
    frameId: candidate.frame.id,
    frameLayer: candidate.frame.layer,
    framePing: Number(candidate.frame.ping.toFixed(2)),
    pingError: Number(candidate.pingError.toFixed(3)),
    score: Number(candidate.score.toFixed(3)),
    containsLabel: true,
    labelToFrameDistance: 0,
    geometrySource: 'dxf-frame',
    labelPlacement: 'combined-functional-zone-frame',
    zoneLabels: zoneLabelTexts,
    zoneLabelPoints: candidate.labels.map(label => ({
      labelText: label.labelText,
      pdfPoint: label.pdfPoint,
      ping: label.ping,
    })),
    polygonClean: candidate.frame.polygonClean.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })),
    polygonPdf: pdfPolygonFromClean(candidate.frame.polygonClean, transform),
  }

  const result = []
  let inserted = false
  for (const room of rooms || []) {
    if (!zoneTextSet.has(room.labelText)) {
      result.push(room)
      continue
    }
    if (!inserted) {
      result.push(combinedRoom)
      inserted = true
    }
    if (room.labelText !== primary.labelText) {
      result.push({
        ...room,
        matched: true,
        geometrySource: 'functional-zone-label',
        labelPlacement: 'inside-combined-physical-space',
        parentLabelText: combinedRoom.labelText,
        polygonPdf: [],
        polygonClean: [],
      })
    }
  }
  return result
}

function polygonPoints(points) {
  return points.map(point => `${Number(point.x).toFixed(1)},${Number(point.y).toFixed(1)}`).join(' ')
}

function renderAlignmentSvg(lines, crop, imageHref, transform) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${crop.width} ${crop.height}" data-preview="dxf-pdf-alignment">`,
    `<image href="${esc(imageHref)}" x="0" y="0" width="${crop.width}" height="${crop.height}" opacity="0.58"/>`,
    '<g fill="none" stroke="#0ea5e9" stroke-width="1.2" opacity="0.72">',
  ]
  for (const line of lines || []) {
    const a = transform.point({ x: line.x1, y: line.y1 })
    const b = transform.point({ x: line.x2, y: line.y2 })
    parts.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" data-layer="${esc(line.layer)}"/>`)
  }
  parts.push('</g>')
  if (transform.axis && transform.columnPairs?.length) {
    parts.push('<g fill="none" stroke-width="2">')
    for (const pair of transform.columnPairs) {
      const dxf = {
        x: pair.dxf.x * transform.axis.scaleX + transform.axis.offsetX,
        y: pair.dxf.y * transform.axis.scaleY + transform.axis.offsetY,
      }
      parts.push(`<circle cx="${pair.pdf.x.toFixed(1)}" cy="${pair.pdf.y.toFixed(1)}" r="5" stroke="#ef4444" data-anchor="pdf-column"/>`)
      parts.push(`<circle cx="${dxf.x.toFixed(1)}" cy="${dxf.y.toFixed(1)}" r="8" stroke="#2563eb" data-anchor="dxf-column"/>`)
    }
    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('\n')
}

function transformLinesToPdf(lines, transform) {
  return (lines || []).map(line => {
    const a = transform.point({ x: line.x1, y: line.y1 })
    const b = transform.point({ x: line.x2, y: line.y2 })
    return {
      x1: Number(a.x.toFixed(2)),
      y1: Number(a.y.toFixed(2)),
      x2: Number(b.x.toFixed(2)),
      y2: Number(b.y.toFixed(2)),
      layer: line.layer || '',
      color: line.color,
      sourceType: line.sourceType,
    }
  })
}

function renderRoomsSvg(rooms, diagnostics, crop, imageHref) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${crop.width} ${crop.height}" font-family="Arial, 'Noto Sans TC', sans-serif" data-preview="dxf-pdf-rooms">`,
    `<image href="${esc(imageHref)}" x="0" y="0" width="${crop.width}" height="${crop.height}" opacity="0.56"/>`,
    '<g stroke-linejoin="round">',
  ]
  for (const room of rooms.filter(room => room.matched && room.polygonPdf?.length)) {
    const color = room.geometrySource === 'pdf-open-zone-estimate' || room.labelPlacement === 'outside-near-frame' ? '#f59e0b' : '#22c55e'
    parts.push(`<polygon points="${polygonPoints(room.polygonPdf)}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="2" data-room-match="matched" data-label="${esc(room.labelText)}"/>`)
  }
  for (const item of []) {
    parts.push(`<polygon points="${polygonPoints(item.regionCandidate.polygon)}" fill="#38bdf8" fill-opacity="0.15" stroke="#0284c7" stroke-width="2.2" stroke-dasharray="8 5" data-room-match="candidate" data-label="${esc(item.labelText)}"/>`)
  }
  parts.push('</g><g font-size="13" font-weight="600">')
  for (const room of rooms) {
    const color = room.matched ? '#166534' : '#dc2626'
    const point = room.pdfPoint || { x: 0, y: 0 }
    parts.push(`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${color}"/>`)
    parts.push(`<text x="${point.x.toFixed(1)}" y="${Math.max(12, point.y - 7).toFixed(1)}" fill="${color}" stroke="white" stroke-width="3" paint-order="stroke" data-room-match="${room.matched ? 'matched' : 'unresolved'}">${esc(room.labelText)}</text>`)
  }
  parts.push('</g></svg>')
  return parts.join('\n')
}

function isDiagnosticWallLayer(layer) {
  const text = String(layer || '')
  return (
    text.includes('隔間牆') ||
    text.includes('承重柱牆') ||
    text.includes('牆體') ||
    text.includes('門窗上框線') ||
    text.includes('防火') ||
    text.includes('帷幕')
  )
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
  const x = a.x + dx * t
  const y = a.y + dy * t
  return Math.hypot(point.x - x, point.y - y)
}

function bboxOfPdfLines(lines) {
  if (!lines.length) return null
  const points = lines.flatMap(line => [line.a, line.b])
  const box = bboxOf(points)
  return {
    x0: box.minX,
    y0: box.minY,
    x1: box.maxX,
    y1: box.maxY,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
  }
}

function diagnosticSearchRadius(room, crop) {
  const ping = finite(room.ping) ? room.ping : 6
  const estimated = Math.sqrt(Math.max(900, ping * 2300)) * (ping >= 18 ? 1.0 : 1.12)
  const maxRadius = Math.max(90, Math.min(230, Math.max(crop.width, crop.height) * 0.16))
  return Math.max(78, Math.min(maxRadius, estimated))
}

function clipLineToBox(line, box) {
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  let t0 = 0
  let t1 = 1
  const clip = (p, q) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (
    !clip(-dx, line.a.x - box.x0) ||
    !clip(dx, box.x1 - line.a.x) ||
    !clip(-dy, line.a.y - box.y0) ||
    !clip(dy, box.y1 - line.a.y)
  ) return null
  const a = { x: line.a.x + t0 * dx, y: line.a.y + t0 * dy }
  const b = { x: line.a.x + t1 * dx, y: line.a.y + t1 * dy }
  const length = Math.hypot(a.x - b.x, a.y - b.y)
  if (length < 6) return null
  return { ...line, a, b, length }
}

function lineBox(line) {
  return {
    x0: Math.min(line.a.x, line.b.x),
    y0: Math.min(line.a.y, line.b.y),
    x1: Math.max(line.a.x, line.b.x),
    y1: Math.max(line.a.y, line.b.y),
  }
}

function boxesTouch(a, b, eps = 14) {
  return !(
    a.x1 + eps < b.x0 ||
    b.x1 + eps < a.x0 ||
    a.y1 + eps < b.y0 ||
    b.y1 + eps < a.y0
  )
}

function groupDiagnosticLines(lines) {
  if (!lines.length) return []
  const boxes = lines.map(lineBox)
  const parent = lines.map((_, index) => index)
  const find = index => {
    let current = index
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]]
      current = parent[current]
    }
    return current
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootB] = rootA
  }
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (boxesTouch(boxes[i], boxes[j])) union(i, j)
    }
  }
  const groups = new Map()
  lines.forEach((line, index) => {
    const root = find(index)
    const group = groups.get(root) || []
    group.push(line)
    groups.set(root, group)
  })
  return [...groups.values()]
}

function boxDistanceToPoint(box, point) {
  return bboxDistance(point, { minX: box.x0, minY: box.y0, maxX: box.x1, maxY: box.y1 })
}

function selectDiagnosticLines(nearby, point, radius) {
  const groups = groupDiagnosticLines(nearby)
    .map(lines => {
      const box = bboxOfPdfLines(lines)
      return {
        lines,
        box,
        distance: box ? boxDistanceToPoint(box, point) : Infinity,
        minLineDistance: Math.min(...lines.map(line => line.distance ?? Infinity)),
      }
    })
    .filter(group => group.box)
    .sort((a, b) => (
      (a.distance + a.minLineDistance * 0.25) - (b.distance + b.minLineDistance * 0.25)
    ))
  const selected = []
  let total = 0
  for (const group of groups) {
    if (selected.length && group.distance > radius * 0.75) continue
    selected.push(group)
    total += group.lines.length
    if (selected.length >= 4 || total >= 45) break
  }
  return selected.flatMap(group => group.lines).slice(0, 45)
}

function polygonArea(points) {
  if (!points?.length) return 0
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return Math.abs(area) / 2
}

function averagePoint(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function scalePolygon(points, origin, scale, crop) {
  return points.map(point => ({
    x: Number(Math.max(0, Math.min(crop.width, origin.x + (point.x - origin.x) * scale)).toFixed(1)),
    y: Number(Math.max(0, Math.min(crop.height, origin.y + (point.y - origin.y) * scale)).toFixed(1)),
  }))
}

function pdfBoxFromPolygon(points) {
  const box = bboxOf(points)
  return {
    x0: box.minX,
    y0: box.minY,
    x1: box.maxX,
    y1: box.maxY,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
  }
}

function pdfBoxArea(box) {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0)
}

function pdfBoxIntersectionArea(a, b) {
  return pdfBoxArea({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  })
}

function pdfLineBox(line) {
  return {
    x0: Math.min(line.a.x, line.b.x),
    y0: Math.min(line.a.y, line.b.y),
    x1: Math.max(line.a.x, line.b.x),
    y1: Math.max(line.a.y, line.b.y),
  }
}

function intervalOverlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function makePdfWallLines(lines, transform) {
  return (lines || [])
    .map((line, index) => {
      const a = transform.point({ x: line.x1, y: line.y1 })
      const b = transform.point({ x: line.x2, y: line.y2 })
      return {
        id: `snap-wall-${index}`,
        layer: line.layer || '',
        a,
        b,
        length: Math.hypot(a.x - b.x, a.y - b.y),
      }
    })
    .filter(line => line.length >= 20)
}

function makePdfWallLinesFromOverlay(lines) {
  return (lines || [])
    .map((line, index) => {
      const a = { x: line.x1, y: line.y1 }
      const b = { x: line.x2, y: line.y2 }
      return {
        id: `snap-overlay-${index}`,
        layer: line.layer || '',
        a,
        b,
        length: Math.hypot(a.x - b.x, a.y - b.y),
      }
    })
    .filter(line => line.length >= 20 && finite(line.a.x) && finite(line.a.y) && finite(line.b.x) && finite(line.b.y))
}

function findHorizontalSnapLine(wallLines, box, direction) {
  const search = Math.max(70, Math.min(170, box.height * 1.9))
  const spanPad = Math.max(12, box.width * 0.12)
  const x0 = box.x0 - spanPad
  const x1 = box.x1 + spanPad
  const minOverlapRatio = direction === 'above' ? 0.18 : 0.55
  let best = null
  for (const line of wallLines) {
    if (Math.abs(line.a.y - line.b.y) > 2.5) continue
    const lb = pdfLineBox(line)
    const y = (line.a.y + line.b.y) / 2
    const distance = direction === 'above' ? box.y0 - y : y - box.y1
    if (distance <= 2 || distance > search) continue
    const overlap = intervalOverlap(x0, x1, lb.x0, lb.x1)
    const overlapRatio = overlap / Math.max(1, box.width)
    if (overlapRatio < minOverlapRatio) continue
    const score = distance - overlapRatio * 18
    if (!best || score < best.score) best = { y, line, score, overlapRatio, distance }
  }
  return best
}

function findVerticalSnapLine(wallLines, box, direction) {
  const search = Math.max(36, Math.min(95, box.width * 0.75))
  const maxUsefulDistance = Math.max(18, box.width * 0.16)
  const spanPad = Math.max(12, box.height * 0.1)
  const y0 = box.y0 - spanPad
  const y1 = box.y1 + spanPad
  let best = null
  for (const line of wallLines) {
    if (Math.abs(line.a.x - line.b.x) > 2.5) continue
    const lb = pdfLineBox(line)
    const x = (line.a.x + line.b.x) / 2
    const distance = direction === 'left' ? box.x0 - x : x - box.x1
    if (distance <= 1 || distance > search || distance > maxUsefulDistance) continue
    const overlap = intervalOverlap(y0, y1, lb.y0, lb.y1)
    const overlapRatio = overlap / Math.max(1, box.height)
    if (overlapRatio < 0.42) continue
    const score = distance - overlapRatio * 18
    if (!best || score < best.score) best = { x, line, score, overlapRatio, distance }
  }
  return best
}

function snapSmallRoomsToWallLines(rooms, lines, transform, crop) {
  const wallLines = transform ? makePdfWallLines(lines, transform) : makePdfWallLinesFromOverlay(lines)
  if (!wallLines.length) return rooms

  return (rooms || []).map(room => {
    if (
      !room.matched ||
      room.geometrySource !== 'dxf-frame' ||
      !finite(room.ping) ||
      room.ping > 8 ||
      !room.polygonPdf?.length ||
      !room.pdfPoint
    ) return room

    const box = pdfBoxFromPolygon(room.polygonPdf)
    const labelBelowGap = room.pdfPoint.y - box.y1
    if (labelBelowGap < Math.max(28, box.height * 0.35)) return room

    const top = findHorizontalSnapLine(wallLines, box, 'above')
    const bottom = findHorizontalSnapLine(wallLines, box, 'below')
    if (!top || !bottom) return room

    const snappedHeight = bottom.y - top.y
    if (snappedHeight < box.height * 1.35 || snappedHeight > box.height * 2.7) return room
    if (snappedHeight < 95) return room

    const verticalBox = { ...box, y0: top.y, y1: bottom.y, height: snappedHeight }
    const left = findVerticalSnapLine(wallLines, verticalBox, 'left')
    const right = findVerticalSnapLine(wallLines, verticalBox, 'right')
    const x0 = Math.max(0, left ? left.x : box.x0)
    const x1 = Math.min(crop.width, right ? right.x : box.x1)
    const y0 = Math.max(0, top.y)
    const y1 = Math.min(crop.height, bottom.y)
    if (x1 - x0 < 18 || y1 - y0 < 18) return room

    const polygonPdf = [
      { x: Number(x0.toFixed(1)), y: Number(y0.toFixed(1)) },
      { x: Number(x1.toFixed(1)), y: Number(y0.toFixed(1)) },
      { x: Number(x1.toFixed(1)), y: Number(y1.toFixed(1)) },
      { x: Number(x0.toFixed(1)), y: Number(y1.toFixed(1)) },
    ]
    return {
      ...room,
      polygonPdf,
      wallSnapped: true,
      wallSnap: {
        method: 'horizontal-wall-bounds',
        leftX: left ? Number(left.x.toFixed(1)) : null,
        rightX: right ? Number(right.x.toFixed(1)) : null,
        topY: Number(top.y.toFixed(1)),
        bottomY: Number(bottom.y.toFixed(1)),
        beforeWidth: Number(box.width.toFixed(1)),
        beforeHeight: Number(box.height.toFixed(1)),
        afterWidth: Number((x1 - x0).toFixed(1)),
        afterHeight: Number((y1 - y0).toFixed(1)),
      },
    }
  })
}

function normalizeLargeMatchedRoomAreas(rooms, crop) {
  const areaPerPing = estimatePdfAreaPerPing(rooms)
  if (!finite(areaPerPing) || areaPerPing <= 0) return rooms

  return (rooms || []).map(room => {
    if (
      !room.matched ||
      room.geometrySource !== 'dxf-frame' ||
      !room.containsLabel ||
      !finite(room.ping) ||
      room.ping < 10 ||
      !finite(room.pingError) ||
      room.pingError < 0.12 ||
      !room.polygonPdf?.length
    ) return room

    const currentArea = polygonArea(room.polygonPdf)
    const targetArea = (room.matchedPing || room.ping) * areaPerPing
    if (!finite(currentArea) || !finite(targetArea) || currentArea <= 0 || targetArea <= 0) return room

    const scale = Math.sqrt(targetArea / currentArea)
    if (scale < 0.93 || scale > 1.14 || Math.abs(scale - 1) < 0.035) return room

    const origin = averagePoint(room.polygonPdf)
    const polygonPdf = scalePolygon(room.polygonPdf, origin, scale, crop)
    return {
      ...room,
      polygonPdf,
      areaNormalized: true,
      areaNormalization: {
        method: 'matched-room-area-per-ping',
        scale: Number(scale.toFixed(3)),
        areaPerPing: Number(areaPerPing.toFixed(1)),
        beforeArea: Number(currentArea.toFixed(1)),
        afterArea: Number(polygonArea(polygonPdf).toFixed(1)),
      },
    }
  })
}

function pointInPdfBox(point, box) {
  return point &&
    point.x >= box.x0 &&
    point.x <= box.x1 &&
    point.y >= box.y0 &&
    point.y <= box.y1
}

function pdfBoxDistanceToPoint(box, point) {
  if (!point) return Infinity
  const dx = point.x < box.x0 ? box.x0 - point.x : point.x > box.x1 ? point.x - box.x1 : 0
  const dy = point.y < box.y0 ? box.y0 - point.y : point.y > box.y1 ? point.y - box.y1 : 0
  return Math.hypot(dx, dy)
}

function uniqueSortedEdges(values) {
  return [...new Set(values
    .filter(finite)
    .map(value => Number(value.toFixed(1))))]
    .sort((a, b) => a - b)
    .filter((value, index, list) => index === 0 || Math.abs(value - list[index - 1]) > 1)
}

function clippedChildBox(childBox, parentBox) {
  const box = {
    x0: Math.max(parentBox.x0, childBox.x0),
    y0: Math.max(parentBox.y0, childBox.y0),
    x1: Math.min(parentBox.x1, childBox.x1),
    y1: Math.min(parentBox.y1, childBox.y1),
  }
  box.width = box.x1 - box.x0
  box.height = box.y1 - box.y0
  return box.width > 1 && box.height > 1 ? box : null
}

function cellKey(xIndex, yIndex) {
  return `${xIndex},${yIndex}`
}

function connectedCellComponent(cells, xEdges, yEdges, labelPoint) {
  if (!cells.length) return []
  const cellSet = new Set(cells.map(cell => cellKey(cell.xIndex, cell.yIndex)))
  const visited = new Set()
  const components = []
  for (const cell of cells) {
    const startKey = cellKey(cell.xIndex, cell.yIndex)
    if (visited.has(startKey)) continue
    const queue = [cell]
    visited.add(startKey)
    const component = []
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      component.push(current)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = current.xIndex + dx
        const ny = current.yIndex + dy
        const key = cellKey(nx, ny)
        if (!cellSet.has(key) || visited.has(key)) continue
        visited.add(key)
        queue.push(cells.find(item => item.xIndex === nx && item.yIndex === ny))
      }
    }
    components.push(component)
  }

  const componentScore = component => {
    let containsLabel = false
    let nearest = Infinity
    let area = 0
    for (const cell of component) {
      const x0 = xEdges[cell.xIndex]
      const x1 = xEdges[cell.xIndex + 1]
      const y0 = yEdges[cell.yIndex]
      const y1 = yEdges[cell.yIndex + 1]
      const box = { x0, y0, x1, y1 }
      area += pdfBoxArea(box)
      if (pointInPdfBox(labelPoint, box)) containsLabel = true
      nearest = Math.min(nearest, pdfBoxDistanceToPoint(box, labelPoint))
    }
    return { containsLabel, nearest, area }
  }

  return components
    .map(component => ({ component, ...componentScore(component) }))
    .sort((a, b) => {
      if (a.containsLabel !== b.containsLabel) return a.containsLabel ? -1 : 1
      if (Math.abs(a.nearest - b.nearest) > 1) return a.nearest - b.nearest
      return b.area - a.area
    })[0]?.component || []
}

function edgeKey(a, b) {
  return `${a.x},${a.y}|${b.x},${b.y}`
}

function reverseEdgeKey(a, b) {
  return `${b.x},${b.y}|${a.x},${a.y}`
}

function addBoundaryEdge(edges, a, b) {
  const reverse = reverseEdgeKey(a, b)
  if (edges.has(reverse)) {
    edges.delete(reverse)
  } else {
    edges.set(edgeKey(a, b), { a, b })
  }
}

function polygonFromCells(cells, xEdges, yEdges) {
  const edges = new Map()
  for (const cell of cells) {
    const x0 = xEdges[cell.xIndex]
    const x1 = xEdges[cell.xIndex + 1]
    const y0 = yEdges[cell.yIndex]
    const y1 = yEdges[cell.yIndex + 1]
    addBoundaryEdge(edges, { x: x0, y: y0 }, { x: x1, y: y0 })
    addBoundaryEdge(edges, { x: x1, y: y0 }, { x: x1, y: y1 })
    addBoundaryEdge(edges, { x: x1, y: y1 }, { x: x0, y: y1 })
    addBoundaryEdge(edges, { x: x0, y: y1 }, { x: x0, y: y0 })
  }

  const outgoing = new Map()
  for (const edge of edges.values()) {
    const key = `${edge.a.x},${edge.a.y}`
    if (!outgoing.has(key)) outgoing.set(key, [])
    outgoing.get(key).push(edge)
  }

  const loops = []
  const used = new Set()
  for (const edge of edges.values()) {
    const startKey = edgeKey(edge.a, edge.b)
    if (used.has(startKey)) continue
    const loop = [edge.a]
    let current = edge
    for (let guard = 0; guard < edges.size + 4; guard++) {
      used.add(edgeKey(current.a, current.b))
      loop.push(current.b)
      const nextKey = `${current.b.x},${current.b.y}`
      const next = (outgoing.get(nextKey) || []).find(item => !used.has(edgeKey(item.a, item.b)))
      if (!next) break
      current = next
      if (current.a.x === edge.a.x && current.a.y === edge.a.y) break
    }
    if (loop.length >= 4) loops.push(loop)
  }

  const best = loops
    .map(loop => (loop.length > 1 && loop[0].x === loop.at(-1).x && loop[0].y === loop.at(-1).y ? loop.slice(0, -1) : loop))
    .sort((a, b) => polygonArea(b) - polygonArea(a))[0]
  return (best || []).map(point => ({ x: Number(point.x.toFixed(1)), y: Number(point.y.toFixed(1)) }))
}

function carveNestedChildBoxes(parentRoom, childRooms) {
  if (!parentRoom?.polygonPdf?.length || !childRooms.length) return null
  const parentBox = pdfBoxFromPolygon(parentRoom.polygonPdf)
  const childBoxes = childRooms
    .map(room => clippedChildBox(pdfBoxFromPolygon(room.polygonPdf), parentBox))
    .filter(Boolean)
  if (!childBoxes.length) return null

  const xEdges = uniqueSortedEdges([
    parentBox.x0,
    parentBox.x1,
    ...childBoxes.flatMap(box => [box.x0, box.x1]),
  ])
  const yEdges = uniqueSortedEdges([
    parentBox.y0,
    parentBox.y1,
    ...childBoxes.flatMap(box => [box.y0, box.y1]),
  ])
  if (xEdges.length < 2 || yEdges.length < 2) return null

  const cells = []
  for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex++) {
    for (let xIndex = 0; xIndex < xEdges.length - 1; xIndex++) {
      const cell = {
        xIndex,
        yIndex,
        x0: xEdges[xIndex],
        x1: xEdges[xIndex + 1],
        y0: yEdges[yIndex],
        y1: yEdges[yIndex + 1],
      }
      if (cell.x1 - cell.x0 < 1 || cell.y1 - cell.y0 < 1) continue
      const center = { x: (cell.x0 + cell.x1) / 2, y: (cell.y0 + cell.y1) / 2 }
      if (!pointInPolygon(center, parentRoom.polygonPdf)) continue
      if (childBoxes.some(box => pointInPdfBox(center, box))) continue
      cells.push(cell)
    }
  }

  const component = connectedCellComponent(cells, xEdges, yEdges, parentRoom.pdfPoint)
  if (!component.length) return null
  const polygonPdf = polygonFromCells(component, xEdges, yEdges)
  if (polygonPdf.length < 4) return null
  const carvedArea = polygonArea(polygonPdf)
  const parentArea = polygonArea(parentRoom.polygonPdf)
  if (carvedArea < parentArea * 0.25 || carvedArea >= parentArea * 0.98) return null
  return {
    polygonPdf,
    childLabels: childRooms.map(room => room.labelText),
    beforeArea: parentArea,
    afterArea: carvedArea,
  }
}

function resolveNestedRoomFrames(rooms, crop) {
  const matchedRooms = (rooms || [])
    .filter(room => room.matched && room.geometrySource === 'dxf-frame' && room.polygonPdf?.length >= 3)
  const childrenByParent = new Map()
  for (const parent of matchedRooms) {
    const parentBox = pdfBoxFromPolygon(parent.polygonPdf)
    const parentArea = pdfBoxArea(parentBox)
    if (parentArea <= 0) continue
    for (const child of matchedRooms) {
      if (child === parent) continue
      if (!finite(parent.ping) || !finite(child.ping) || parent.ping < child.ping * 1.8) continue
      const childBox = pdfBoxFromPolygon(child.polygonPdf)
      const childArea = pdfBoxArea(childBox)
      if (childArea <= 0 || childArea >= parentArea * 0.72) continue
      const childInsideRatio = pdfBoxIntersectionArea(parentBox, childBox) / childArea
      if (childInsideRatio < 0.75) continue
      if (pointInPdfBox(parent.pdfPoint, childBox)) continue
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, [])
      childrenByParent.get(parent).push(child)
    }
  }

  if (!childrenByParent.size) return rooms || []
  return (rooms || []).map(room => {
    const childRooms = childrenByParent.get(room)
    if (!childRooms?.length) return room
    const carved = carveNestedChildBoxes(room, childRooms, crop)
    if (!carved) return room
    return {
      ...room,
      polygonPdf: carved.polygonPdf,
      nestedFrameCarved: true,
      nestedFrameCarve: {
        method: 'subtract-contained-child-frames',
        childLabels: carved.childLabels,
        beforeArea: Number(carved.beforeArea.toFixed(1)),
        afterArea: Number(carved.afterArea.toFixed(1)),
      },
    }
  })
}

function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
}

function estimatePdfAreaPerPing(rooms) {
  const ratios = (rooms || [])
    .filter(room => room.geometrySource === 'dxf-frame' && room.polygonPdf?.length >= 3 && finite(room.matchedPing || room.ping) && (room.matchedPing || room.ping) > 0)
    .map(room => polygonArea(room.polygonPdf) / (room.matchedPing || room.ping))
    .filter(value => value >= 900 && value <= 5000)
  return median(ratios) || 2300
}

function markBarrier(grid, cols, rows, gx, gy, radius = 1) {
  for (let y = Math.max(0, gy - radius); y <= Math.min(rows - 1, gy + radius); y++) {
    for (let x = Math.max(0, gx - radius); x <= Math.min(cols - 1, gx + radius); x++) {
      grid[y * cols + x] = 1
    }
  }
}

function rasterizeLineBarrier(grid, cols, rows, box, cell, line) {
  const x1 = (line.a.x - box.x0) / cell
  const y1 = (line.a.y - box.y0) / cell
  const x2 = (line.b.x - box.x0) / cell
  const y2 = (line.b.y - box.y0) / cell
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    markBarrier(grid, cols, rows, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), 1)
  }
}

function floodFillRegion(grid, cols, rows, sx, sy) {
  if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return null
  const start = sy * cols + sx
  if (grid[start]) return null
  const visited = new Uint8Array(cols * rows)
  const queue = [start]
  visited[start] = 1
  let minX = sx
  let maxX = sx
  let minY = sy
  let maxY = sy
  let count = 0
  let touchesBoundary = false
  const cells = []
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]
    const x = index % cols
    const y = Math.floor(index / cols)
    count += 1
    cells.push(index)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchesBoundary = true
    for (const next of [
      x > 0 ? index - 1 : -1,
      x < cols - 1 ? index + 1 : -1,
      y > 0 ? index - cols : -1,
      y < rows - 1 ? index + cols : -1,
    ]) {
      if (next < 0 || visited[next] || grid[next]) continue
      visited[next] = 1
      queue.push(next)
    }
  }
  return { minX, minY, maxX, maxY, count, touchesBoundary, cells }
}

function simplifyOrthogonalPolygon(points) {
  if (!points.length) return points
  const simplified = []
  for (const point of points) {
    simplified.push(point)
    while (simplified.length >= 3) {
      const a = simplified[simplified.length - 3]
      const b = simplified[simplified.length - 2]
      const c = simplified[simplified.length - 1]
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
      if (!collinear) break
      simplified.splice(simplified.length - 2, 1)
    }
  }
  if (simplified.length >= 3) {
    let changed = true
    while (changed && simplified.length >= 3) {
      changed = false
      const n = simplified.length
      const a = simplified[n - 2]
      const b = simplified[n - 1]
      const c = simplified[0]
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
        simplified.pop()
        changed = true
      }
    }
  }
  return simplified
}

function regionBoundaryPolygon(region, cols, localBox, cell) {
  if (!region?.cells?.length) return []
  const filled = new Set(region.cells)
  const edges = []
  const has = (x, y) => x >= 0 && y >= 0 && x < cols && filled.has(y * cols + x)
  for (const index of region.cells) {
    const x = index % cols
    const y = Math.floor(index / cols)
    if (!has(x, y - 1)) edges.push([[x, y], [x + 1, y]])
    if (!has(x + 1, y)) edges.push([[x + 1, y], [x + 1, y + 1]])
    if (!has(x, y + 1)) edges.push([[x + 1, y + 1], [x, y + 1]])
    if (!has(x - 1, y)) edges.push([[x, y + 1], [x, y]])
  }

  const outgoing = new Map()
  for (const edge of edges) {
    const key = `${edge[0][0]},${edge[0][1]}`
    const list = outgoing.get(key) || []
    list.push(edge)
    outgoing.set(key, list)
  }

  const loops = []
  while (edges.length) {
    const first = edges.pop()
    const loop = [first[0], first[1]]
    let current = first[1]
    for (let guard = 0; guard < 10000; guard++) {
      const key = `${current[0]},${current[1]}`
      const list = outgoing.get(key) || []
      const nextIndex = list.findIndex(edge => edges.includes(edge))
      if (nextIndex < 0) break
      const [edge] = list.splice(nextIndex, 1)
      const edgeIndex = edges.indexOf(edge)
      if (edgeIndex >= 0) edges.splice(edgeIndex, 1)
      current = edge[1]
      if (current[0] === loop[0][0] && current[1] === loop[0][1]) break
      loop.push(current)
    }
    if (loop.length >= 4) loops.push(loop)
  }

  const toPdf = point => ({
    x: Number((localBox.x0 + point[0] * cell).toFixed(1)),
    y: Number((localBox.y0 + point[1] * cell).toFixed(1)),
  })
  const pdfLoops = loops
    .map(loop => simplifyOrthogonalPolygon(loop.map(toPdf)))
    .filter(loop => loop.length >= 4)
    .sort((a, b) => polygonArea(b) - polygonArea(a))
  return pdfLoops[0] || []
}

function buildRegionCandidate(room, point, localBox, localWallLines, areaPerPing) {
  if (!localWallLines.length) return null
  const cell = 3
  const cols = Math.max(8, Math.ceil((localBox.x1 - localBox.x0) / cell))
  const rows = Math.max(8, Math.ceil((localBox.y1 - localBox.y0) / cell))
  const grid = new Uint8Array(cols * rows)
  for (const line of localWallLines) rasterizeLineBarrier(grid, cols, rows, localBox, cell, line)

  const candidateBox = bboxOfPdfLines(localWallLines)
  const seeds = [
    point,
    candidateBox ? { x: (candidateBox.x0 + candidateBox.x1) / 2, y: (candidateBox.y0 + candidateBox.y1) / 2 } : null,
    { x: point.x - 24, y: point.y },
    { x: point.x + 24, y: point.y },
    { x: point.x, y: point.y - 24 },
    { x: point.x, y: point.y + 24 },
  ].filter(Boolean)

  const expectedArea = Math.max(1200, (finite(room.matchedPing || room.ping) ? (room.matchedPing || room.ping) : 5) * areaPerPing)
  let best = null
  for (const seed of seeds) {
    const sx = Math.round((seed.x - localBox.x0) / cell)
    const sy = Math.round((seed.y - localBox.y0) / cell)
    const region = floodFillRegion(grid, cols, rows, sx, sy)
    if (!region || region.count < 8) continue
    const area = region.count * cell * cell
    const box = {
      x0: localBox.x0 + region.minX * cell,
      y0: localBox.y0 + region.minY * cell,
      x1: Math.min(localBox.x1, localBox.x0 + (region.maxX + 1) * cell),
      y1: Math.min(localBox.y1, localBox.y0 + (region.maxY + 1) * cell),
    }
    const polygon = regionBoundaryPolygon(region, cols, localBox, cell)
    const score =
      Math.abs(Math.log(Math.max(area, 1) / expectedArea)) +
      Math.hypot(seed.x - point.x, seed.y - point.y) / 180 +
      (region.touchesBoundary ? 0.8 : 0)
    const candidate = {
      score,
      area: Number(area.toFixed(1)),
      expectedArea: Number(expectedArea.toFixed(1)),
      touchesBoundary: region.touchesBoundary,
      polygon,
      box: {
        x0: Number(box.x0.toFixed(1)),
        y0: Number(box.y0.toFixed(1)),
        x1: Number(box.x1.toFixed(1)),
        y1: Number(box.y1.toFixed(1)),
      },
    }
    if (!best || candidate.score < best.score) best = candidate
  }
  return best ? { ...best, score: Number(best.score.toFixed(3)) } : null
}

function buildUnresolvedDiagnostics(rooms, lines, transform, crop) {
  const wallLines = (lines || [])
    .filter(line => isDiagnosticWallLayer(line.layer))
    .map((line, index) => {
      const a = transform.point({ x: line.x1, y: line.y1 })
      const b = transform.point({ x: line.x2, y: line.y2 })
      return {
        id: `wall-${index}`,
        layer: line.layer || '',
        a,
        b,
        length: Math.hypot(a.x - b.x, a.y - b.y),
      }
    })
    .filter(line => line.length >= 8)

  const areaPerPing = estimatePdfAreaPerPing(rooms)
  return (rooms || [])
    .filter(room => !room.matched)
    .map(room => {
      const point = room.pdfPoint || { x: 0, y: 0 }
      const radius = diagnosticSearchRadius(room, crop)
      const localBox = {
        x0: Math.max(0, point.x - radius),
        y0: Math.max(0, point.y - radius),
        x1: Math.min(crop.width, point.x + radius),
        y1: Math.min(crop.height, point.y + radius),
      }
      const nearby = wallLines
        .map(line => ({ ...line, distance: pointSegmentDistance(point, line.a, line.b) }))
        .filter(line => line.distance <= radius)
        .map(line => clipLineToBox(line, localBox))
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 140)
      const selectedLines = selectDiagnosticLines(nearby, point, radius)
      const candidateBox = bboxOfPdfLines(selectedLines)
      const regionCandidate = buildRegionCandidate(room, point, localBox, nearby, areaPerPing)
      return {
        labelText: room.labelText,
        name: room.name,
        ping: room.ping,
        pdfPoint: point,
        unresolvedBecause: room.unresolvedBecause,
        candidateFrameId: room.candidateFrameId,
        candidateFramePing: room.candidateFramePing,
        searchRadius: Number(radius.toFixed(1)),
        wallCandidateCount: selectedLines.length,
        candidateBox: candidateBox ? {
          x0: Number(Math.max(0, candidateBox.x0).toFixed(1)),
          y0: Number(Math.max(0, candidateBox.y0).toFixed(1)),
          x1: Number(Math.min(crop.width, candidateBox.x1).toFixed(1)),
          y1: Number(Math.min(crop.height, candidateBox.y1).toFixed(1)),
        } : null,
        regionCandidate,
        wallCandidates: selectedLines.map(line => ({
          layer: line.layer,
          distance: Number(line.distance.toFixed(1)),
          x1: Number(line.a.x.toFixed(1)),
          y1: Number(line.a.y.toFixed(1)),
          x2: Number(line.b.x.toFixed(1)),
          y2: Number(line.b.y.toFixed(1)),
        })),
      }
    })
}

function rectanglePolygonFromPdfBox(box) {
  return [
    { x: Number(box.x0.toFixed(1)), y: Number(box.y0.toFixed(1)) },
    { x: Number(box.x1.toFixed(1)), y: Number(box.y0.toFixed(1)) },
    { x: Number(box.x1.toFixed(1)), y: Number(box.y1.toFixed(1)) },
    { x: Number(box.x0.toFixed(1)), y: Number(box.y1.toFixed(1)) },
  ]
}

function promoteWallCandidateRooms(rooms, diagnostics, crop) {
  const areaPerPing = estimatePdfAreaPerPing(rooms)
  return (rooms || []).map(room => {
    if (
      room.matched ||
      room.geometrySource !== 'unresolved' ||
      !finite(room.ping) ||
      room.ping > 4.2 ||
      !room.pdfPoint
    ) return room

    const diagnostic = (diagnostics || []).find(item => (
      item.labelText === room.labelText &&
      Math.hypot((item.pdfPoint?.x || 0) - room.pdfPoint.x, (item.pdfPoint?.y || 0) - room.pdfPoint.y) <= 2
    ))
    const box = diagnostic?.candidateBox
    if (!box || !pointInPdfBox(room.pdfPoint, box)) return room

    const width = box.x1 - box.x0
    const height = box.y1 - box.y0
    if (width < 80 || height < 50) return room
    const aspect = Math.max(width / Math.max(1, height), height / Math.max(1, width))
    if (aspect > 3.2) return room

    const expectedArea = Math.max(1200, (room.matchedPing || room.ping) * areaPerPing)
    const areaRatio = pdfBoxArea(box) / expectedArea
    if (areaRatio < 0.85 || areaRatio > 2.35) return room
    if ((diagnostic.wallCandidateCount || 0) > 24) return room

    return {
      ...room,
      matched: true,
      geometrySource: 'dxf-wall-candidate',
      labelPlacement: 'inside-wall-candidate',
      wallCandidatePromoted: true,
      polygonPdf: rectanglePolygonFromPdfBox(box),
      polygonClean: [],
      wallCandidate: {
        method: 'local-dxf-wall-candidate-box',
        wallCandidateCount: diagnostic.wallCandidateCount || 0,
        areaRatio: Number(areaRatio.toFixed(2)),
      },
    }
  })
}

function attachTextItemsWithTransform(textItems, transform) {
  return (textItems || []).map(item => ({
    ...item,
    dxfPoint: item.pdfPoint ? transform.inversePoint(item.pdfPoint) : item.dxfPoint,
  }))
}

function renderDiagnosticsSvg(diagnostics, crop, imageHref) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${crop.width} ${crop.height}" font-family="Arial, 'Noto Sans TC', sans-serif" data-preview="dxf-pdf-diagnostics">`,
    `<image href="${esc(imageHref)}" x="0" y="0" width="${crop.width}" height="${crop.height}" opacity="0.5"/>`,
  ]
  const colors = ['#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#be123c']
  for (const [index, item] of diagnostics.entries()) {
    const color = colors[index % colors.length]
    parts.push(`<g data-diagnostic-room="${esc(item.labelText)}">`)
    parts.push(`<circle cx="${item.pdfPoint.x.toFixed(1)}" cy="${item.pdfPoint.y.toFixed(1)}" r="${item.searchRadius.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1.2" stroke-dasharray="7 5" opacity="0.48"/>`)
    parts.push(`<g stroke="${color}" stroke-width="1.4" opacity="0.72">`)
    for (const line of item.wallCandidates || []) {
      parts.push(`<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" data-wall-candidate="nearby" data-layer="${esc(line.layer)}"/>`)
    }
    parts.push('</g>')
    if (item.candidateBox) {
      const box = item.candidateBox
      parts.push(`<rect x="${box.x0}" y="${box.y0}" width="${Math.max(1, box.x1 - box.x0).toFixed(1)}" height="${Math.max(1, box.y1 - box.y0).toFixed(1)}" fill="${color}" fill-opacity="0.06" stroke="${color}" stroke-width="2" data-candidate-box="nearby-walls"/>`)
    }
    if (item.regionCandidate?.box) {
      const box = item.regionCandidate.box
      parts.push(`<rect x="${box.x0}" y="${box.y0}" width="${Math.max(1, box.x1 - box.x0).toFixed(1)}" height="${Math.max(1, box.y1 - box.y0).toFixed(1)}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2.4" data-region-candidate="flood-fill"/>`)
    }
    if (item.regionCandidate?.polygon?.length >= 4) {
      parts.push(`<polygon points="${polygonPoints(item.regionCandidate.polygon)}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2.6" data-region-candidate="flood-fill-polygon"/>`)
    }
    parts.push(`<circle cx="${item.pdfPoint.x.toFixed(1)}" cy="${item.pdfPoint.y.toFixed(1)}" r="5" fill="${color}" data-room-diagnostic="unresolved"/>`)
    parts.push(`<text x="${item.pdfPoint.x.toFixed(1)}" y="${Math.max(14, item.pdfPoint.y - 9).toFixed(1)}" fill="${color}" stroke="white" stroke-width="3" paint-order="stroke" font-size="13" font-weight="700">${esc(item.labelText)} (${item.wallCandidateCount})</text>`)
    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('\n')
}

// 把 DXF 門窗候選 (原始 model 座標) 經 toClean + transform 換成 PDF crop 座標。
// 走的是跟房間框完全相同的轉換鏈 (toClean → transform.point),所以跟 polygonPdf 對齊。
function buildCropOpenings(dxf, previewBbox, transform, crop) {
  let raw
  try { raw = extractOpeningObjects(dxf) } catch { return { doors: [], windows: [] } }
  const toClean = p => ({ x: p.x, y: previewBbox.maxY - (p.y - previewBbox.minY) })
  const map = list => (list || []).map(o => {
    const c = transform.point(toClean({ x: o.x, y: o.y }))
    return { x: Number(c.x.toFixed(1)), y: Number(c.y.toFixed(1)), widthCm: o.widthCm, layer: o.layer, block: o.block, rotation: o.rotation }
  }).filter(o => finite(o.x) && finite(o.y) && o.x >= -30 && o.x <= crop.width + 30 && o.y >= -30 && o.y <= crop.height + 30)
  return { doors: map(raw.doors), windows: map(raw.windows) }
}

function buildCandidateCells(frames, transform, crop) {
  return (frames || [])
    .map((frame, index) => {
      const polygonPdf = pdfPolygonFromClean(frame.polygonClean, transform)
      const box = bboxOf(polygonPdf)
      return {
        id: `cell-${index + 1}`,
        index: index + 1,
        layer: frame.layer || '',
        frameId: frame.id,
        framePing: Number(frame.ping.toFixed(2)),
        polygonPdf,
        bboxPdf: box,
      }
    })
    .filter(cell => (
      cell.polygonPdf.length >= 3 &&
      cell.bboxPdf.maxX >= -30 &&
      cell.bboxPdf.minX <= crop.width + 30 &&
      cell.bboxPdf.maxY >= -30 &&
      cell.bboxPdf.minY <= crop.height + 30
    ))
}

export function buildDxfPdfImportPreview({ dxf, textItems, crop, imageHref = '', pdfColumns = [] }) {
  const preview = extractDxfPreviewContent(dxf)
  const frames = extractFrameCandidates(dxf, preview.bbox)
  const makeResult = transform => {
    const attachedTextItems = attachTextItemsWithTransform(textItems, transform)
    const labels = normalizePdfRoomLabels(attachedTextItems)
    const rooms = matchRooms(labels, frames, transform, crop)
    return { transform, labels, rooms }
  }
  let result = makeResult(makeColumnAwareDxfToPdfTransform(preview.bbox, crop, preview.lines, pdfColumns))
  if (
    result.transform.method === 'columns' &&
    result.labels.length >= 8 &&
    result.rooms.filter(room => room.matched).length < Math.max(8, result.labels.length * 0.55)
  ) {
    result = makeResult(makeDxfToPdfTransform(preview.bbox, crop))
    result.transform.method = 'bbox-fallback'
  }
  const { transform, labels } = result
  const physicallyMergedRooms = applyCombinedFunctionalZoneFrame(result.rooms, labels, frames, transform)
  const wallSnappedRooms = snapSmallRoomsToWallLines(physicallyMergedRooms, preview.lines, transform, crop)
  const areaNormalizedRooms = normalizeLargeMatchedRoomAreas(wallSnappedRooms, crop)
  const resolvedRooms = resolveNestedRoomFrames(areaNormalizedRooms, crop)
  const initialDiagnostics = buildUnresolvedDiagnostics(resolvedRooms, preview.lines, transform, crop)
  const rooms = promoteWallCandidateRooms(resolvedRooms, initialDiagnostics, crop)
  const diagnostics = buildUnresolvedDiagnostics(rooms, preview.lines, transform, crop)
  const matchedRoomCount = rooms.filter(room => room.matched).length
  const unresolvedRoomCount = rooms.length - matchedRoomCount
  const openings = buildCropOpenings(dxf, preview.bbox, transform, crop)
  const candidateCells = buildCandidateCells(frames, transform, crop)
  return {
    alignmentSvg: renderAlignmentSvg(preview.lines, crop, imageHref, transform),
    overlayLines: transformLinesToPdf(preview.lines, transform),
    overlayBbox: { minX: 0, minY: 0, maxX: crop.width, maxY: crop.height, width: crop.width, height: crop.height },
    roomSvg: renderRoomsSvg(rooms, diagnostics, crop, imageHref),
    diagnosticsSvg: renderDiagnosticsSvg(diagnostics, crop, imageHref),
    labels,
    rooms,
    candidateCells,
    openings,
    diagnostics,
    meta: {
      labelCount: labels.length,
      frameCount: frames.length,
      candidateCellCount: candidateCells.length,
      matchedRoomCount,
      unresolvedRoomCount,
      estimatedRoomCount: rooms.filter(room => room.geometrySource === 'pdf-open-zone-estimate').length,
      smallRoomEstimateCount: rooms.filter(room => room.geometrySource === 'pdf-open-zone-estimate' && room.ping < 10).length,
      alignmentMethod: transform.method,
      columnAnchorCount: transform.columnAnchorCount,
      pdfColumnCount: transform.pdfColumns?.length || 0,
      dxfColumnCount: transform.dxfColumns?.length || 0,
      rejectedColumnAlignment: !!transform.rejectedColumnAlignment,
      columnResidualMedian: transform.columnResiduals ? Number(transform.columnResiduals.median.toFixed(1)) : null,
      columnResidualMax: transform.columnResiduals ? Number(transform.columnResiduals.max.toFixed(1)) : null,
      wallSnappedRoomCount: rooms.filter(room => room.wallSnapped).length,
      areaNormalizedRoomCount: rooms.filter(room => room.areaNormalized).length,
      nestedFrameCarveCount: rooms.filter(room => room.nestedFrameCarved).length,
      wallCandidatePromotedCount: rooms.filter(room => room.wallCandidatePromoted).length,
      combinedFunctionalZoneCount: rooms.filter(room => room.labelPlacement === 'combined-functional-zone-frame').length,
      functionalZoneLabelCount: rooms.filter(room => room.geometrySource === 'functional-zone-label').length,
      diagnosticRoomCount: diagnostics.length,
      diagnosticWallCandidateCount: diagnostics.reduce((sum, item) => sum + item.wallCandidateCount, 0),
    },
  }
}

function denseInterval(counts, threshold, gapTolerance = 20, minLength = 20) {
  const intervals = []
  let start = null
  let last = null
  let gap = 0
  counts.forEach((value, index) => {
    if (value > threshold) {
      if (start == null) start = index
      last = index
      gap = 0
    } else if (start != null) {
      gap += 1
      if (gap > gapTolerance) {
        if (last != null && last - start + 1 >= minLength) intervals.push([start, last])
        start = null
        last = null
        gap = 0
      }
    }
  })
  if (start != null && last != null && last - start + 1 >= minLength) intervals.push([start, last])
  if (!intervals.length) return null
  return intervals.reduce((best, item) => (item[1] - item[0]) > (best[1] - best[0]) ? item : best, intervals[0])
}

function findPlanCropFromImageData(imageData, width, height, margin = 8) {
  const leftRegionWidth = Math.max(1, Math.floor(width * 0.84))
  const rowCounts = []
  for (let y = 0; y < height; y++) {
    let count = 0
    for (let x = 0; x < leftRegionWidth; x++) {
      const i = (y * width + x) * 4
      if (Math.min(imageData[i], imageData[i + 1], imageData[i + 2]) < 220) count++
    }
    rowCounts.push(count)
  }
  const rowThreshold = Math.max(40, Math.floor(leftRegionWidth * 0.04))
  const yInterval = denseInterval(rowCounts, rowThreshold, 20, Math.max(40, Math.floor(height * 0.2)))
  if (!yInterval) return { x0: 0, y0: 0, x1: width, y1: height, width, height, method: 'full-page' }

  const [y0, y1] = yInterval
  const colCounts = []
  for (let x = 0; x < width; x++) {
    let count = 0
    for (let y = y0; y <= y1; y++) {
      const i = (y * width + x) * 4
      if (Math.min(imageData[i], imageData[i + 1], imageData[i + 2]) < 220) count++
    }
    colCounts.push(count)
  }
  const colThreshold = Math.max(30, Math.floor((y1 - y0 + 1) * 0.04))
  const xInterval = denseInterval(colCounts, colThreshold, 20, Math.max(40, Math.floor(width * 0.2)))
  if (!xInterval) return { x0: 0, y0: 0, x1: width, y1: height, width, height, method: 'full-page' }

  const [x0, x1] = xInterval
  const crop = {
    x0: Math.max(0, x0 - margin),
    y0: Math.max(0, y0 - margin),
    x1: Math.min(width, x1 + margin + 1),
    y1: Math.min(height, y1 + margin + 1),
    method: 'dense-plan-area',
  }
  crop.width = crop.x1 - crop.x0
  crop.height = crop.y1 - crop.y0
  return crop
}

function detectPdfColumnBoxes(imageData, width, height, threshold = 80) {
  const visited = new Uint8Array(width * height)
  const boxes = []
  const isDark = (x, y) => {
    const i = (y * width + x) * 4
    return Math.min(imageData[i], imageData[i + 1], imageData[i + 2]) < threshold
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x
      if (visited[start] || !isDark(x, y)) continue
      const queue = [start]
      visited[start] = 1
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let count = 0

      for (let head = 0; head < queue.length; head++) {
        const index = queue[head]
        const cx = index % width
        const cy = Math.floor(index / width)
        count += 1
        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)
        const neighbors = [
          cx > 0 ? index - 1 : -1,
          cx < width - 1 ? index + 1 : -1,
          cy > 0 ? index - width : -1,
          cy < height - 1 ? index + width : -1,
        ]
        for (const next of neighbors) {
          if (next < 0 || visited[next]) continue
          const nx = next % width
          const ny = Math.floor(next / width)
          if (!isDark(nx, ny)) continue
          visited[next] = 1
          queue.push(next)
        }
      }

      const boxWidth = maxX - minX + 1
      const boxHeight = maxY - minY + 1
      const area = boxWidth * boxHeight
      const density = area ? count / area : 0
      const aspect = boxWidth / Math.max(1, boxHeight)
      if (
        boxWidth >= 15 &&
        boxWidth <= 70 &&
        boxHeight >= 15 &&
        boxHeight <= 70 &&
        aspect >= 0.65 &&
        aspect <= 1.55 &&
        density >= 0.3 &&
        density <= 1
      ) {
        boxes.push({
          x0: minX,
          y0: minY,
          x1: maxX,
          y1: maxY,
          width: boxWidth,
          height: boxHeight,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          density,
        })
      }
    }
  }

  return boxes.sort((a, b) => a.cy - b.cy || a.cx - b.cx)
}

function textItemBox(pdfjsLib, viewport, item) {
  const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
  const x = tx[4]
  const y = tx[5]
  const width = Math.abs((item.width || 0) * viewport.scale)
  const height = Math.max(2, Math.abs((item.height || 0) * viewport.scale))
  return {
    x0: x,
    y0: y - height,
    x1: x + width,
    y1: y,
  }
}

function intersectsCrop(box, crop) {
  return Math.min(crop.x1, box.x1) - Math.max(crop.x0, box.x0) > 1 &&
    Math.min(crop.y1, box.y1) - Math.max(crop.y0, box.y0) > 1
}

export async function extractPdfImportData(pdfFile, { scale = 2 } = {}) {
  if (typeof document === 'undefined') {
    throw new Error('PDF import preview requires a browser canvas environment')
  }
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc ||= new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const crop = findPlanCropFromImageData(image.data, canvas.width, canvas.height)
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = crop.width
  cropCanvas.height = crop.height
  const cropCtx = cropCanvas.getContext('2d')
  cropCtx.drawImage(canvas, crop.x0, crop.y0, crop.width, crop.height, 0, 0, crop.width, crop.height)
  const cropImage = cropCtx.getImageData(0, 0, crop.width, crop.height)
  const pdfColumns = detectPdfColumnBoxes(cropImage.data, crop.width, crop.height)
  const imageHref = cropCanvas.toDataURL('image/png')

  const content = await page.getTextContent()
  const textItems = []
  for (const item of content.items || []) {
    const text = cleanText(item.str)
    if (!text) continue
    const box = textItemBox(pdfjsLib, viewport, item)
    if (!intersectsCrop(box, crop)) continue
    const pdfBox = {
      x0: Math.max(0, Math.min(crop.width, box.x0 - crop.x0)),
      y0: Math.max(0, Math.min(crop.height, box.y0 - crop.y0)),
      x1: Math.max(0, Math.min(crop.width, box.x1 - crop.x0)),
      y1: Math.max(0, Math.min(crop.height, box.y1 - crop.y0)),
    }
    pdfBox.width = Math.abs(pdfBox.x1 - pdfBox.x0)
    pdfBox.height = Math.abs(pdfBox.y1 - pdfBox.y0)
    if (pdfBox.width < 2 || pdfBox.height < 2) continue
    textItems.push({
      text,
      kind: parsePing(text) != null && /[\u4e00-\u9fff]/.test(text) ? 'room-label' : 'other',
      pdfBox,
      pdfPoint: {
        x: (pdfBox.x0 + pdfBox.x1) / 2,
        y: (pdfBox.y0 + pdfBox.y1) / 2,
      },
    })
  }
  return { crop, imageHref, textItems, pdfColumns, pageCount: pdf.numPages }
}

export function attachDxfPointsToPdfTextItems({ dxf, textItems, crop, pdfColumns = [] }) {
  const preview = extractDxfPreviewContent(dxf)
  const transform = makeColumnAwareDxfToPdfTransform(preview.bbox, crop, preview.lines, pdfColumns)
  return (textItems || []).map(item => ({
    ...item,
    dxfPoint: transform.inversePoint(item.pdfPoint),
  }))
}

export function importRoomsToSpaces(rooms, crop, bounds, placement = null, pdfLines = null) {
  const canvasBounds = bounds || { w: 4000, h: 3000 }
  const canUsePlacement =
    placement &&
    finite(placement.offsetX) &&
    finite(placement.offsetY) &&
    finite(placement.drawW) &&
    finite(placement.drawH) &&
    placement.drawW > 0 &&
    placement.drawH > 0
  const fit = canUsePlacement ? null : Math.min((canvasBounds.w * 0.9) / crop.width, (canvasBounds.h * 0.9) / crop.height)
  const drawW = canUsePlacement ? placement.drawW : crop.width * fit
  const drawH = canUsePlacement ? placement.drawH : crop.height * fit
  const offsetX = canUsePlacement ? placement.offsetX : (canvasBounds.w - drawW) / 2
  const offsetY = canUsePlacement ? placement.offsetY : (canvasBounds.h - drawH) / 2
  const snappedRooms = pdfLines?.length ? snapSmallRoomsToWallLines(rooms || [], pdfLines, null, crop) : (rooms || [])
  const normalizedRooms = normalizeLargeMatchedRoomAreas(snappedRooms, crop)
  const resolvedRooms = resolveNestedRoomFrames(normalizedRooms, crop)
  return resolvedRooms
    .filter(room => room.matched && ['dxf-frame', 'dxf-wall-candidate'].includes(room.geometrySource) && room.polygonPdf?.length >= 3)
    .map(room => ({
      name: room.name || room.labelText,
      ping: room.matchedPing || room.ping,
      source: 'dxf-pdf',
      framePing: room.framePing,
      matchedPing: room.matchedPing,
      labelPlacement: room.labelPlacement,
      zoneLabels: room.zoneLabels,
      zoneLabelPoints: room.zoneLabelPoints,
      height: 280,
      color: '#e2e8f0',
      wallKind: 'interior',
      wallThickness: 12,
      labelPosition: {
        x: Math.round(offsetX + (room.pdfPoint.x / crop.width) * drawW),
        y: Math.round(offsetY + (room.pdfPoint.y / crop.height) * drawH),
      },
      vertices: room.polygonPdf.map(point => ({
        x: Math.round(offsetX + (point.x / crop.width) * drawW),
        y: Math.round(offsetY + (point.y / crop.height) * drawH),
      })),
    }))
}
