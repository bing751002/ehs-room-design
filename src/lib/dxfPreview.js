const ARC_SEGMENTS = 32

const NOISE_LAYER_PATTERNS = [
  /^DEFPOINTS$/i,
  /^VIEWPORT/i,
  /TITLE.?BLOCK/i,
  /^BORDER$/i,
  /^\$/,
]

const NOISE_LAYER_WORDS = [
  '\u5bb6\u5177',       // furniture
  '\u8a2d\u5099',       // equipment
  '\u98fe\u54c1',       // accessories
  '\u885b\u6d74\u8a2d\u5099',
  '\u5929\u82b1',
  '\u5730\u9762',
  '\u5716\u6846',
  '\u5716\u7d19',
  '\u51fa\u5716',
  '\u5c3a\u5bf8',
  '\u6a19\u8a3b',
  '\u9001\u5be9',
  '\u5716\u4f8b',
]

const CLEAN_BASE_KEEP_LAYER_WORDS = [
  '\u5730\u9762\u9020\u578b',       // floor-shape room/base frame candidates
  '\u5929\u82b1\u9020\u578b',       // ceiling-shape frames used by some room outlines
  '\u9580\u7a97\u4e0a\u6846\u7dda', // door/window upper-frame draft lines
]

const NOISE_BLOCK_PATTERNS = [
  /^(\*U|A\$C)/i,
  /^Grid-Com$/i,
  /^laserjetplan$/i,
]

const NOISE_BLOCK_WORDS = [
  '\u6905',
  '\u6c99\u767c',
  '\u690d\u683d',
  '\u9762\u76c6',
  '\u4eba-',
]

const ARCH_LAYER_WORDS = [
  '\u9694\u9593\u7246',
  '\u627f\u91cd\u67f1\u7246',
  '\u7246\u9ad4',
  '\u9580',
  '\u6a13\u68af',
  '\u9632\u706b',
  '\u5e37\u5e55',
]

function isCleanBaseStructuralLayer(layer) {
  const text = String(layer || '')
  return (
    text.includes('\u9694\u9593\u7246') ||
    text.includes('\u627f\u91cd\u67f1\u7246') ||
    text.includes('\u7246\u9ad4') ||
    text.includes('\u9580') ||
    text.includes('\u7a97') ||
    text.includes('\u5e37\u5e55') ||
    text.includes('\u9632\u706b') ||
    text.includes('\u6a13\u68af') ||
    text.includes('\u5730\u9762\u9020\u578b') ||
    text.includes('\u5929\u82b1\u9020\u578b')
  )
}

function isFiniteCoord(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function isNoiseLayer(layer) {
  if (!layer) return false
  if (CLEAN_BASE_KEEP_LAYER_WORDS.some(word => layer.includes(word))) return false
  return NOISE_LAYER_PATTERNS.some(rx => rx.test(layer))
    || NOISE_LAYER_WORDS.some(word => layer.includes(word))
}

function isNoiseBlock(name) {
  if (!name) return false
  return NOISE_BLOCK_PATTERNS.some(rx => rx.test(name))
    || NOISE_BLOCK_WORDS.some(word => name.includes(word))
}

function transformForInsert(insertEntity, block, parentTransform) {
  const px = insertEntity.position?.x || 0
  const py = insertEntity.position?.y || 0
  const sx = insertEntity.xScale ?? 1
  const sy = insertEntity.yScale ?? 1
  const rot = (insertEntity.rotation || 0) * Math.PI / 180
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  const bx = block.position?.x || 0
  const by = block.position?.y || 0

  return (x, y) => {
    const lx = (x - bx) * sx
    const ly = (y - by) * sy
    return parentTransform(
      px + lx * cosR - ly * sinR,
      py + lx * sinR + ly * cosR
    )
  }
}

function computeBbox(lines) {
  if (!lines.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const l of lines) {
    minX = Math.min(minX, l.x1, l.x2)
    minY = Math.min(minY, l.y1, l.y2)
    maxX = Math.max(maxX, l.x1, l.x2)
    maxY = Math.max(maxY, l.y1, l.y2)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function dedupeLines(lines) {
  const seen = new Set()
  const out = []
  for (const line of lines || []) {
    const key = [
      Math.round(line.x1 * 10),
      Math.round(line.y1 * 10),
      Math.round(line.x2 * 10),
      Math.round(line.y2 * 10),
      line.layer || '',
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out
}

function keepRightDrawingCluster(lines) {
  if (!lines?.length) return lines

  const centers = lines
    .map(line => (line.x1 + line.x2) / 2)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (centers.length < 100) return lines

  const min = centers[0]
  const max = centers[centers.length - 1]
  const width = max - min
  if (width <= 0) return lines

  let gap = 0
  let gapIndex = -1
  for (let i = 1; i < centers.length; i++) {
    const d = centers[i] - centers[i - 1]
    if (d > gap) {
      gap = d
      gapIndex = i
    }
  }

  const leftCount = gapIndex
  const rightCount = centers.length - gapIndex
  const hasTwoSubstantialDrawings =
    gap > width * 0.18 &&
    leftCount > centers.length * 0.2 &&
    rightCount > centers.length * 0.2
  if (!hasTwoSubstantialDrawings) return lines

  const splitX = (centers[gapIndex - 1] + centers[gapIndex]) / 2
  return lines.filter(line => ((line.x1 + line.x2) / 2) >= splitX)
}

function shouldKeepLine(meta, dropped) {
  if (meta.sourceType === 'SPLINE') {
    dropped.spline++
    return false
  }
  if (!isCleanBaseStructuralLayer(meta.layer)) {
    dropped.layer++
    return false
  }
  if (isNoiseLayer(meta.layer)) {
    dropped.layer++
    return false
  }
  if (isNoiseBlock(meta.rootBlock) || isNoiseBlock(meta.childBlock)) {
    dropped.block++
    return false
  }
  if (meta.rootBlock && (meta.layer === '0' || !ARCH_LAYER_WORDS.some(word => meta.layer.includes(word)))) {
    dropped.layer++
    return false
  }
  return true
}

function pushLine(line, meta, out) {
  if (
    !isFiniteCoord(line.x1) || !isFiniteCoord(line.y1) ||
    !isFiniteCoord(line.x2) || !isFiniteCoord(line.y2)
  ) {
    out.meta.dropped.invalid++
    return
  }

  out.rawLineCount++
  if (!shouldKeepLine(meta, out.meta.dropped)) return

  out.lines.push({
    ...line,
    layer: meta.layer,
    sourceType: meta.sourceType,
    rootBlock: meta.rootBlock || null,
    childBlock: meta.childBlock || null,
  })
}

function arcToLines(cx, cy, r, startAngle, endAngle, transform, meta, out) {
  let span = endAngle - startAngle
  if (span <= 0) span += 360
  const segCount = Math.max(4, Math.ceil(ARC_SEGMENTS * span / 360))
  for (let i = 0; i < segCount; i++) {
    const a1 = (startAngle + (span * i / segCount)) * Math.PI / 180
    const a2 = (startAngle + (span * (i + 1) / segCount)) * Math.PI / 180
    const p1 = transform(cx + r * Math.cos(a1), cy + r * Math.sin(a1))
    const p2 = transform(cx + r * Math.cos(a2), cy + r * Math.sin(a2))
    pushLine({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, meta, out)
  }
}

function ellipseToLines(e, transform, meta, out) {
  const majorDx = e.majorAxisEndPoint?.x ?? 1
  const majorDy = e.majorAxisEndPoint?.y ?? 0
  const majorLen = Math.hypot(majorDx, majorDy)
  if (!majorLen) return
  const minorLen = majorLen * (e.axisRatio ?? 1)
  const rotation = Math.atan2(majorDy, majorDx)
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  let span = (e.endAngle ?? Math.PI * 2) - (e.startAngle ?? 0)
  if (span <= 0) span += 2 * Math.PI
  const segCount = Math.max(4, Math.ceil(ARC_SEGMENTS * span / (2 * Math.PI)))

  for (let i = 0; i < segCount; i++) {
    const a1 = (e.startAngle ?? 0) + (span * i / segCount)
    const a2 = (e.startAngle ?? 0) + (span * (i + 1) / segCount)
    const lx1 = majorLen * Math.cos(a1)
    const ly1 = minorLen * Math.sin(a1)
    const lx2 = majorLen * Math.cos(a2)
    const ly2 = minorLen * Math.sin(a2)
    const p1 = transform(e.center.x + lx1 * cosR - ly1 * sinR, e.center.y + lx1 * sinR + ly1 * cosR)
    const p2 = transform(e.center.x + lx2 * cosR - ly2 * sinR, e.center.y + lx2 * sinR + ly2 * cosR)
    pushLine({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, meta, out)
  }
}

function walkEntities(entities, dxf, transform, depth, out, rootBlock = null, childBlock = null) {
  if (!entities || depth > 8) return

  for (const e of entities) {
    const layer = e.layer || ''
    const meta = { layer, sourceType: e.type, rootBlock, childBlock }

    if (e.type === 'LINE' && e.vertices?.length >= 2) {
      const a = transform(e.vertices[0].x, e.vertices[0].y)
      const b = transform(e.vertices[1].x, e.vertices[1].y)
      pushLine({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, meta, out)
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length >= 2) {
      const vs = e.vertices.map(v => transform(v.x, v.y))
      for (let i = 0; i < vs.length - 1; i++) {
        pushLine({ x1: vs[i].x, y1: vs[i].y, x2: vs[i + 1].x, y2: vs[i + 1].y }, meta, out)
      }
      if ((e.shape || (e.flag & 1)) && vs.length >= 3) {
        pushLine({ x1: vs[vs.length - 1].x, y1: vs[vs.length - 1].y, x2: vs[0].x, y2: vs[0].y }, meta, out)
      }
    } else if (e.type === 'CIRCLE' && e.center && e.radius != null) {
      arcToLines(e.center.x, e.center.y, e.radius, 0, 360, transform, meta, out)
    } else if (e.type === 'ARC' && e.center && e.radius != null) {
      arcToLines(e.center.x, e.center.y, e.radius, e.startAngle ?? 0, e.endAngle ?? 360, transform, meta, out)
    } else if (e.type === 'ELLIPSE' && e.center) {
      ellipseToLines(e, transform, meta, out)
    } else if (e.type === 'SPLINE' && e.controlPoints?.length >= 2) {
      for (let i = 0; i < e.controlPoints.length - 1; i++) {
        const a = transform(e.controlPoints[i].x, e.controlPoints[i].y)
        const b = transform(e.controlPoints[i + 1].x, e.controlPoints[i + 1].y)
        pushLine({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, meta, out)
      }
    } else if (e.type === 'INSERT' && dxf.blocks?.[e.name]) {
      const nextRoot = rootBlock || e.name
      const nextChild = e.name
      if (isNoiseBlock(nextRoot) || isNoiseBlock(nextChild) || isNoiseLayer(layer)) {
        out.meta.dropped.insert++
        continue
      }
      const block = dxf.blocks[e.name]
      walkEntities(
        block.entities,
        dxf,
        transformForInsert(e, block, transform),
        depth + 1,
        out,
        nextRoot,
        nextChild
      )
    }
  }
}

export function extractDxfPreviewContent(dxf) {
  const out = {
    lines: [],
    rawLineCount: 0,
    bbox: null,
    meta: {
      dropped: {
        block: 0,
        insert: 0,
        invalid: 0,
        layer: 0,
        spline: 0,
      },
    },
  }

  walkEntities(dxf?.entities || [], dxf || {}, (x, y) => ({ x, y }), 0, out)
  out.lines = dedupeLines(out.lines)
  out.lines = keepRightDrawingCluster(out.lines)
  out.bbox = computeBbox(out.lines)
  return out
}
