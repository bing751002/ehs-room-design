import { polygonVisualCenter } from './constraints.js'

/**
 * DXF → 結構化空間物件抽取 (DWG 新流程的心臟)
 *
 * 為什麼存在:
 *   DWG/DXF 是向量檔,房名/坪數/家具/牆全是現成的結構化資料,
 *   不該渲染成圖再叫 vision 猜。本模組直接從幾何抽出「空間物件」,
 *   全程待在 model space 的 mm 座標,沒有渲染圖/normalized/viewport 的比例尺誤差。
 *
 * 設計事實 (實測 東森林口22F 圖歸納,見 test-fixtures):
 *   - 中文視版本可能 Big5(2004 以前) 或 UTF-8(2007+) → 呼叫端用 decodeDxfText()
 *     自動嗅探解碼後再 parse(不可只信 $DWGCODEPAGE,2018 檔欄位仍殘留 ANSI_950)
 *   - 房名+坪數鎖在 paper space 的匿名 block (座標 0~209,小尺度)
 *   - 房間邊界是現成的封閉 polyline (地面造型 layer,model space,mm)
 *   - 房名 → 房間框靠「坪數當鑰匙 + paper→model 位置配準」綁定
 *   - 家具/設備是 INSERT 圖塊 (model space,有世界座標)
 *
 * 用法:
 *   const dxf = new DxfParser().parseSync(decodeDxfText(arrayBuffer))
 *   const spaces = extractSpaceObjects(dxf)
 */

const PING_M2 = 3.305785  // 1 坪 = 3.305785 m²

// ---- 幾何 ----
function shoelace(vs) {
  let a = 0
  for (let i = 0; i < vs.length; i++) { const j = (i + 1) % vs.length; a += vs[i].x * vs[j].y - vs[j].x * vs[i].y }
  return Math.abs(a) / 2
}
function centroid(vs) {
  let x = 0, y = 0
  for (const v of vs) { x += v.x; y += v.y }
  return { x: x / vs.length, y: y / vs.length }
}
function bboxOf(vs) {
  let a = [Infinity, Infinity, -Infinity, -Infinity]
  for (const v of vs) { a[0] = Math.min(a[0], v.x); a[1] = Math.min(a[1], v.y); a[2] = Math.max(a[2], v.x); a[3] = Math.max(a[3], v.y) }
  return a
}
const mm2ToPing = a => a / 1e6 / PING_M2

function cleanText(s) {
  return String(s || '')
    .replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim()
}

/**
 * DXF 中文解碼。呼叫端拿 ArrayBuffer/Uint8Array。
 *
 * 不信任 $DWGCODEPAGE:AutoCAD 2007+ (DXF 版本 AC1021/2018 AC1032…) 內部一律存
 * UTF-8,但 $DWGCODEPAGE 仍殘留舊的 ANSI_950/ANSI_936 欄位,直接照欄位用 Big5
 * 會把整份 UTF-8 layer 名解成亂碼 → 牆線 layer 白名單全 miss → 房間框抽不到。
 * 改成嗅探:UTF-8 / Big5 / GBK 各解一次,取「替換字元 (U+FFFD) 最少」的結果。
 * UTF-8 對非法序列會產生 U+FFFD,Big5/GBK 幾乎不會,所以亂碼解法會被自然淘汰。
 * codepage 欄位只在分數接近時當 tie-breaker。
 */
export function decodeDxfText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4000))
  const m = head.match(/\$DWGCODEPAGE\s*\n\s*3\s*\n([^\n\r]+)/)
  const cp = (m ? m[1].trim() : '').toLowerCase()
  const hinted = /950|big5/.test(cp) ? 'big5'
    : /936|gbk|gb2312/.test(cp) ? 'gbk'
    : /utf|65001/.test(cp) ? 'utf-8'
    : null

  const candidates = ['utf-8', 'big5', 'gbk']
  let best = null
  for (const enc of candidates) {
    let text
    try { text = new TextDecoder(enc, { fatal: false }).decode(bytes) }
    catch { continue }
    // 替換字元越少越好;相同時偏好 codepage 欄位指定的編碼
    const replacements = (text.match(/�/g) || []).length
    const score = replacements - (enc === hinted ? 0.5 : 0)
    if (!best || score < best.score) best = { enc, text, score, replacements }
  }
  // 全部失敗的極端情況才退回 Big5
  if (!best) return new TextDecoder('big5').decode(bytes)
  return best.text
}

/**
 * 遞迴展開 entities,收集世界座標下的:封閉 polyline / 文字 / INSERT。
 * tf: 局部→世界座標轉換函數。
 */
function walk(entities, blocks, tf, depth, sink) {
  if (depth > 8 || !entities) return
  for (const e of entities) {
    if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length >= 3) {
      if (!(e.shape || (e.flag & 1))) continue
      const vs = e.vertices.map(v => tf(v.x, v.y))
      sink.polys.push({ layer: e.layer || '', vs, area: shoelace(vs) })
    } else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text != null) {
      const lx = e.startPoint?.x ?? e.position?.x ?? 0, ly = e.startPoint?.y ?? e.position?.y ?? 0
      const p = tf(lx, ly)
      const c = cleanText(e.text)
      if (c) sink.texts.push({ c, x: p.x, y: p.y, layer: e.layer || '' })
    } else if (e.type === 'INSERT' && blocks[e.name]) {
      const b = blocks[e.name]
      const bx = b.position?.x || 0, by = b.position?.y || 0
      const px = e.position?.x || 0, py = e.position?.y || 0
      const sx = e.xScale ?? 1, sy = e.yScale ?? 1
      const r = (e.rotation || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r)
      const childTf = (x, y) => { const ax = (x - bx) * sx, ay = (y - by) * sy; return tf(px + ax * cos - ay * sin, py + ax * sin + ay * cos) }
      sink.inserts.push({ name: e.name, layer: e.layer || '', pos: tf(px, py) })
      walk(b.entities, blocks, childTf, depth + 1, sink)
    }
  }
}

/** 從房名文字抽坪數 (取「數字P」,排除誤抓如 UP/REF) */
function parsePing(c) {
  const m = c.match(/(\d+(?:\.\d+)?)\s*P(?![a-zA-Z])/)
  return m ? parseFloat(m[1]) : null
}
function roomDisplayName(c) {
  return c.replace(/\s*\d+(?:\.\d+)?\s*P.*$/, '').trim() || c
}

function leadingPersonCount(name) {
  const m = String(name || '').match(/^(\d+)\s*\u4eba/)
  return m ? Number(m[1]) : null
}

function duplicateRoomKey(label) {
  const name = String(label?.name || '')
  const suffix = name.replace(/^\d+\s*\u4eba/, '')
  if (!suffix || suffix === name) return null
  return `${label.ping}:${suffix}`
}

function consolidateRoomLabels(labels) {
  const groups = new Map()
  for (const label of labels) {
    const key = duplicateRoomKey(label)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(label)
  }
  const replacement = new Map()
  const dropped = new Set()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const withCounts = group.map(label => ({ label, count: leadingPersonCount(label.name) ?? -1 }))
    const nameSource = withCounts.reduce((best, item) => item.count > best.count ? item : best, withCounts[0]).label
    const coordSource = group.reduce((best, item) => (item.blockLabelCount || 0) > (best.blockLabelCount || 0) ? item : best, group[0])
    if (nameSource === coordSource) continue
    replacement.set(coordSource, { ...coordSource, name: nameSource.name, originalName: coordSource.name })
    for (const item of group) if (item !== coordSource) dropped.add(item)
  }
  return labels
    .filter(label => !dropped.has(label))
    .map(label => replacement.get(label) || label)
}

const NON_ROOM_FRAME_WORDS = [
  '\u51fa\u5716\u7bc4\u570d',
  '\u5716\u8aaa',
  '\u5716\u4f8b',
  '\u6587\u5b57',
  '\u5c3a\u5bf8',
  '\u6a19\u8a3b',
  'HATCH',
]

function isRoomFrameLayer(layer) {
  if (!layer) return true
  return !NON_ROOM_FRAME_WORDS.some(word => layer.includes(word))
}

/** 2D 相似變換 (scale+rotation+translation) 最小二乘擬合。src→dst。 */
function estimateSimilarity(src, dst) {
  const n = src.length
  if (n < 2) return null
  let cs = { x: 0, y: 0 }, cd = { x: 0, y: 0 }
  for (let i = 0; i < n; i++) { cs.x += src[i].x; cs.y += src[i].y; cd.x += dst[i].x; cd.y += dst[i].y }
  cs.x /= n; cs.y /= n; cd.x /= n; cd.y /= n
  let sumAB = 0, sumCross = 0, varS = 0
  for (let i = 0; i < n; i++) {
    const ax = src[i].x - cs.x, ay = src[i].y - cs.y
    const bx = dst[i].x - cd.x, by = dst[i].y - cd.y
    sumAB += ax * bx + ay * by
    sumCross += ax * by - ay * bx
    varS += ax * ax + ay * ay
  }
  if (varS === 0) return null
  const theta = Math.atan2(sumCross, sumAB)
  const scale = Math.sqrt(sumAB * sumAB + sumCross * sumCross) / varS
  const cos = Math.cos(theta) * scale, sin = Math.sin(theta) * scale
  const tx = cd.x - (cos * cs.x - sin * cs.y)
  const ty = cd.y - (sin * cs.x + cos * cs.y)
  return (x, y) => ({ x: cos * x - sin * y + tx, y: sin * x + cos * y + ty })
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))
  return sorted[idx]
}

function preferredRoomLayerPenalty(layer) {
  const s = String(layer || '')
  if (s.includes('\u5730\u9762\u9020\u578b')) return 0
  if (s.includes('\u5929\u82b1\u9020\u578b')) return 1
  if (s === '0') return 0.2
  return 0.1
}

function estimatePaperToModelByExtents(rawNames, frames, matchTol) {
  if (!rawNames.length || !frames.length) return null
  const candidateFrames = []
  for (const n of rawNames) {
    for (const f of frames) {
      const pErr = Math.abs(f.ping - n.ping) / n.ping
      if (pErr <= matchTol + 0.04) candidateFrames.push(f)
    }
  }
  const pool = candidateFrames.length >= 4 ? candidateFrames : frames
  const labelMinX = Math.min(...rawNames.map(n => n.x))
  const labelMaxX = Math.max(...rawNames.map(n => n.x))
  const labelMinY = Math.min(...rawNames.map(n => n.y))
  const labelMaxY = Math.max(...rawNames.map(n => n.y))
  if (labelMaxX === labelMinX || labelMaxY === labelMinY) return null

  const minX = percentile(pool.map(f => f.c.x), 0.05)
  const maxX = percentile(pool.map(f => f.c.x), 0.95)
  const minY = percentile(pool.map(f => f.c.y), 0.05)
  const maxY = percentile(pool.map(f => f.c.y), 0.95)
  if ([minX, maxX, minY, maxY].some(v => v == null) || maxX === minX || maxY === minY) return null

  const sx = (maxX - minX) / (labelMaxX - labelMinX)
  const sy = (maxY - minY) / (labelMaxY - labelMinY)
  return (x, y) => ({
    x: minX + (x - labelMinX) * sx,
    y: minY + (y - labelMinY) * sy,
  })
}

/**
 * 主函數:parsed dxf → 空間物件
 * @returns {{
 *   rooms: Array<{name,ping,vertices,cx,cy,frameLayer,pingError,matchConfidence}>,
 *   furniture: Array<{name,layer,x,y,count?}>,
 *   meta: {...}
 * }}
 */
export function extractSpaceObjects(dxf, opts = {}) {
  const { minPing = 1, maxPing = 120, matchTol = 0.2 } = opts
  const blocks = dxf.blocks || {}
  const ents = dxf.entities || []

  // 1) 展開 model space (頂層) → 封閉框 / 家具 INSERT
  const sink = { polys: [], texts: [], inserts: [] }
  walk(ents, blocks, (x, y) => ({ x, y }), 0, sink)

  // 2) 房間框候選:房間級面積的封閉 polyline
  const frames = sink.polys
    .map(p => ({ ...p, ping: mm2ToPing(p.area), c: centroid(p.vs) }))
    .filter(p => p.ping >= minPing && p.ping <= maxPing && isRoomFrameLayer(p.layer))

  // 3) 房名:掃所有 block 定義 (坪數房名鎖在 paper space block,用原始座標)
  const rawNames = []
  const blockRoomLabelCount = new Map()
  for (const b of Object.values(blocks)) {
    if (!b.entities) continue
    let count = 0
    for (const e of b.entities) {
      if ((e.type !== 'TEXT' && e.type !== 'MTEXT') || e.text == null) continue
      if (parsePing(cleanText(e.text)) != null) count++
    }
    blockRoomLabelCount.set(b.name, count)
  }
  for (const b of Object.values(blocks)) {
    if (!b.entities) continue
    for (const e of b.entities) {
      if ((e.type !== 'TEXT' && e.type !== 'MTEXT') || e.text == null) continue
      const c = cleanText(e.text)
      const ping = parsePing(c)
      if (ping == null) continue
      const x = e.startPoint?.x ?? e.position?.x, y = e.startPoint?.y ?? e.position?.y
      if (x != null && y != null) rawNames.push({
        name: roomDisplayName(c),
        ping, x, y,
        blockName: b.name,
        blockLabelCount: blockRoomLabelCount.get(b.name) || 0,
      })
    }
  }
  const roomLabels = consolidateRoomLabels(rawNames)

  // 4) paper→model 配準:用坪數「唯一」的房名↔框建對應點,擬合相似變換
  const pingCount = {}
  for (const n of roomLabels) pingCount[n.ping] = (pingCount[n.ping] || 0) + 1
  const frameByPing = {}
  for (const f of frames) { const k = f.ping.toFixed(1); (frameByPing[k] = frameByPing[k] || []).push(f) }
  const roughPaperToModel = estimatePaperToModelByExtents(roomLabels, frames, matchTol)
  const anchors = []
  for (const n of roomLabels) {
    if (pingCount[n.ping] !== 1) continue       // 房名坪數唯一
    // 找坪數最接近且唯一的框
    const rough = roughPaperToModel ? roughPaperToModel(n.x, n.y) : null
    let best = null, be = Infinity
    for (const f of frames) {
      const err = Math.abs(f.ping - n.ping) / n.ping
      if (err > matchTol + 0.04) continue
      const d = rough ? Math.hypot(f.c.x - rough.x, f.c.y - rough.y) : 0
      const score = err * 1.5 + d / 18000 + preferredRoomLayerPenalty(f.layer)
      if (score < be) { be = score; best = f }
    }
    if (best && be < matchTol) anchors.push({ src: { x: n.x, y: n.y }, dst: best.c })
  }
  const paperToModel = estimateSimilarity(anchors.map(a => a.src), anchors.map(a => a.dst)) || roughPaperToModel

  // 5) 每個房名 → 投影到 model,坪數+距離貪婪配框 (配掉的框不重用)
  const usedFrame = new Set()
  const rooms = []
  // 大房間先配 (坪數指紋更獨特)
  for (const n of [...roomLabels].sort((a, b) => b.ping - a.ping)) {
    const proj = paperToModel ? paperToModel(n.x, n.y) : null
    let best = null, bestScore = Infinity, bestIdx = -1
    frames.forEach((f, i) => {
      if (usedFrame.has(i)) return
      const pErr = Math.abs(f.ping - n.ping) / n.ping
      if (pErr > matchTol) return
      // 分數 = 坪數誤差 + 位置距離(若有變換)正規化
      let score = pErr + preferredRoomLayerPenalty(f.layer)
      if (proj) {
        const d = Math.hypot(f.c.x - proj.x, f.c.y - proj.y)
        score = pErr * 1.6 + d / 15000 + preferredRoomLayerPenalty(f.layer)
      }
      if (score < bestScore) { bestScore = score; best = f; bestIdx = i }
    })
    if (best) {
      usedFrame.add(bestIdx)
      const labelPoint = proj || best.c
      rooms.push({
        name: n.name, ping: n.ping,
        vertices: best.vs.map(v => ({ x: Math.round(v.x), y: Math.round(v.y) })),
        cx: Math.round(best.c.x), cy: Math.round(best.c.y),
        labelX: Math.round(labelPoint.x), labelY: Math.round(labelPoint.y),
        frameLayer: best.layer, framePing: +best.ping.toFixed(2),
        pingError: +(Math.abs(best.ping - n.ping) / n.ping).toFixed(3),
      })
    } else {
      rooms.push({ name: n.name, ping: n.ping, vertices: null, matched: false, paperXY: { x: Math.round(n.x), y: Math.round(n.y) } })
    }
  }

  // 6) 家具/設備:INSERT 圖塊統計 (排除匿名 *U / A$C / 系統)
  const furnMap = {}
  for (const ins of sink.inserts) {
    const nm = cleanText(ins.name)
    if (/^(\*[UMD]|A\$C|_)/i.test(nm)) continue   // 匿名/自動命名圖塊跳過
    const key = nm
    if (!furnMap[key]) furnMap[key] = { name: nm, layer: ins.layer, count: 0, samples: [] }
    furnMap[key].count++
    if (furnMap[key].samples.length < 3) furnMap[key].samples.push({ x: Math.round(ins.pos.x), y: Math.round(ins.pos.y) })
  }
  const furniture = Object.values(furnMap).sort((a, b) => b.count - a.count)

  return {
    rooms,
    furniture,
    meta: {
      framesFound: frames.length,
      roomNamesFound: roomLabels.length,
      roomsMatched: rooms.filter(r => r.vertices).length,
      anchorsUsed: anchors.length,
      registered: !!paperToModel,
      totalInserts: sink.inserts.length,
      totalPolys: sink.polys.length,
    }
  }
}

/**
 * 產生「乾淨底圖線」— 用房間範圍裁掉離群點 + 只留牆/柱/隔間/門 layer。
 * 解決:① 遠處離群 entity 把 bbox 撐爆 → 主體壓縮 + 星爆放射線
 *      ② 幾十萬條家具/軸線/標註糊成一團
 *      ③ 27MB dxfLines 存雲端過大
 * 沒有房間範圍 (純線稿 DXF) → 回 null,呼叫端維持原樣不裁。
 *
 * @param {Array} lines - extractDxfContent 的 lines [{x1,y1,x2,y2,layer,color}]
 * @param {Array} rooms - extractSpaceObjects().rooms
 * @returns {{lines, bbox}|null}
 */
export function buildCleanBaseLayer(lines, rooms) {
  const withV = (rooms || []).filter(r => r.vertices)
  if (!withV.length) return null

  let b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of withV) for (const v of r.vertices) {
    b[0] = Math.min(b[0], v.x); b[1] = Math.min(b[1], v.y)
    b[2] = Math.max(b[2], v.x); b[3] = Math.max(b[3], v.y)
  }
  const mx = (b[2] - b[0]) * 0.12 || 1000, my = (b[3] - b[1]) * 0.12 || 1000
  const ext = { minX: b[0] - mx, minY: b[1] - my, maxX: b[2] + mx, maxY: b[3] + my }
  const inExt = (x, y) => x >= ext.minX && x <= ext.maxX && y >= ext.minY && y <= ext.maxY
  const wallRe = /牆|墙|柱|隔間|隔间|門|门|wall|column|door|partition/i

  let out = lines.filter(l => (inExt(l.x1, l.y1) || inExt(l.x2, l.y2)) && wallRe.test(l.layer || ''))
  if (out.length < 20) {
    // 牆 layer 命名對不上 → 放寬:只裁離群,保留主體內全部線
    out = lines.filter(l => inExt(l.x1, l.y1) || inExt(l.x2, l.y2))
  }
  return {
    lines: out,
    bbox: {
      minX: ext.minX, minY: ext.minY, maxX: ext.maxX, maxY: ext.maxY,
      width: Math.max(1, ext.maxX - ext.minX), height: Math.max(1, ext.maxY - ext.minY),
    }
  }
}

/**
 * 把抽出的房間 (model space mm 座標) 轉成畫布 spaces (svg unit)。
 * 用 baseLayer.bbox + placement 映射,跟 Canvas2D 渲染底圖、finalizeToSvg 同一套座標系,
 * 確保房間框疊在底圖正確位置。回傳「不含 id」的 space 物件,呼叫端補 id。
 *
 * @param {Array} rooms - extractSpaceObjects().rooms
 * @param {Object} baseLayer - 含 bbox + placement (BaseLayerUpload 設好後)
 */
function mapModelPointToSvg(point, bbox, placement) {
  if (!point || !bbox || !placement) return null
  return {
    x: Math.round(placement.offsetX + ((point.x - bbox.minX) / bbox.width) * placement.drawW),
    y: Math.round(placement.offsetY + ((bbox.maxY - point.y) / bbox.height) * placement.drawH),
  }
}

export function roomsToPlanSpaces(rooms, baseLayer) {
  const bbox = baseLayer?.bbox
  if (!bbox || !bbox.width || !bbox.height) return []
  const p = baseLayer.placement
  if (!p) return []
  const { offsetX: xOff, offsetY: yOff, drawW, drawH } = p
  return (rooms || [])
    .filter(r => r.vertices && r.vertices.length >= 3)
    .map(r => {
      const vertices = r.vertices.map(v => ({
        // DXF model uses Y-up coordinates; SVG uses Y-down coordinates.
        x: Math.round(xOff + ((v.x - bbox.minX) / bbox.width) * drawW),
        y: Math.round(yOff + ((bbox.maxY - v.y) / bbox.height) * drawH),
      }))
      const projectedLabel = Number.isFinite(r.labelX) && Number.isFinite(r.labelY)
        ? mapModelPointToSvg({ x: r.labelX, y: r.labelY }, bbox, p)
        : null
      const labelPosition = projectedLabel || polygonVisualCenter(vertices)
      return {
      name: r.name,
      ping: r.ping,
      labelPosition,
      height: 280, color: '#e2e8f0', wallKind: 'interior', wallThickness: 12,
      source: 'dxf',            // 標記來源,跟 vision 出的 space 區分
      framePing: r.framePing,
      framePing: r.framePing,
      vertices,
        // DXF model (y 向上) → 圖像 normalized (y 向下) → svg
      }
    })
}

const DOOR_WORD = '\u9580'
const WINDOW_WORD = '\u7a97'
const CURTAIN_WORD = '\u5e37\u5e55'
const NUMBER_WORD = '\u7de8\u865f'
const FRAME_WORD = '\u6846'
const UPPER_WORD = '\u4e0a'
const LINE_WORD = '\u7dda'

function hasWord(value, word) {
  return String(value || '').includes(word)
}

function isDoorCandidateLayer(layer) {
  return hasWord(layer, DOOR_WORD) && !hasWord(layer, NUMBER_WORD)
}

function isWindowCandidateLayer(layer) {
  const s = String(layer || '')
  if (s.includes(NUMBER_WORD)) return false
  if (s.includes(WINDOW_WORD) && s.includes(UPPER_WORD) && s.includes(FRAME_WORD)) return false
  if (s.includes(WINDOW_WORD) && s.includes(FRAME_WORD) && s.includes(LINE_WORD)) return false
  return s.includes(WINDOW_WORD) || s.includes(CURTAIN_WORD)
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

function bboxFromPoints(points) {
  if (!points.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function entityPoints(e, tf, blocks, depth = 0) {
  if (!e || depth > 6) return []
  if ((e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length) {
    return e.vertices.map(v => tf(v.x, v.y))
  }
  if ((e.type === 'ARC' || e.type === 'CIRCLE') && e.center && e.radius != null) {
    return [
      tf(e.center.x - e.radius, e.center.y - e.radius),
      tf(e.center.x + e.radius, e.center.y + e.radius),
    ]
  }
  if (e.type === 'INSERT' && blocks?.[e.name]) {
    const block = blocks[e.name]
    const childTf = localInsertTransform(e, block, tf)
    return (block.entities || []).flatMap(child => entityPoints(child, childTf, blocks, depth + 1))
  }
  return []
}

function lineSegmentsFromEntity(e, tf, blocks, depth = 0) {
  if (!e || depth > 6) return []
  const out = []
  if (e.type === 'LINE' && e.vertices?.length >= 2) {
    const a = tf(e.vertices[0].x, e.vertices[0].y)
    const b = tf(e.vertices[1].x, e.vertices[1].y)
    out.push({ a, b, layer: e.layer || '' })
  } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length >= 2) {
    const vs = e.vertices.map(v => tf(v.x, v.y))
    for (let i = 0; i < vs.length - 1; i++) out.push({ a: vs[i], b: vs[i + 1], layer: e.layer || '' })
    if ((e.shape || (e.flag & 1)) && vs.length >= 3) out.push({ a: vs[vs.length - 1], b: vs[0], layer: e.layer || '' })
  } else if (e.type === 'INSERT' && blocks?.[e.name]) {
    const block = blocks[e.name]
    const childTf = localInsertTransform(e, block, tf)
    for (const child of block.entities || []) out.push(...lineSegmentsFromEntity(child, childTf, blocks, depth + 1))
  }
  return out
}

function walkOpeningEntities(entities, blocks, tf, depth, sink) {
  if (!entities || depth > 8) return
  for (const e of entities) {
    const layer = e.layer || ''
    if (e.type === 'INSERT' && blocks[e.name]) {
      const block = blocks[e.name]
      const childTf = localInsertTransform(e, block, tf)
      if (isDoorCandidateLayer(layer) && !/^doorlab/i.test(String(e.name || ''))) {
        const pts = entityPoints(e, tf, blocks)
        const bb = bboxFromPoints(pts)
        if (bb) {
          const widthModel = Math.max(bb.width, bb.height)
          sink.doors.push({
            x: (bb.minX + bb.maxX) / 2,
            y: (bb.minY + bb.maxY) / 2,
            widthCm: Math.max(60, Math.min(180, widthModel / 10)),
            layer,
            block: e.name,
            rotation: e.rotation || 0,
          })
        }
      }
      walkOpeningEntities(block.entities, blocks, childTf, depth + 1, sink)
    } else if (isWindowCandidateLayer(layer)) {
      for (const seg of lineSegmentsFromEntity(e, tf, blocks)) {
        const lenModel = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)
        if (lenModel < 400 || lenModel > 4000) continue
        sink.windows.push({
          x: (seg.a.x + seg.b.x) / 2,
          y: (seg.a.y + seg.b.y) / 2,
          widthCm: Math.max(40, Math.min(400, lenModel / 10)),
          layer,
        })
      }
    }
  }
}

export function extractOpeningObjects(dxf) {
  const sink = { doors: [], windows: [] }
  walkOpeningEntities(dxf?.entities || [], dxf?.blocks || {}, (x, y) => ({ x, y }), 0, sink)
  return {
    doors: sink.doors,
    windows: sink.windows,
    meta: {
      doorCandidates: sink.doors.length,
      windowCandidates: sink.windows.length,
    }
  }
}

function modelToSvgPoint(p, baseLayer) {
  const bbox = baseLayer?.bbox
  const placement = baseLayer?.placement
  if (!bbox || !placement) return null
  return {
    x: placement.offsetX + ((p.x - bbox.minX) / bbox.width) * placement.drawW,
    y: placement.offsetY + ((bbox.maxY - p.y) / bbox.height) * placement.drawH,
  }
}

function localSpaceEdges(spaces) {
  const out = []
  for (const space of spaces || []) {
    const vs = space.vertices || []
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i]
      const b = vs[(i + 1) % vs.length]
      out.push({
        id: `edge-${space.id}-${i}`,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        spaceId: space.id,
        edgeIndex: i,
      })
    }
  }
  return out
}

function projectPointToEdge(p, edge) {
  const dx = edge.x2 - edge.x1
  const dy = edge.y2 - edge.y1
  const len2 = dx * dx + dy * dy
  if (!len2) return null
  const t = Math.max(0, Math.min(1, ((p.x - edge.x1) * dx + (p.y - edge.y1) * dy) / len2))
  const x = edge.x1 + dx * t
  const y = edge.y1 + dy * t
  return { edge, t, dist: Math.hypot(p.x - x, p.y - y) }
}

function attachCandidates(candidates, spaces, baseLayer, kind, opts = {}) {
  const edges = localSpaceEdges(spaces)
  const maxDistance = opts.maxDistance ?? (kind === 'door' ? 70 : 50)
  const used = []
  const out = []
  for (const candidate of candidates) {
    const p = modelToSvgPoint(candidate, baseLayer)
    if (!p) continue
    let best = null
    for (const edge of edges) {
      const hit = projectPointToEdge(p, edge)
      if (!hit || hit.t < 0.03 || hit.t > 0.97) continue
      if (!best || hit.dist < best.dist) best = hit
    }
    if (!best || best.dist > maxDistance) continue
    if (used.some(u => u.wallId === best.edge.id && Math.abs(u.t - best.t) < 0.04)) continue
    used.push({ wallId: best.edge.id, t: best.t })
    out.push({
      wallId: best.edge.id,
      t: +best.t.toFixed(3),
      width: Math.round(candidate.widthCm),
      source: 'dxf',
      sourceLayer: candidate.layer,
      ...(kind === 'door' ? { swing: 'in-right', type: 'single' } : { sillHeight: 90 }),
    })
  }
  return out
}

export function openingsToPlanOpenings(openings, spaces, baseLayer, opts = {}) {
  return {
    doors: attachCandidates(openings?.doors || [], spaces, baseLayer, 'door', opts),
    windows: attachCandidates(openings?.windows || [], spaces, baseLayer, 'window', opts),
  }
}
