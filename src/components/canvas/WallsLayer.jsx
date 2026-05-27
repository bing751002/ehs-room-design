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
  const plan = usePlanStore(s => s.plan)
  // 共邊去重後的 isShared 標記:跳過不畫
  const renderedWalls = walls.filter(w => !w.isShared)
  // wallById 仍涵蓋全部 (包括 isShared),這樣門/窗依附在被共邊吃掉的 wallId 也能找到
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
      {/* 第一層:牆 (含被門窗打洞);跳過共邊重複 */}
      {renderedWalls.map(w => (
        <WallSegments key={w.id} wall={w} plan={plan}
                      openings={openingsByWall[w.id] || []}
                      selected={selectedId === w.id}
                      onSelect={onSelect} />
      ))}

      {/* 第二層:門弧線 */}
      {doors.map(d => {
        const w = wallById[d.wallId]; if (!w) return null
        return <DoorGlyph key={d.id} wall={w} door={d} plan={plan}
                          selected={selectedId === d.id}
                          onSelect={onSelect} />
      })}

      {/* 第三層:窗線 */}
      {windows.map(win => {
        const w = wallById[win.wallId]; if (!w) return null
        return <WindowGlyph key={win.id} wall={w} window={win} plan={plan}
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
function WallSegments({ wall, openings, selected, onSelect, plan }) {
  const len = wallLength(wall)
  if (len === 0) return null
  const th = wallThickness(wall)
  const color = selected ? '#3b82f6' : wallColor(wall)
  const f = plan?.svgUnitToRealCm || 1

  // 計算每個 opening 的 t 範圍 [tStart, tEnd]
  // op.width 是 cm,len 是 svg unit,要先換算
  const holes = []
  for (const op of openings) {
    const widthSvg = (op.width || 0) / f
    const halfW = widthSvg / 2
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
 * 門:依 door.type 畫成 single (單開) / double (雙開) / slide (推拉) 三種
 *  swing: in-left / in-right / out-left / out-right (single/double 用)
 *  in=向內(房間裡),out=向外;left/right 代表合葉在牆段的左端或右端
 *  推拉門 swing 只用 in-left/in-right 決定門片往哪邊滑入
 */
function DoorGlyph({ wall, door, selected, onSelect, plan }) {
  const ends = openingEnds(wall, door, plan)
  if (!ends) return null
  const { p1, p2 } = ends
  const len = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
  if (len === 0) return null
  const ux = (p2.x - p1.x) / len, uy = (p2.y - p1.y) / len
  const nx = -uy, ny = ux   // 法向量 (向左 90°)

  const type = door.type || 'single'
  const color = selected ? '#3b82f6' : (door.isExit ? '#dc2626' : door.isEntry ? '#16a34a' : '#475569')

  return (
    <g onMouseDown={(e) => { e.stopPropagation(); onSelect?.(door.id, 'door') }}
       style={{ cursor: 'pointer' }}>
      {type === 'single' && <SingleDoor p1={p1} p2={p2} len={len} nx={nx} ny={ny} swing={door.swing} color={color} />}
      {type === 'double' && <DoubleDoor p1={p1} p2={p2} len={len} nx={nx} ny={ny} swing={door.swing} color={color} />}
      {type === 'slide' && <SlideDoor p1={p1} p2={p2} len={len} ux={ux} uy={uy} nx={nx} ny={ny} swing={door.swing} color={color} />}
      {/* 主入口/逃生口標籤 */}
      {(door.isEntry || door.isExit) && (
        <text x={(p1.x + p2.x) / 2 + nx * 25} y={(p1.y + p2.y) / 2 + ny * 25}
              fontSize={20} fill={color} fontWeight="bold" textAnchor="middle">
          {door.isExit ? 'EXIT' : 'IN'}
        </text>
      )}
    </g>
  )
}

// 單開門:一塊門板 + 90° 弧
function SingleDoor({ p1, p2, len, nx, ny, swing, color }) {
  const sw = swing || 'in-right'
  const hinge = sw.endsWith('right') ? p2 : p1
  const tip = sw.endsWith('right') ? p1 : p2
  const inward = sw.startsWith('in') ? 1 : -1
  const doorEnd = { x: hinge.x + nx * inward * len, y: hinge.y + ny * inward * len }
  const sweep = sw.endsWith('right') ? (inward > 0 ? 0 : 1) : (inward > 0 ? 1 : 0)
  return (<>
    <line x1={hinge.x} y1={hinge.y} x2={doorEnd.x} y2={doorEnd.y}
          stroke={color} strokeWidth={6} strokeLinecap="round" />
    <path d={`M ${tip.x} ${tip.y} A ${len} ${len} 0 0 ${sweep} ${doorEnd.x} ${doorEnd.y}`}
          fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 4" opacity={0.6} />
  </>)
}

// 雙開門:兩塊門板從中央往兩側開,各畫一段弧
function DoubleDoor({ p1, p2, len, nx, ny, swing, color }) {
  const sw = swing || 'in-right'
  const inward = sw.startsWith('in') ? 1 : -1
  const halfLen = len / 2
  // 中央點
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  // 左半門:hinge 在 p1,tip 在 mid;右半門:hinge 在 p2,tip 在 mid
  const leftEnd = { x: p1.x + nx * inward * halfLen, y: p1.y + ny * inward * halfLen }
  const rightEnd = { x: p2.x + nx * inward * halfLen, y: p2.y + ny * inward * halfLen }
  // 弧 sweep:in 跟 out 反向
  const leftSweep = inward > 0 ? 1 : 0
  const rightSweep = inward > 0 ? 0 : 1
  return (<>
    {/* 左門板 */}
    <line x1={p1.x} y1={p1.y} x2={leftEnd.x} y2={leftEnd.y}
          stroke={color} strokeWidth={6} strokeLinecap="round" />
    <path d={`M ${mid.x} ${mid.y} A ${halfLen} ${halfLen} 0 0 ${leftSweep} ${leftEnd.x} ${leftEnd.y}`}
          fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 4" opacity={0.6} />
    {/* 右門板 */}
    <line x1={p2.x} y1={p2.y} x2={rightEnd.x} y2={rightEnd.y}
          stroke={color} strokeWidth={6} strokeLinecap="round" />
    <path d={`M ${mid.x} ${mid.y} A ${halfLen} ${halfLen} 0 0 ${rightSweep} ${rightEnd.x} ${rightEnd.y}`}
          fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 4" opacity={0.6} />
  </>)
}

// 推拉門:沿牆方向滑動的門片 (不旋轉,在牆外側畫一段平行線+箭頭)
function SlideDoor({ p1, p2, len, ux, uy, nx, ny, swing, color }) {
  const sw = swing || 'in-right'
  // left = 門往 p1 方向滑,right = 往 p2 滑
  const slideToEnd = sw.endsWith('right')
  // 門片畫在離牆 8 svg unit 的偏移位置 (代表雙軌的另一軌)
  const offset = 10
  const dirX = nx * (sw.startsWith('in') ? 1 : -1) * offset
  const dirY = ny * (sw.startsWith('in') ? 1 : -1) * offset
  // 門板:跟牆平行,離牆 offset 距離,長度 = len
  const a = { x: p1.x + dirX, y: p1.y + dirY }
  const b = { x: p2.x + dirX, y: p2.y + dirY }
  // 滑動箭頭起點:往滑動方向偏 70%
  const arrowStart = slideToEnd
    ? { x: a.x + ux * len * 0.15, y: a.y + uy * len * 0.15 }
    : { x: b.x - ux * len * 0.15, y: b.y - uy * len * 0.15 }
  const arrowEnd = slideToEnd
    ? { x: a.x + ux * len * 0.55, y: a.y + uy * len * 0.55 }
    : { x: b.x - ux * len * 0.55, y: b.y - uy * len * 0.55 }
  return (<>
    {/* 門板 (粗線) */}
    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color} strokeWidth={6} strokeLinecap="round" />
    {/* 中央接縫 */}
    <line x1={(a.x + b.x) / 2} y1={(a.y + b.y) / 2}
          x2={(p1.x + p2.x) / 2} y2={(p1.y + p2.y) / 2}
          stroke={color} strokeWidth={2} strokeDasharray="3 3" opacity={0.5} />
    {/* 滑動方向箭頭 */}
    <line x1={arrowStart.x} y1={arrowStart.y} x2={arrowEnd.x} y2={arrowEnd.y}
          stroke={color} strokeWidth={2} opacity={0.7} markerEnd="url(#slide-arrow)" />
    <defs>
      <marker id="slide-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill={color} />
      </marker>
    </defs>
  </>)
}

/**
 * 窗:兩條平行線 + 中間細線 (玻璃)
 */
function WindowGlyph({ wall, window, selected, onSelect, plan }) {
  const ends = openingEnds(wall, window, plan)
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
