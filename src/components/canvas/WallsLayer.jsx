import { wallLength, pointOnWall, openingEnds } from '../../lib/constraints.js'
import { usePlanStore } from '../../store/planStore.js'

/**
 * 牆/門/窗渲染層 — CAD 級平面圖核心
 *
 * 視覺策略:
 *  - 牆:用粗線(厚度 = thickness),外牆比內牆粗。線端方型 (butt) 才能跟相鄰牆精準對齊
 *  - 門:在牆上「挖洞」(用白色覆蓋一段),再畫開門弧線
 *  - 窗:在牆上「挖洞」並畫兩條平行細線
 *  - 牆顏色:外牆 #1f2937,內牆 #475569,輕隔間 #94a3b8
 */
export default function WallsLayer({ walls, doors, windows, selectedId, onSelect }) {
  const wallById = Object.fromEntries(walls.map(w => [w.id, w]))

  // 把門/窗依附的牆「打洞」位置記下,渲染牆時要分段避開
  const openingsByWall = {}
  for (const d of doors) {
    if (!openingsByWall[d.wallId]) openingsByWall[d.wallId] = []
    openingsByWall[d.wallId].push({ ...d, _kind: 'door' })
  }
  for (const w of windows) {
    if (!openingsByWall[w.wallId]) openingsByWall[w.wallId] = []
    openingsByWall[w.wallId].push({ ...w, _kind: 'window' })
  }

  return (
    <g>
      {/* 第一層:牆 (含被門窗打洞) */}
      {walls.map(w => (
        <WallSegments key={w.id} wall={w}
                      openings={openingsByWall[w.id] || []}
                      selected={selectedId === w.id}
                      onSelect={onSelect} />
      ))}

      {/* 第二層:門弧線 */}
      {doors.map(d => {
        const w = wallById[d.wallId]; if (!w) return null
        return <DoorGlyph key={d.id} wall={w} door={d}
                          selected={selectedId === d.id}
                          onSelect={onSelect} />
      })}

      {/* 第三層:窗線 */}
      {windows.map(win => {
        const w = wallById[win.wallId]; if (!w) return null
        return <WindowGlyph key={win.id} wall={w} window={win}
                            selected={selectedId === win.id}
                            onSelect={onSelect} />
      })}
    </g>
  )
}

function wallColor(w) {
  if (w.kind === 'exterior') return '#1f2937'
  if (w.kind === 'partition') return '#94a3b8'
  return '#475569'
}
function wallThickness(w) {
  return w.thickness ?? (w.kind === 'exterior' ? 24 : w.kind === 'partition' ? 8 : 12)
}

/**
 * 一段牆 = 把整條牆 (x1,y1)→(x2,y2) 沿 t 排序門窗洞,
 * 切成多段 segments,每段獨立畫,洞處不畫。
 */
function WallSegments({ wall, openings, selected, onSelect }) {
  const len = wallLength(wall)
  if (len === 0) return null
  const th = wallThickness(wall)
  const color = selected ? '#3b82f6' : wallColor(wall)

  // 計算每個 opening 的 t 範圍 [tStart, tEnd]
  const holes = []
  for (const op of openings) {
    const halfW = op.width / 2
    const tS = Math.max(0, op.t - halfW / len)
    const tE = Math.min(1, op.t + halfW / len)
    holes.push([tS, tE])
  }
  holes.sort((a, b) => a[0] - b[0])

  // 把整條牆切成牆段 [0..1] 扣掉 holes
  const segments = []
  let cursor = 0
  for (const [s, e] of holes) {
    if (s > cursor) segments.push([cursor, s])
    cursor = Math.max(cursor, e)
  }
  if (cursor < 1) segments.push([cursor, 1])

  // 點空間邊 = 選該空間;點 legacy 獨立牆 = 選該牆
  function handleSelect(e) {
    e.stopPropagation()
    if (wall.spaceId) onSelect?.(wall.spaceId)
    else onSelect?.(wall.id, 'wall')
  }
  return (
    <g onMouseDown={handleSelect} style={{ cursor: 'pointer' }}>
      {segments.map(([s, e], i) => {
        const p1 = pointOnWall(wall, s)
        const p2 = pointOnWall(wall, e)
        return (
          <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={color} strokeWidth={th} strokeLinecap="butt" />
        )
      })}
      {/* 選取時顯示端點手柄 — 只有 legacy 獨立牆;空間邊的調整透過 SpacePolygon 頂點手柄 */}
      {selected && !wall.spaceId && (
        <>
          <WallEndpointHandle wall={wall} which="start" />
          <WallEndpointHandle wall={wall} which="end" />
        </>
      )}
    </g>
  )
}

function WallEndpointHandle({ wall, which }) {
  const updateWall = usePlanStore(s => s.updateWall)
  const cx = which === 'start' ? wall.x1 : wall.x2
  const cy = which === 'start' ? wall.y1 : wall.y2

  function onDown(e) {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    function getPos(ev) {
      const pt = svg.createSVGPoint()
      pt.x = ev.clientX; pt.y = ev.clientY
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      return pt.matrixTransform(ctm.inverse())
    }
    function move(ev) {
      const p = getPos(ev); if (!p) return
      // shift = 鎖正交
      let nx = Math.round(p.x), ny = Math.round(p.y)
      if (ev.shiftKey) {
        const other = which === 'start' ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 }
        if (Math.abs(nx - other.x) > Math.abs(ny - other.y)) ny = other.y
        else nx = other.x
      }
      updateWall(wall.id, which === 'start' ? { x1: nx, y1: ny } : { x2: nx, y2: ny })
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <circle cx={cx} cy={cy} r={14} fill="#3b82f6" stroke="white" strokeWidth={3}
            onMouseDown={onDown} style={{ cursor: 'grab' }} />
  )
}

/**
 * 門:在牆洞處畫弧線表達開門範圍,並用線段表達門板
 *  swing: in-left / in-right / out-left / out-right
 *  in=向內(房間裡),out=向外;left/right 代表合葉在牆段的左端或右端
 */
function DoorGlyph({ wall, door, selected, onSelect }) {
  const ends = openingEnds(wall, door)
  if (!ends) return null
  const { p1, p2 } = ends
  const len = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
  if (len === 0) return null
  // 牆方向單位向量
  const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len
  // 法向量 (向左90°)
  const nx = -uy, ny = ux

  const swing = door.swing || 'in-right'
  const hinge = swing.endsWith('right') ? p2 : p1
  const tip   = swing.endsWith('right') ? p1 : p2
  const inward = swing.startsWith('in') ? 1 : -1

  // 門板末端: 從 hinge 沿法向量移動 len
  const doorEnd = {
    x: hinge.x + nx * inward * len,
    y: hinge.y + ny * inward * len
  }
  // 弧的方向:從 tip 到 doorEnd
  const sweep = swing.endsWith('right') ? (inward > 0 ? 0 : 1) : (inward > 0 ? 1 : 0)

  const color = selected ? '#3b82f6' : (door.isExit ? '#dc2626' : door.isEntry ? '#16a34a' : '#475569')

  return (
    <g onMouseDown={(e) => { e.stopPropagation(); onSelect?.(door.id, 'door') }}
       style={{ cursor: 'pointer' }}>
      {/* 門板 */}
      <line x1={hinge.x} y1={hinge.y} x2={doorEnd.x} y2={doorEnd.y}
            stroke={color} strokeWidth={6} strokeLinecap="round" />
      {/* 開門弧 */}
      <path d={`M ${tip.x} ${tip.y} A ${len} ${len} 0 0 ${sweep} ${doorEnd.x} ${doorEnd.y}`}
            fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 4" opacity={0.6} />
      {/* 主入口/逃生口標籤 */}
      {(door.isEntry || door.isExit) && (
        <text x={(p1.x + p2.x) / 2} y={(p1.y + p2.y) / 2 - 8}
              fontSize={20} fill={color} fontWeight="bold" textAnchor="middle">
          {door.isExit ? 'EXIT' : 'IN'}
        </text>
      )}
    </g>
  )
}

/**
 * 窗:兩條平行線 + 中間細線 (玻璃)
 */
function WindowGlyph({ wall, window, selected, onSelect }) {
  const ends = openingEnds(wall, window)
  if (!ends) return null
  const { p1, p2 } = ends
  const len = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
  if (len === 0) return null
  const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len
  const nx = -uy, ny = ux
  const offset = (window._kind === 'window' ? 6 : 6)
  const color = selected ? '#3b82f6' : '#0284c7'

  return (
    <g onMouseDown={(e) => { e.stopPropagation(); onSelect?.(window.id, 'window') }}
       style={{ cursor: 'pointer' }}>
      <line x1={p1.x + nx * offset} y1={p1.y + ny * offset}
            x2={p2.x + nx * offset} y2={p2.y + ny * offset}
            stroke={color} strokeWidth={3} />
      <line x1={p1.x - nx * offset} y1={p1.y - ny * offset}
            x2={p2.x - nx * offset} y2={p2.y - ny * offset}
            stroke={color} strokeWidth={3} />
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={1} opacity={0.5} />
    </g>
  )
}
