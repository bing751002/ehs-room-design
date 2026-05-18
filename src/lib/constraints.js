/**
 * 從 v3_8 移植的核心邏輯(精簡版)
 *  - emptyPlan:空白方案的資料結構
 *  - roomTemplates:房間庫(矩形 / L 形)
 *  - furnitureCatalog:家具庫種子資料
 *  - scorePlan:5 維度評分(動線、密度、衝突、業態合規、結構)
 *  - checkConstraints:硬約束檢查(走道吃掉沒、外牆有沒有放主入口、業態衝突)
 *
 * 單位:公分(cm)。畫布 1px = 1cm。
 */

export function emptyPlan() {
  return {
    // 樓層底稿
    bounds: { w: 4000, h: 3000 },                // 4000 × 3000 cm = 40m × 30m
    keepOutCorridors: [],                        // 區外不可動走道 [{x,y,w,h,note}]
    structuralColumns: [],                       // 結構柱 [{x,y,w,h}]
    availableZone: { x: 200, y: 200, w: 3600, h: 2600 },
    facadeSides: ['N','E','S','W'],              // 哪幾邊是帷幕(不可開門)

    // 上傳的底圖 (DXF/PDF/圖片)
    baseLayer: null,

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CAD 級一級物件 (Sprint 1 新增,取代純色塊)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 牆:用線段表示,有厚度。兩牆共用端點代表牆角。
    walls: [],          // [{id, x1, y1, x2, y2, thickness, kind: 'exterior'|'interior'|'partition'}]
    // 門:依附在某條牆上,用「沿牆 0-1 的位置 t」定位,有開門方向
    doors: [],          // [{id, wallId, t, width, swing: 'in-left'|'in-right'|'out-left'|'out-right', isExit, isEntry}]
    // 窗:依附在某條牆上
    windows: [],        // [{id, wallId, t, width, sillHeight}]
    // 空間/分區:有名字、用途、可選的多邊形範圍。沒有 polygon 時用 bounding box (x,y,w,h)
    spaces: [],         // [{id, name, type, color, x?, y?, w?, h?, polygon?, height}]

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 舊版相容 (漸進淘汰)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    rooms: [],                                    // legacy:會被 spaces 取代,但 AI 暫時還會輸出這個
    furniture: [],                                // [{id, modelKey, x, y, rot, roomId/spaceId}]

    // 規劃元資料
    forbidUsages: [],
    notes: '',

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 多樓層 (Sprint 1.8)
    // 設計:目前編輯的樓層資料在 plan 頂層 (上面那些),
    // 其他樓層的快照存在 floorSnapshots,切樓層時做交換。
    // 第一次升級時,把現有資料當 floor[0],並建立 'f1' 預設樓層。
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    floors: [],                 // [{id, name}]  樓層清單;空陣列代表單樓層模式
    currentFloorId: null,       // 目前編輯哪個樓層 id;null = 單樓層模式
    floorSnapshots: {}          // {floorId: {bounds, baseLayer, walls, doors, windows, spaces, furniture, rooms, availableZone, keepOutCorridors, structuralColumns}}
  }
}

// 哪些欄位算「樓層獨有」(切樓層時要存/讀)
export const FLOOR_FIELDS = [
  'bounds', 'baseLayer', 'walls', 'doors', 'windows', 'spaces',
  'furniture', 'rooms', 'availableZone', 'keepOutCorridors',
  'structuralColumns', 'facadeSides'
]

export function extractFloorSnapshot(plan) {
  const snap = {}
  for (const k of FLOOR_FIELDS) snap[k] = plan[k]
  return snap
}
export function mergeFloorSnapshot(plan, snapshot) {
  return { ...plan, ...snapshot }
}

// ---- ID generators ----
export function newWallId()   { return newId('wall') }
export function newDoorId()   { return newId('door') }
export function newWindowId() { return newId('win') }
export function newSpaceId()  { return newId('space') }

// ---- 牆相關工具 ----
export function wallLength(w) {
  return Math.sqrt((w.x2 - w.x1) ** 2 + (w.y2 - w.y1) ** 2)
}
export function wallAngle(w) {
  return Math.atan2(w.y2 - w.y1, w.x2 - w.x1)
}
// 沿牆 t (0-1) 取得 (x,y) 座標
export function pointOnWall(w, t) {
  return { x: w.x1 + (w.x2 - w.x1) * t, y: w.y1 + (w.y2 - w.y1) * t }
}
// 計算門/窗在牆上的兩端 (用 width)
export function openingEnds(wall, opening) {
  const len = wallLength(wall)
  if (len === 0) return null
  const halfW = opening.width / 2
  const t1 = Math.max(0, opening.t - halfW / len)
  const t2 = Math.min(1, opening.t + halfW / len)
  return { p1: pointOnWall(wall, t1), p2: pointOnWall(wall, t2) }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 空間 (Space) = 多邊形;牆是它的邊
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * 取得空間的頂點陣列。
 * 支援兩種格式:
 *  1) space.vertices = [{x,y},...]  ← 新格式 (任意多邊形)
 *  2) space.x, y, w, h               ← 舊格式 (矩形) → 自動轉成 4 頂點
 */
export function spaceVertices(space) {
  if (space.vertices?.length >= 3) return space.vertices
  if (space.x != null && space.w != null) {
    return [
      { x: space.x,           y: space.y },
      { x: space.x + space.w, y: space.y },
      { x: space.x + space.w, y: space.y + space.h },
      { x: space.x,           y: space.y + space.h }
    ]
  }
  return []
}

/**
 * 取得空間的「邊」陣列 (每個邊是一面牆,用 wall 同樣的 schema)。
 * id 規則:`edge-{spaceId}-{i}` 讓門/窗可以 attach。
 */
export function spaceEdges(space) {
  const vs = spaceVertices(space)
  const out = []
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    out.push({
      id: `edge-${space.id}-${i}`,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      thickness: space.wallThickness ?? 12,
      kind: space.wallKind ?? 'interior',
      spaceId: space.id,
      edgeIndex: i
    })
  }
  return out
}

/**
 * 取得所有渲染用的牆 = 所有 spaces 的邊 + legacy 獨立 walls。
 * 如果兩個 space 共用一條邊 (座標重合),自動合併 — 標記為 'shared'。
 */
export function allRenderableWalls(plan) {
  const out = []
  for (const sp of (plan.spaces || [])) {
    for (const e of spaceEdges(sp)) out.push(e)
  }
  // 加上 legacy 獨立 walls (使用者自己拉的、還沒成為空間的)
  for (const w of (plan.walls || [])) {
    out.push({ ...w, isLegacy: true })
  }
  return out
}

/**
 * 多邊形面積 (Shoelace 公式),回傳 cm²。
 */
export function polygonArea(vs) {
  if (!vs || vs.length < 3) return 0
  let sum = 0
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum / 2)
}

/**
 * 多邊形中心點 (簡單版:頂點平均);夠用於放標籤。
 */
export function polygonCenter(vs) {
  if (!vs || !vs.length) return { x: 0, y: 0 }
  let sx = 0, sy = 0
  for (const v of vs) { sx += v.x; sy += v.y }
  return { x: sx / vs.length, y: sy / vs.length }
}

/** 點是否在多邊形內 (ray-casting) */
export function pointInPolygon(p, vs) {
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y
    const xj = vs[j].x, yj = vs[j].y
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-9) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** 把空間的舊格式 (x,y,w,h) 升級成 vertices 格式 (返回新 space) */
export function upgradeSpace(space) {
  if (space.vertices?.length >= 3) return space
  return { ...space, vertices: spaceVertices(space) }
}

export const roomTemplates = [
  // 辦公空間
  { key: 'office',     name: '辦公室',       w: 400, h: 300, type: 'office',   color: '#bfdbfe', category: '辦公' },
  { key: 'office_open',name: '開放辦公區',   w: 800, h: 600, type: 'office',   color: '#dbeafe', category: '辦公' },
  { key: 'meeting',    name: '中型會議室',   w: 500, h: 350, type: 'meeting',  color: '#a7f3d0', category: '辦公' },
  { key: 'meeting_lg', name: '大型會議室',   w: 800, h: 500, type: 'meeting',  color: '#86efac', category: '辦公' },
  { key: 'reception',  name: '接待大廳',     w: 600, h: 400, type: 'lounge',   color: '#fde2e7', category: '辦公' },
  // 休憩
  { key: 'pantry',     name: '茶水間',       w: 300, h: 250, type: 'pantry',   color: '#fde68a', category: '休憩' },
  { key: 'lounge',     name: '休息區',       w: 600, h: 400, type: 'lounge',   color: '#fbcfe8', category: '休憩' },
  { key: 'cafeteria',  name: '員工餐廳',     w: 800, h: 600, type: 'pantry',   color: '#fef3c7', category: '休憩' },
  // 健身/SPA
  { key: 'gym',        name: '健身區',       w: 800, h: 500, type: 'gym',      color: '#fca5a5', category: '健身/SPA' },
  { key: 'yoga',       name: '瑜珈/有氧教室',w: 600, h: 500, type: 'gym',      color: '#fecaca', category: '健身/SPA' },
  { key: 'sauna',      name: '三溫暖室',     w: 400, h: 300, type: 'sauna',    color: '#fdba74', category: '健身/SPA' },
  { key: 'shower',     name: '淋浴間',       w: 200, h: 150, type: 'shower',   color: '#93c5fd', category: '健身/SPA' },
  { key: 'locker',     name: '更衣室',       w: 500, h: 300, type: 'locker',   color: '#c4b5fd', category: '健身/SPA' },
  { key: 'spa_room',   name: 'SPA 包廂',     w: 400, h: 300, type: 'sauna',    color: '#fed7aa', category: '健身/SPA' },
  // 衛生 / 動線
  { key: 'restroom',   name: '洗手間',       w: 400, h: 300, type: 'restroom', color: '#cbd5e1', category: '衛生/動線' },
  { key: 'corridor',   name: '內部走道',     w: 500, h: 150, type: 'corridor', color: '#e5e7eb', category: '衛生/動線' },
  { key: 'lobby',      name: '電梯廳',       w: 400, h: 400, type: 'corridor', color: '#f1f5f9', category: '衛生/動線' },
  { key: 'stairs',     name: '樓梯間',       w: 300, h: 500, type: 'corridor', color: '#e2e8f0', category: '衛生/動線' },
  // 住宅
  { key: 'bedroom',    name: '臥室',         w: 400, h: 300, type: 'lounge',   color: '#fef3c7', category: '住宅' },
  { key: 'master',     name: '主臥',         w: 500, h: 400, type: 'lounge',   color: '#fbbf24', category: '住宅' },
  { key: 'living',     name: '客廳',         w: 600, h: 450, type: 'lounge',   color: '#fde68a', category: '住宅' },
  { key: 'kitchen',    name: '廚房',         w: 400, h: 250, type: 'pantry',   color: '#fed7aa', category: '住宅' },
  // 商業
  { key: 'shop',       name: '店面/門市',    w: 600, h: 500, type: 'office',   color: '#bfdbfe', category: '商業' },
  { key: 'restaurant', name: '餐廳用餐區',   w: 800, h: 600, type: 'pantry',   color: '#fde68a', category: '商業' },
  { key: 'kitchen_cm', name: '商業廚房',     w: 500, h: 400, type: 'pantry',   color: '#fed7aa', category: '商業' },
  // 特殊空間
  { key: 'clinic',     name: '診間',         w: 350, h: 300, type: 'office',   color: '#d1fae5', category: '特殊' },
  { key: 'waiting',    name: '候診/等候區',  w: 500, h: 400, type: 'lounge',   color: '#a7f3d0', category: '特殊' },
  { key: 'esports',    name: '電競包廂',     w: 400, h: 300, type: 'lounge',   color: '#c084fc', category: '特殊' },
  { key: 'studio',     name: '攝影棚',       w: 800, h: 700, type: 'office',   color: '#cbd5e1', category: '特殊' }
]

/**
 * 家具庫(MVP 種子):
 * - 每筆 modelKey 對應到 public/models/{key}.glb 或 primitive 內建幾何
 * - 為了 MVP 不依賴外部 GLB,先全部用 primitive 內建幾何(在 Canvas3D 處理)
 */
export const furnitureCatalog = [
  // key, name, 尺寸(cm), 顏色, 預估單價(NTD), 建議品牌/型號
  { key: 'desk',         name: '辦公桌',     w: 140, h: 70,  height: 75,  color: '#a8a29e', price: 6800,  brand: 'IKEA BEKANT', category: '辦公' },
  { key: 'chair',        name: '辦公椅',     w: 50,  h: 50,  height: 90,  color: '#52525b', price: 8900,  brand: 'IKEA MARKUS', category: '辦公' },
  { key: 'sofa',         name: '沙發',       w: 200, h: 90,  height: 80,  color: '#7c3aed', price: 28000, brand: 'IKEA KIVIK',  category: '休憩' },
  { key: 'table_meeting',name: '會議桌',     w: 240, h: 120, height: 75,  color: '#92400e', price: 15800, brand: '崑隆 OFY-2412',category: '會議' },
  { key: 'treadmill',    name: '跑步機',     w: 200, h: 90,  height: 130, color: '#1f2937', price: 65000, brand: 'Johnson T7000', category: '健身' },
  { key: 'dumbbell_rack',name: '啞鈴架',     w: 200, h: 50,  height: 110, color: '#374151', price: 18000, brand: 'BodyMax DR-200', category: '健身' },
  { key: 'sauna_bench',  name: '三溫暖長椅', w: 180, h: 50,  height: 45,  color: '#a16207', price: 12000, brand: 'TYLO 訂製',     category: 'SPA' },
  { key: 'shower_unit',  name: '淋浴柱',     w: 100, h: 100, height: 210, color: '#0ea5e9', price: 22000, brand: 'GROHE Euphoria',category: '衛浴' },
  { key: 'locker',       name: '置物櫃',     w: 60,  h: 50,  height: 180, color: '#475569', price: 4800,  brand: '崑隆 K12-Locker',category: '置物' },
  { key: 'plant',        name: '盆栽',       w: 60,  h: 60,  height: 150, color: '#16a34a', price: 1500,  brand: '通用',          category: '裝飾' }
]

// 建材預估 (按空間類型 × 坪數估算)
export const materialEstimates = {
  // type → 每坪材料預估 (NTD/坪)
  office:   { floor: 4500, ceiling: 3500, partition: 2800, label: '辦公室' },
  meeting:  { floor: 5500, ceiling: 4500, partition: 3500, label: '會議室' },
  pantry:   { floor: 5000, ceiling: 4000, partition: 3500, label: '茶水間' },
  gym:      { floor: 7500, ceiling: 3000, partition: 3000, label: '健身區' },
  sauna:    { floor: 12000, ceiling: 8000, partition: 6500, label: '三溫暖室' },
  shower:   { floor: 8500, ceiling: 4500, partition: 5500, label: '淋浴間' },
  locker:   { floor: 4500, ceiling: 3500, partition: 3500, label: '更衣室' },
  lounge:   { floor: 6500, ceiling: 5500, partition: 4500, label: '休息區' },
  restroom: { floor: 6500, ceiling: 4500, partition: 5500, label: '洗手間' },
  corridor: { floor: 3500, ceiling: 2500, partition: 2000, label: '走道' },
  custom:   { floor: 5000, ceiling: 4000, partition: 3500, label: '其他' }
}

// ---- 評分(從 v3_8 5 維度精簡) ----
export function scorePlan(plan) {
  const r = {
    movement:   scoreMovement(plan),       // 動線:房間到主入口有沒有路徑
    density:    scoreDensity(plan),        // 密度:可用區使用率 30-75% 最佳
    conflict:   scoreConflict(plan),       // 衝突:房間互相重疊扣分
    compliance: scoreCompliance(plan),     // 業態:有沒有踩到 forbidUsages
    structure:  scoreStructure(plan)       // 結構:房間有沒有壓到柱子
  }
  r.total = Math.round((r.movement + r.density + r.conflict + r.compliance + r.structure) / 5)
  return r
}

function scoreDensity(plan) {
  const az = plan.availableZone
  const total = az.w * az.h
  const used  = plan.rooms.reduce((s, r) => s + r.w * r.h, 0)
  const ratio = used / total
  if (ratio < 0.15) return 30
  if (ratio < 0.30) return 70
  if (ratio < 0.75) return 100
  if (ratio < 0.90) return 60
  return 20
}

function scoreConflict(plan) {
  let overlaps = 0
  const rs = plan.rooms
  for (let i = 0; i < rs.length; i++)
    for (let j = i+1; j < rs.length; j++)
      if (rectOverlap(rs[i], rs[j])) overlaps++
  return Math.max(0, 100 - overlaps * 20)
}

function scoreCompliance(plan) {
  if (!plan.forbidUsages?.length) return 100
  const bad = plan.rooms.filter(r => plan.forbidUsages.includes(r.type)).length
  return Math.max(0, 100 - bad * 50)
}

function scoreStructure(plan) {
  let hit = 0
  for (const r of plan.rooms)
    for (const c of plan.structuralColumns)
      if (rectOverlap(r, c)) hit++
  return Math.max(0, 100 - hit * 15)
}

function scoreMovement(plan) {
  // MVP: 簡化版 — 每個房間至少要有一面靠到內部走道或主入口,否則扣分
  // 真實的 A* 動線檢查可以之後加
  const corridors = plan.rooms.filter(r => r.type === 'corridor')
  if (plan.rooms.length === 0) return 100
  if (corridors.length === 0) return 50  // 沒走道,警告
  let attached = 0
  for (const r of plan.rooms.filter(r => r.type !== 'corridor')) {
    if (corridors.some(c => rectAdjacent(r, c))) attached++
  }
  return Math.round(attached / Math.max(1, plan.rooms.length - corridors.length) * 100)
}

// ---- 幾何工具 ----
export function rectOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x ||
           a.y + a.h <= b.y || b.y + b.h <= a.y)
}

export function rectAdjacent(a, b, tol = 5) {
  // 兩矩形「邊靠邊」(共用一段邊),非完全重疊
  const xOverlap = !(a.x + a.w < b.x - tol || b.x + b.w < a.x - tol)
  const yOverlap = !(a.y + a.h < b.y - tol || b.y + b.h < a.y - tol)
  const xTouching = Math.abs(a.x + a.w - b.x) <= tol || Math.abs(b.x + b.w - a.x) <= tol
  const yTouching = Math.abs(a.y + a.h - b.y) <= tol || Math.abs(b.y + b.h - a.y) <= tol
  return (xTouching && yOverlap) || (yTouching && xOverlap)
}

export function newId(prefix='id') {
  return `${prefix}_${Math.random().toString(36).slice(2,9)}`
}

// 1 坪 ≈ 3.305785 m² = 33057.85 cm²。回傳兩位小數。
export function toPing(wCm, hCm) {
  return Math.round((wCm * hCm) / 33057.85 * 100) / 100
}
