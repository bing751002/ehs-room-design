import { callGeminiVision } from './aiVisionGemini.js'

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0))
}

async function loadBitmap(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('底圖下載失敗 ' + res.status)
  return await createImageBitmap(await res.blob())
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isTransientVisionError(error) {
  const text = String(error?.message || error || '')
  return text.includes('503') ||
    text.includes('UNAVAILABLE') ||
    text.includes('high demand') ||
    text.includes('RESOURCE_EXHAUSTED') ||
    text.includes('429')
}

async function callDoorVisionWithRetry(base64, mimeType, prompt, options, context = {}) {
  const delays = [900, 1800, 3600]
  let lastError = null
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await callGeminiVision(base64, mimeType, prompt, options)
    } catch (error) {
      lastError = error
      if (!isTransientVisionError(error) || attempt === delays.length) break
      const delay = delays[attempt]
      console.warn('[小房間門洞 VisionLM] 暫時性錯誤,稍後重試:', {
        room: context.room || '',
        retryMode: !!context.retryMode,
        attempt: attempt + 1,
        nextDelayMs: delay,
        error: String(error?.message || error),
      })
      await sleep(delay)
    }
  }
  throw lastError
}

function cropToSvgPlacement(crop, placement, bounds) {
  const canvasBounds = bounds || { w: 4000, h: 3000 }
  const ok = placement && finite(placement.offsetX) && finite(placement.offsetY) &&
    finite(placement.drawW) && finite(placement.drawH) && placement.drawW > 0 && placement.drawH > 0
  const fit = ok ? null : Math.min((canvasBounds.w * 0.9) / crop.width, (canvasBounds.h * 0.9) / crop.height)
  return {
    offsetX: ok ? placement.offsetX : (canvasBounds.w - crop.width * fit) / 2,
    offsetY: ok ? placement.offsetY : (canvasBounds.h - crop.height * fit) / 2,
    drawW: ok ? placement.drawW : crop.width * fit,
    drawH: ok ? placement.drawH : crop.height * fit,
  }
}

function svgToImagePoint(point, crop, placement) {
  return {
    x: ((point.x - placement.offsetX) / placement.drawW) * crop.width,
    y: ((point.y - placement.offsetY) / placement.drawH) * crop.height,
  }
}

function bboxOf(points) {
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (!len2) return { dist: Math.hypot(point.x - a.x, point.y - a.y), t: 0 }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2))
  const x = a.x + dx * t
  const y = a.y + dy * t
  return { dist: Math.hypot(point.x - x, point.y - y), t }
}

function edgeName(edge) {
  const dx = edge.b.x - edge.a.x
  const dy = edge.b.y - edge.a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dy >= 0 ? 'bottom/top' : 'top/bottom'
  return dx >= 0 ? 'right/left' : 'left/right'
}

function pointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

function leftNormalPointsInside(edge, polygon) {
  const dx = edge.b.x - edge.a.x
  const dy = edge.b.y - edge.a.y
  const len = Math.hypot(dx, dy)
  if (!len || polygon.length < 3) return true
  const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 }
  const probe = { x: mid.x + (-dy / len) * 12, y: mid.y + (dx / len) * 12 }
  return pointInPolygon(probe, polygon)
}

function inwardVisualSwing(edge, requestedSwing = 'in-right') {
  const side = String(requestedSwing || '').endsWith('left') ? 'left' : 'right'
  return `${edge.leftNormalInside ? 'in' : 'out'}-${side}`
}

function renderDoorWidthSvg(edge) {
  const len = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y)
  if (!Number.isFinite(len) || len <= 0) return undefined
  return Math.max(28, Math.min(72, len * 0.28))
}

function normalizeVisionDoors(payload) {
  const raw = Array.isArray(payload) ? payload : (payload?.doors || [])
  return raw
    .map(item => ({
      edgeRef: String(item.edgeRef || item.edge || '').trim(),
      t: clamp01(item.t ?? 0.5),
      swing: String(item.swing || 'in-right').trim(),
      confidence: Number(item.confidence ?? 0),
    }))
    .filter(item => item.edgeRef && /^(in|out)-(left|right)$/.test(item.swing) && item.confidence >= 0.45)
}

function fallbackDoorsFromCandidateEdges(edges, spaces, idFns, maxDist = 90) {
  const bySpace = new Map()
  for (const edge of edges) {
    if (edge.candidateT == null) continue
    if ((edge.candidateDist ?? 9999) > maxDist) continue
    const score = (edge.candidateDist ?? 9999) + Math.abs((edge.candidateT ?? 0.5) - 0.5) * 35
    const current = bySpace.get(edge.spaceIndex)
    if (!current || score < current.score) bySpace.set(edge.spaceIndex, { edge, score })
  }
  return [...bySpace.values()].map(({ edge }) => ({
    id: idFns.door(),
    wallId: `edge-${spaces[edge.spaceIndex].id}-${edge.edgeIndex}`,
    t: clamp01(edge.candidateT ?? 0.5),
    width: 90,
    renderWidthSvg: renderDoorWidthSvg(edge),
    swing: inwardVisualSwing(edge, 'in-right'),
    type: 'single',
    source: 'dxf-door-candidate-fallback',
    confidence: 0.45,
    _spaceIndex: edge.spaceIndex,
  }))
}

export async function recognizeSmallRoomDoorsVision({
  imageUrl,
  spaces,
  crop,
  placement,
  bounds,
  idFns,
  doorCandidates = [],
  retryMode = false,
}) {
  if (!imageUrl || !spaces?.length || !crop || !idFns?.door) return []
  if (spaces.length > 1) {
    const doors = []
    const roomResults = []
    for (const space of spaces) {
      try {
        let roomDoors = await recognizeSmallRoomDoorsVision({
          imageUrl,
          spaces: [space],
          crop,
          placement,
          bounds,
          idFns,
          doorCandidates,
        })
        if (!roomDoors.length) {
          roomDoors = await recognizeSmallRoomDoorsVision({
            imageUrl,
            spaces: [space],
            crop,
            placement,
            bounds,
            idFns,
            doorCandidates: [],
            retryMode: true,
          })
        }
        roomResults.push({ room: space?.name || '', doors: roomDoors.length })
        doors.push(...roomDoors)
      } catch (e) {
        roomResults.push({ room: space?.name || '', doors: 0, error: true })
        console.warn('[小房間門洞 VisionLM] 單房間辨識失敗:', space?.name, e)
      }
    }
    console.info('[小房間門洞 VisionLM] per-room total', {
      spaces: spaces.length,
      doors: doors.length,
      rooms: roomResults,
    })
    return doors
  }
  const bitmap = await loadBitmap(imageUrl)
  const place = cropToSvgPlacement(crop, placement, bounds)
  const spaceImages = spaces
    .map((space, spaceIndex) => {
      const points = (space.vertices || []).map(point => svgToImagePoint(point, crop, place))
      return { space, spaceIndex, points, box: bboxOf(points) }
    })
    .filter(item => item.points.length >= 3)
  if (!spaceImages.length) return []

  const allPoints = spaceImages.flatMap(item => item.points)
  const rawBox = bboxOf(allPoints)
  const singleRoomMode = spaceImages.length === 1
  const rawW = Math.max(1, rawBox.maxX - rawBox.minX)
  const rawH = Math.max(1, rawBox.maxY - rawBox.minY)
  const pad = singleRoomMode ? Math.max(130, Math.min(260, Math.max(rawW, rawH) * 0.7)) : 80
  const sx = Math.max(0, Math.floor(rawBox.minX - pad))
  const sy = Math.max(0, Math.floor(rawBox.minY - pad))
  const ex = Math.min(crop.width, Math.ceil(rawBox.maxX + pad))
  const ey = Math.min(crop.height, Math.ceil(rawBox.maxY + pad))
  const sw = Math.max(1, ex - sx)
  const sh = Math.max(1, ey - sy)
  const maxDim = singleRoomMode ? 1400 : 1600
  const maxScale = singleRoomMode ? 4 : 1
  const scale = Math.min(maxScale, maxDim / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  const toLocal = point => ({
    x: (point.x - sx) / sw,
    y: (point.y - sy) / sh,
  })
  const toCanvas = point => ({
    x: (point.x - sx) * scale,
    y: (point.y - sy) * scale,
  })

  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dw, dh)
  ctx.filter = retryMode ? 'contrast(1.9) brightness(1.08) saturate(0.15)' : 'contrast(1.45) saturate(0.35)'
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
  ctx.filter = 'none'

  const cleanedDoorCandidates = (doorCandidates || [])
    .filter(candidate => finite(candidate.x) && finite(candidate.y))
    .map(candidate => ({ x: candidate.x, y: candidate.y }))
  const requireDoorCandidate = cleanedDoorCandidates.length > 0 && !retryMode
  const edges = []
  ctx.save()
  ctx.lineWidth = Math.max(2, Math.round(Math.min(dw, dh) * 0.004))
  ctx.font = `${Math.max(15, Math.round(Math.min(dw, dh) * 0.022))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  spaceImages.forEach(({ space, spaceIndex, points }) => {
    const canvasPoints = points.map(toCanvas)
    ctx.beginPath()
    canvasPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(37,99,235,0.02)'
    ctx.strokeStyle = '#2563eb'
    ctx.setLineDash([10, 8])
    ctx.stroke()
    ctx.setLineDash([])

    const roomEdges = []
    for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex++) {
      const a = points[edgeIndex]
      const b = points[(edgeIndex + 1) % points.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 35) continue
      let nearestDoorCandidate = null
      if (requireDoorCandidate) {
        for (const candidate of cleanedDoorCandidates) {
          const hit = pointToSegmentDistance(candidate, a, b)
          if (!nearestDoorCandidate || hit.dist < nearestDoorCandidate.dist) {
            nearestDoorCandidate = { ...hit, candidate }
          }
        }
      }
      roomEdges.push({ edgeIndex, a, b, nearestDoorCandidate })
    }

    const hasTrustedCandidateEdge = roomEdges.some(edge => edge.nearestDoorCandidate && edge.nearestDoorCandidate.dist <= 160)
    for (const edgeItem of roomEdges) {
      const { edgeIndex, a, b, nearestDoorCandidate } = edgeItem
      const candidateTrusted = !!nearestDoorCandidate && nearestDoorCandidate.dist <= 160
      if (requireDoorCandidate && hasTrustedCandidateEdge && !candidateTrusted) continue
      const ref = `s${spaceIndex}e${edgeIndex}`
      const mid = toCanvas({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.max(1, Math.hypot(dx, dy))
      const label = { x: mid.x + (-dy / len) * 22, y: mid.y + (dx / len) * 22 }
      ctx.fillStyle = candidateTrusted ? 'rgba(220,38,38,0.95)' : 'rgba(234,88,12,0.85)'
      ctx.beginPath()
      ctx.arc(mid.x, mid.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.strokeText(ref, label.x, label.y)
      ctx.fillText(ref, label.x, label.y)
      edges.push({
        ref,
        spaceIndex,
        edgeIndex,
        roomName: space.name || '',
        hint: edgeName({ a, b }),
        leftNormalInside: leftNormalPointsInside({ a, b }, points),
        candidateTrusted,
        candidateT: nearestDoorCandidate?.t ?? null,
        candidateDist: nearestDoorCandidate?.dist ?? null,
        a: toLocal(a),
        b: toLocal(b),
      })
    }
  })
  ctx.restore()
  console.info('[小房間門洞 VisionLM] candidate edges', {
    spaces: spaces.length,
    doorCandidates: cleanedDoorCandidates.length,
    edges: edges.length,
    refs: edges.map(edge => ({
      ref: edge.ref,
      room: edge.roomName,
      t: edge.candidateT == null ? null : Number(edge.candidateT.toFixed(2)),
      dist: edge.candidateDist == null ? null : Math.round(edge.candidateDist),
      trusted: edge.candidateTrusted,
    })),
  })
  if (!edges.length) return []

  const base64 = canvas.toDataURL('image/png').split(',')[1]
  const prompt = `你正在看辦公室平面圖的小房間局部裁切圖。

圖上藍色半透明框是已確認的小房間範圍，紅色標籤是可放門的房間邊 edgeRef。

任務：
1. 只辨識「真的門」：看得到淡灰色門弧線、門扇弧、或明確牆上缺口即可。
2. 不要把桌椅、家具、文字標籤、窗、牆線中斷、藍色或紅色標註當成門。
3. 可選 edge 若有 candidateT，表示 DXF 門候選靠近該 edge；請優先檢查 candidateT 附近。若 candidateT 為 none，表示該房間沒有可靠 DXF 門候選，只能靠底圖肉眼確認。
4. 每個真的門輸出它所在的 edgeRef，以及門中心在該 edge 上的 t 值 0~1。若 edge 清單提供 candidateT，請優先以 candidateT 附近判斷，不要跳到遠處。
5. 小房間門一律視為向房內開；系統會用房間 polygon 自動修正內外方向。你只需要判斷合葉在左或右，輸出 in-left 或 in-right。
6. 如果門弧線被紅色 edgeRef 標籤部分遮住，但該 edge 附近仍可看出門洞，請輸出。
7. 看不準才不要輸出；不要因為圖面線細就全部輸出空陣列。

可選 edge 清單：
${edges.map(edge => `- ${edge.ref}: room="${edge.roomName}", edgeIndex=${edge.edgeIndex}, roughSide=${edge.hint}, trustedDxfCandidate=${edge.candidateTrusted ? 'yes' : 'no'}, candidateT=${edge.candidateT == null ? 'none' : edge.candidateT.toFixed(2)}, a=[${edge.a.x.toFixed(3)},${edge.a.y.toFixed(3)}], b=[${edge.b.x.toFixed(3)},${edge.b.y.toFixed(3)}]`).join('\n')}

請只輸出 JSON：
{
  "doors": [
    {"edgeRef":"s0e2","t":0.42,"swing":"in-right","confidence":0.82}
  ]
}`
  const parsed = await callDoorVisionWithRetry(base64, 'image/png', prompt, {
    systemInstruction: retryMode
      ? '你是嚴謹但偏向召回率的 CAD 平面圖門洞辨識器。只要可見淡灰門弧、門扇弧或牆洞，就輸出 JSON；不要輸出家具。'
      : '你是嚴謹的 CAD 平面圖門洞辨識器。只根據可見門弧與牆洞輸出 JSON，不要猜。'
  }, { room: spaceImages[0]?.space?.name || '', retryMode })
  const edgeMap = new Map(edges.map(edge => [edge.ref, edge]))
  const used = new Set()
  const visionDoors = normalizeVisionDoors(parsed)
    .map(item => {
      const edge = edgeMap.get(item.edgeRef)
      if (!edge) return null
      const key = `${edge.spaceIndex}-${edge.edgeIndex}-${Math.round(item.t * 20)}`
      if (used.has(key)) return null
      used.add(key)
      const space = spaces[edge.spaceIndex]
      return {
        id: idFns.door(),
        wallId: `edge-${space.id}-${edge.edgeIndex}`,
        t: item.t,
        width: 90,
        renderWidthSvg: renderDoorWidthSvg(edge),
        swing: inwardVisualSwing(edge, item.swing),
        type: 'single',
        source: 'vision-door',
        confidence: item.confidence,
        _spaceIndex: edge.spaceIndex,
      }
    })
    .filter(Boolean)
  const fallbackDoors = fallbackDoorsFromCandidateEdges(edges, spaces, idFns, retryMode ? 135 : 90)
  const visionSpaces = new Set(visionDoors.map(door => door._spaceIndex))
  const mergedDoors = [
    ...visionDoors,
    ...fallbackDoors.filter(door => !visionSpaces.has(door._spaceIndex)),
  ].map(({ _spaceIndex, ...door }) => door)
  console.info('[小房間門洞 VisionLM] result', {
    visionDoors: visionDoors.length,
    fallbackDoors: fallbackDoors.length,
    mergedDoors: mergedDoors.length,
  })
  return mergedDoors
}
