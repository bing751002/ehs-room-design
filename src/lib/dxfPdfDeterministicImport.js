import { importRoomsToSpaces } from './dxfPdfImport.js'

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
}

function mad(values, center) {
  return median(values.map(value => Math.abs(value - center)))
}

export function __testSelectResidualCorrection(values, {
  tolerance = 8,
  minSamples = 2,
  minClusterRatio = 0.28,
  minDominantClusterRatio = 0.45,
  farClusterDistance = 18,
  minOffset = 3,
} = {}) {
  const cleaned = values.filter(finite).sort((a, b) => a - b)
  const axisMedian = median(cleaned)
  const axisMad = mad(cleaned, axisMedian)
  if (cleaned.length < minSamples) {
    return {
      ok: false,
      offset: 0,
      median: Number(axisMedian.toFixed(1)),
      mad: Number(axisMad.toFixed(1)),
      clusterMedian: 0,
      clusterMad: 0,
      clusterCount: cleaned.length,
      clusterRatio: cleaned.length ? 1 : 0,
    }
  }

  let best = []
  for (let i = 0; i < cleaned.length; i++) {
    const cluster = []
    for (let j = 0; j < cleaned.length; j++) {
      if (Math.abs(cleaned[j] - cleaned[i]) <= tolerance) cluster.push(cleaned[j])
    }
    if (
      cluster.length > best.length ||
      (cluster.length === best.length && Math.abs(median(cluster)) > Math.abs(median(best)))
    ) best = cluster
  }

  const bestMedian = median(best)
  const bestRatio = best.length / cleaned.length
  const bestIsLowRatioFarCluster =
    bestRatio < minDominantClusterRatio &&
    Math.abs(bestMedian - axisMedian) > farClusterDistance
  const selected = best
  const clusterMedian = median(selected)
  const clusterMad = mad(selected, clusterMedian)
  const clusterRatio = selected.length / cleaned.length
  const ok =
    !bestIsLowRatioFarCluster &&
    selected.length >= minSamples &&
    clusterRatio >= minClusterRatio &&
    Math.abs(clusterMedian) >= minOffset &&
    clusterMad <= tolerance * 0.5
  return {
    ok,
    offset: ok ? Math.round(clusterMedian) : 0,
    median: Number(axisMedian.toFixed(1)),
    mad: Number(axisMad.toFixed(1)),
    clusterMedian: Number(clusterMedian.toFixed(1)),
    clusterMad: Number(clusterMad.toFixed(1)),
    clusterCount: selected.length,
    clusterRatio: Number(clusterRatio.toFixed(2)),
  }
}

function placementForBaseLayer(baseLayer, bounds) {
  const crop = baseLayer?.pdfImport?.crop
  const placement = baseLayer?.placement
  if (
    placement &&
    finite(placement.offsetX) &&
    finite(placement.offsetY) &&
    finite(placement.drawW) &&
    finite(placement.drawH) &&
    placement.drawW > 0 &&
    placement.drawH > 0
  ) return placement
  const canvasBounds = bounds || { w: 4000, h: 3000 }
  const fit = Math.min((canvasBounds.w * 0.9) / crop.width, (canvasBounds.h * 0.9) / crop.height)
  return {
    drawW: crop.width * fit,
    drawH: crop.height * fit,
    offsetX: (canvasBounds.w - crop.width * fit) / 2,
    offsetY: (canvasBounds.h - crop.height * fit) / 2,
  }
}

function lineToCanvas(line, baseLayer, placement) {
  const box = baseLayer?.bbox || baseLayer?.pdfImport?.preview?.overlayBbox || {
    minX: 0,
    minY: 0,
    width: baseLayer?.pdfImport?.crop?.width || 1,
    height: baseLayer?.pdfImport?.crop?.height || 1,
  }
  const sx = placement.drawW / (box.width || 1)
  const sy = placement.drawH / (box.height || 1)
  return {
    x1: placement.offsetX + (line.x1 - (box.minX || 0)) * sx,
    y1: placement.offsetY + (line.y1 - (box.minY || 0)) * sy,
    x2: placement.offsetX + (line.x2 - (box.minX || 0)) * sx,
    y2: placement.offsetY + (line.y2 - (box.minY || 0)) * sy,
  }
}

function spaceEdges(space) {
  const vertices = space.vertices || []
  const edges = []
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    if (length < 35) continue
    if (Math.abs(dy) <= Math.max(2, length * 0.04)) {
      edges.push({
        axis: 'h',
        aIndex: i,
        bIndex: (i + 1) % vertices.length,
        pos: (a.y + b.y) / 2,
        min: Math.min(a.x, b.x),
        max: Math.max(a.x, b.x),
      })
    } else if (Math.abs(dx) <= Math.max(2, length * 0.04)) {
      edges.push({
        axis: 'v',
        aIndex: i,
        bIndex: (i + 1) % vertices.length,
        pos: (a.x + b.x) / 2,
        min: Math.min(a.y, b.y),
        max: Math.max(a.y, b.y),
      })
    }
  }
  return edges
}

function overlayEdges(baseLayer, placement) {
  return (baseLayer?.previewLines || [])
    .map(line => lineToCanvas(line, baseLayer, placement))
    .flatMap(line => {
      const dx = line.x2 - line.x1
      const dy = line.y2 - line.y1
      const length = Math.hypot(dx, dy)
      if (length < 35) return []
      if (Math.abs(dy) <= Math.max(2, length * 0.04)) {
        return [{
          axis: 'h',
          pos: (line.y1 + line.y2) / 2,
          min: Math.min(line.x1, line.x2),
          max: Math.max(line.x1, line.x2),
        }]
      }
      if (Math.abs(dx) <= Math.max(2, length * 0.04)) {
        return [{
          axis: 'v',
          pos: (line.x1 + line.x2) / 2,
          min: Math.min(line.y1, line.y2),
          max: Math.max(line.y1, line.y2),
        }]
      }
      return []
    })
}

function intervalOverlap(a, b) {
  return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min))
}

function closestResidual(edge, candidates) {
  let best = null
  for (const candidate of candidates) {
    if (candidate.axis !== edge.axis) continue
    const overlap = intervalOverlap(edge, candidate)
    const overlapRatio = overlap / Math.max(1, Math.min(edge.max - edge.min, candidate.max - candidate.min))
    if (overlapRatio < 0.35) continue
    const delta = candidate.pos - edge.pos
    const distance = Math.abs(delta)
    if (distance > 90) continue
    if (!best || distance < best.distance) best = { delta, distance }
  }
  return best?.delta ?? null
}

function translateSpaceVertices(space, offset) {
  return {
    ...space,
    vertices: (space.vertices || []).map(point => ({
      x: Math.round(point.x + offset.x),
      y: Math.round(point.y + offset.y),
    })),
  }
}

function correctLocalSpaceOffsets(spaces, overlay, {
  maxLocalOffset = 90,
  maxVertices = 12,
  maxPing = 12,
} = {}) {
  const corrections = []
  const correctedSpaces = (spaces || []).map(space => {
    if (
      (space.vertices?.length || 0) < 4 ||
      (space.vertices?.length || 0) > maxVertices ||
      (finite(space.ping) && space.ping > maxPing) ||
      space.labelPlacement !== 'inside-frame'
    ) return space

    const dx = []
    const dy = []
    for (const edge of spaceEdges(space)) {
      const residual = closestResidual(edge, overlay)
      if (residual == null) continue
      if (edge.axis === 'v') dx.push(residual)
      else dy.push(residual)
    }

    const xCorrection = __testSelectResidualCorrection(dx, {
      minClusterRatio: 0.65,
      minDominantClusterRatio: 0.65,
    })
    const yCorrection = __testSelectResidualCorrection(dy, {
      minClusterRatio: 0.65,
      minDominantClusterRatio: 0.65,
    })
    const offset = {
      x: xCorrection.ok && Math.abs(xCorrection.offset) <= maxLocalOffset ? xCorrection.offset : 0,
      y: yCorrection.ok && Math.abs(yCorrection.offset) <= maxLocalOffset ? yCorrection.offset : 0,
    }
    if (!offset.x && !offset.y) return space

    corrections.push({
      id: space.id || null,
      name: space.name || '',
      offset,
      xSampleCount: dx.length,
      ySampleCount: dy.length,
      xClusterMedian: xCorrection.clusterMedian,
      yClusterMedian: yCorrection.clusterMedian,
    })
    return translateSpaceVertices(space, offset)
  })
  return { spaces: correctedSpaces, corrections }
}

function closestEdgeSnap(edge, candidates, {
  maxDistance = 75,
  minOverlapRatio = 0.45,
} = {}) {
  let best = null
  for (const candidate of candidates) {
    if (candidate.axis !== edge.axis) continue
    const overlap = intervalOverlap(edge, candidate)
    const overlapRatio = overlap / Math.max(1, Math.min(edge.max - edge.min, candidate.max - candidate.min))
    if (overlapRatio < minOverlapRatio) continue
    const delta = candidate.pos - edge.pos
    const distance = Math.abs(delta)
    if (distance > maxDistance) continue
    const score = distance - overlapRatio * 12
    if (!best || score < best.score) {
      best = { target: candidate.pos, delta, distance, overlapRatio, score }
    }
  }
  return best
}

function snapSpaceEdgesToOverlay(spaces, overlay, {
  maxPing = 45,
  maxVertices = 24,
} = {}) {
  const snaps = []
  const correctedSpaces = (spaces || []).map(space => {
    const vertices = (space.vertices || []).map(point => ({ ...point }))
    if (
      vertices.length < 4 ||
      vertices.length > maxVertices ||
      (finite(space.ping) && space.ping > maxPing) ||
      ['combined-functional-zone-frame', 'open-zone-near-frame'].includes(space.labelPlacement)
    ) return space

    let edgeSnapCount = 0
    for (const edge of spaceEdges({ ...space, vertices })) {
      const snap = closestEdgeSnap(edge, overlay)
      if (!snap || Math.abs(snap.delta) < 1) continue
      const target = Math.round(snap.target)
      if (edge.axis === 'v') {
        vertices[edge.aIndex].x = target
        vertices[edge.bIndex].x = target
      } else {
        vertices[edge.aIndex].y = target
        vertices[edge.bIndex].y = target
      }
      edgeSnapCount += 1
    }
    if (!edgeSnapCount) return space

    snaps.push({
      id: space.id || null,
      name: space.name || '',
      edgeSnapCount,
    })
    return {
      ...space,
      vertices,
    }
  })
  return { spaces: correctedSpaces, snaps }
}

function correctGlobalSpaceOffset(spaces, baseLayer, bounds) {
  const emptyDiagnostics = {
    applied: false,
    reason: 'not-run',
    offset: { x: 0, y: 0 },
    sampleCount: 0,
    xSampleCount: 0,
    ySampleCount: 0,
    xMedian: 0,
    yMedian: 0,
    xMad: 0,
    yMad: 0,
    localCorrectionCount: 0,
    edgeSnapCount: 0,
    overlayEdgeCount: 0,
    spaceEdgeCount: 0,
  }
  if (!spaces.length || !baseLayer?.previewLines?.length || !baseLayer?.pdfImport?.crop) {
    return {
      spaces,
      correction: {
        ...emptyDiagnostics,
        reason: !spaces.length ? 'no-spaces' : !baseLayer?.previewLines?.length ? 'no-preview-lines' : 'no-pdf-crop',
      },
    }
  }
  const placement = placementForBaseLayer(baseLayer, bounds)
  const overlay = overlayEdges(baseLayer, placement)
  const allSpaceEdges = spaces.flatMap(spaceEdges)
  if (overlay.length < 4) {
    return {
      spaces,
      correction: {
        ...emptyDiagnostics,
        reason: 'too-few-overlay-edges',
        overlayEdgeCount: overlay.length,
        spaceEdgeCount: allSpaceEdges.length,
      },
    }
  }

  const dx = []
  const dy = []
  for (const edge of allSpaceEdges) {
    const residual = closestResidual(edge, overlay)
    if (residual == null) continue
    if (edge.axis === 'v') dx.push(residual)
    else dy.push(residual)
  }
  const mx = median(dx)
  const my = median(dy)
  const mxMad = mad(dx, mx)
  const myMad = mad(dy, my)
  const xCorrection = __testSelectResidualCorrection(dx, {
    minClusterRatio: 0.65,
    minDominantClusterRatio: 0.65,
  })
  const yCorrection = __testSelectResidualCorrection(dy, {
    minClusterRatio: 0.65,
    minDominantClusterRatio: 0.65,
  })
  const xOk = xCorrection.ok
  const yOk = yCorrection.ok
  const diagnostics = {
    applied: false,
    reason: !dx.length && !dy.length
      ? 'no-edge-matches'
      : !xOk && !yOk
        ? 'inconsistent-or-small-offset'
        : 'applied',
    offset: { x: 0, y: 0 },
    sampleCount: dx.length + dy.length,
    xSampleCount: dx.length,
    ySampleCount: dy.length,
    xMedian: Number(mx.toFixed(1)),
    yMedian: Number(my.toFixed(1)),
    xMad: Number(mxMad.toFixed(1)),
    yMad: Number(myMad.toFixed(1)),
    xClusterMedian: xCorrection.clusterMedian,
    yClusterMedian: yCorrection.clusterMedian,
    xClusterMad: xCorrection.clusterMad,
    yClusterMad: yCorrection.clusterMad,
    xClusterCount: xCorrection.clusterCount,
    yClusterCount: yCorrection.clusterCount,
    xClusterRatio: xCorrection.clusterRatio,
    yClusterRatio: yCorrection.clusterRatio,
    localCorrectionCount: 0,
    edgeSnapCount: 0,
    overlayEdgeCount: overlay.length,
    spaceEdgeCount: allSpaceEdges.length,
  }
  if (!xOk && !yOk) {
    const local = correctLocalSpaceOffsets(spaces, overlay)
    const edgeSnap = snapSpaceEdgesToOverlay(local.spaces, overlay)
    if (local.corrections.length || edgeSnap.snaps.length) {
      return {
        spaces: edgeSnap.spaces,
        correction: {
          ...diagnostics,
          applied: true,
          reason: local.corrections.length ? 'local-corrections-applied' : 'edge-snaps-applied',
          localCorrectionCount: local.corrections.length,
          localCorrections: local.corrections,
          edgeSnapCount: edgeSnap.snaps.length,
          edgeSnaps: edgeSnap.snaps,
        },
      }
    }
    return { spaces, correction: diagnostics }
  }

  const offset = {
    x: xOk ? xCorrection.offset : 0,
    y: yOk ? yCorrection.offset : 0,
  }
  const globallyCorrectedSpaces = spaces.map(space => ({
    ...space,
    labelPosition: space.labelPosition ? {
      x: Math.round(space.labelPosition.x + offset.x),
      y: Math.round(space.labelPosition.y + offset.y),
    } : space.labelPosition,
    vertices: (space.vertices || []).map(point => ({
      x: Math.round(point.x + offset.x),
      y: Math.round(point.y + offset.y),
    })),
  }))
  const edgeSnap = snapSpaceEdgesToOverlay(globallyCorrectedSpaces, overlay)
  return {
    spaces: edgeSnap.spaces,
    correction: {
      ...diagnostics,
      applied: true,
      reason: 'applied',
      offset,
      edgeSnapCount: edgeSnap.snaps.length,
      edgeSnaps: edgeSnap.snaps,
    },
  }
}

// crop 像素座標 → 畫布 svg 座標的 placement 參數,跟 importRoomsToSpaces 算法一致,
// 確保門窗跟房間框落在同一座標系。
function cropToSvgPlacement(crop, placement, bounds) {
  const canvasBounds = bounds || { w: 4000, h: 3000 }
  const ok = placement && Number.isFinite(placement.offsetX) && Number.isFinite(placement.offsetY) &&
    Number.isFinite(placement.drawW) && Number.isFinite(placement.drawH) && placement.drawW > 0 && placement.drawH > 0
  const fit = ok ? null : Math.min((canvasBounds.w * 0.9) / crop.width, (canvasBounds.h * 0.9) / crop.height)
  const drawW = ok ? placement.drawW : crop.width * fit
  const drawH = ok ? placement.drawH : crop.height * fit
  const offsetX = ok ? placement.offsetX : (canvasBounds.w - drawW) / 2
  const offsetY = ok ? placement.offsetY : (canvasBounds.h - drawH) / 2
  return { offsetX, offsetY, drawW, drawH }
}

// 把 (crop 座標的) 門窗候選貼到房間框的邊上。回傳用 spaceIndex+edgeIndex 參照
// (id 在 button 才指派),門 maxDist 70、窗 50 (svg 單位 = cm)。
// export 給「🏠 AI 補小房間」共用:小房間框也要貼同一批 DXF 門窗。
export function attachOpeningsToSpaces(openings, spaces, crop, placement, bounds) {
  const empty = { doors: [], windows: [] }
  if (!openings || !spaces.length) return empty
  const { offsetX, offsetY, drawW, drawH } = cropToSvgPlacement(crop, placement, bounds)
  const toSvg = p => ({ x: offsetX + (p.x / crop.width) * drawW, y: offsetY + (p.y / crop.height) * drawH })
  const edges = []
  spaces.forEach((s, si) => {
    const vs = s.vertices || []
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length]
      edges.push({ si, ei: i, x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    }
  })
  const attach = (list, maxDist) => {
    const used = []
    const out = []
    for (const o of (list || [])) {
      const p = toSvg(o)
      let best = null
      for (const e of edges) {
        const dx = e.x2 - e.x1, dy = e.y2 - e.y1, len2 = dx * dx + dy * dy
        if (!len2) continue
        const t = ((p.x - e.x1) * dx + (p.y - e.y1) * dy) / len2
        if (t < 0.03 || t > 0.97) continue
        const dist = Math.hypot(p.x - (e.x1 + dx * t), p.y - (e.y1 + dy * t))
        if (!best || dist < best.dist) best = { e, t, dist }
      }
      if (!best || best.dist > maxDist) continue
      if (used.some(u => u.si === best.e.si && u.ei === best.e.ei && Math.abs(u.t - best.t) < 0.04)) continue
      used.push({ si: best.e.si, ei: best.e.ei, t: best.t })
      out.push({ spaceIndex: best.e.si, edgeIndex: best.e.ei, t: Number(best.t.toFixed(3)), width: Math.round(o.widthCm || 90) })
    }
    return out
  }
  return { doors: attach(openings.doors, 70), windows: attach(openings.windows, 50) }
}

// attach 結果 (spaceIndex/edgeIndex 參照) + 已指派 id 的 spaces → plan 的 doors/windows。
// wallId = space 邊 id (`edge-空間id-邊號`,renderer 已支援)。idFns = { door, window }。
// DxfPdfFrameButton (大房間) 與 AiRecognizeButton (AI 小房間) 共用,統一門窗 schema。
export function openingsToPlanDoorsWindows(att, spaces, idFns) {
  const wallId = (si, ei) => (spaces[si] ? `edge-${spaces[si].id}-${ei}` : null)
  const doors = (att?.doors || []).map(d => ({
    id: idFns.door(), wallId: wallId(d.spaceIndex, d.edgeIndex),
    t: d.t, width: d.width || 90, swing: 'in-right', type: 'single', source: 'dxf',
  })).filter(d => d.wallId)
  const windows = (att?.windows || []).map(w => ({
    id: idFns.window(), wallId: wallId(w.spaceIndex, w.edgeIndex),
    t: w.t, width: w.width || 150, sillHeight: 90, source: 'dxf',
  })).filter(w => w.wallId)
  return { doors, windows }
}

export function buildDxfPdfSpacesFromBaseLayer(baseLayer, bounds) {
  const crop = baseLayer?.pdfImport?.crop
  const rooms = baseLayer?.pdfImport?.preview?.rooms || []
  if (baseLayer?.importMode !== 'dxf-pdf' || !crop) {
    return {
      source: 'dxf-pdf-deterministic',
      spaces: [],
      doors: [],
      windows: [],
      meta: { totalRooms: 0, appliedRooms: 0, skippedRooms: 0 },
    }
  }

  // 小房間 (≤ SMALL_MAX 坪) DXF 幾何框不準,改交給「🏠 AI 補小房間」處理,
  // deterministic 這邊直接不框 (反正框錯)。坪數抓不到的不誤殺、照框。
  const SMALL_MAX = 6
  const bigRooms = rooms.filter(room => {
    const p = room.matchedPing ?? room.ping
    return !(Number.isFinite(p) && p <= SMALL_MAX)
  })
  const rawSpaces = importRoomsToSpaces(bigRooms, crop, bounds, baseLayer.placement, baseLayer.previewLines)
  const { spaces, correction } = correctGlobalSpaceOffset(rawSpaces, baseLayer, bounds)
  const { doors, windows } = attachOpeningsToSpaces(
    baseLayer?.pdfImport?.preview?.openings, spaces, crop, baseLayer.placement, bounds
  )
  return {
    source: 'dxf-pdf-deterministic',
    spaces,
    doors,
    windows,
    meta: {
      totalRooms: rooms.length,
      appliedRooms: spaces.length,
      skippedRooms: Math.max(0, rooms.length - spaces.length),
      smallRoomsForAi: rooms.length - bigRooms.length,
      doorCount: doors.length,
      windowCount: windows.length,
      postAlignmentCorrection: correction,
    },
  }
}
