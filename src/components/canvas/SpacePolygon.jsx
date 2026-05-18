import { spaceVertices, polygonCenter, polygonArea } from '../../lib/constraints.js'
import { usePlanStore } from '../../store/planStore.js'

/**
 * 空間多邊形 — 渲染填色 + 名稱 + 面積。
 * 牆已經由 WallsLayer 從 spaceEdges() 自動畫出來,所以這裡不畫邊。
 * 選取時:每個頂點冒可拖拉手柄;每個邊中點冒「+」加新頂點。
 */
export default function SpacePolygon({ space, selected, onSelect }) {
  const vertices = spaceVertices(space)
  if (vertices.length < 3) return null
  const updateSpace = usePlanStore(s => s.updateSpace)
  const removeSpace = usePlanStore(s => s.removeSpace)

  const center = polygonCenter(vertices)
  const areaCm2 = polygonArea(vertices)
  const areaM2 = (areaCm2 / 10000).toFixed(2)
  const ping = (areaCm2 / 33057.85).toFixed(2)
  const pointsStr = vertices.map(v => `${v.x},${v.y}`).join(' ')

  // 拖拉整個空間 (點空間內部任何位置)
  function dragWhole(e) {
    e.stopPropagation()
    onSelect?.(space.id)
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    function getPos(ev) {
      const pt = svg.createSVGPoint()
      pt.x = ev.clientX; pt.y = ev.clientY
      const ctm = svg.getScreenCTM()
      return ctm ? pt.matrixTransform(ctm.inverse()) : null
    }
    const start = getPos(e); if (!start) return
    const startVs = vertices.map(v => ({ ...v }))
    let moved = false
    function move(ev) {
      const p = getPos(ev); if (!p) return
      const dx = Math.round(p.x - start.x)
      const dy = Math.round(p.y - start.y)
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true
      const newVs = startVs.map(v => ({ x: v.x + dx, y: v.y + dy }))
      updateSpace(space.id, { vertices: newVs, x: undefined, y: undefined, w: undefined, h: undefined })
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // 拖拉單一頂點
  function dragVertex(e, idx) {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    function getPos(ev) {
      const pt = svg.createSVGPoint()
      pt.x = ev.clientX; pt.y = ev.clientY
      const ctm = svg.getScreenCTM()
      return ctm ? pt.matrixTransform(ctm.inverse()) : null
    }
    function move(ev) {
      const p = getPos(ev); if (!p) return
      let nx = Math.round(p.x), ny = Math.round(p.y)
      if (ev.shiftKey) {
        // 鎖正交:跟相鄰頂點對齊
        const prev = vertices[(idx + vertices.length - 1) % vertices.length]
        const next = vertices[(idx + 1) % vertices.length]
        // 看哪個鄰點較近,優先對齊
        const dxPrev = Math.abs(nx - prev.x), dyPrev = Math.abs(ny - prev.y)
        const dxNext = Math.abs(nx - next.x), dyNext = Math.abs(ny - next.y)
        if (Math.min(dxPrev, dxNext) < Math.min(dyPrev, dyNext)) {
          nx = dxPrev < dxNext ? prev.x : next.x
        } else {
          ny = dyPrev < dyNext ? prev.y : next.y
        }
      }
      const newVs = vertices.map((v, i) => i === idx ? { x: nx, y: ny } : v)
      updateSpace(space.id, { vertices: newVs, x: undefined, y: undefined, w: undefined, h: undefined })
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // 在邊中間加新頂點 (雙擊)
  function addVertexAtEdge(e, edgeIdx) {
    e.stopPropagation()
    const a = vertices[edgeIdx]
    const b = vertices[(edgeIdx + 1) % vertices.length]
    const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }
    const newVs = [...vertices.slice(0, edgeIdx + 1), mid, ...vertices.slice(edgeIdx + 1)]
    updateSpace(space.id, { vertices: newVs, x: undefined, y: undefined, w: undefined, h: undefined })
  }

  // 刪除頂點 (右鍵) — 至少要保留 3 點
  function removeVertex(e, idx) {
    e.preventDefault()
    e.stopPropagation()
    if (vertices.length <= 3) return
    const newVs = vertices.filter((_, i) => i !== idx)
    updateSpace(space.id, { vertices: newVs })
  }

  return (
    <g>
      {/* 填色 + 點擊區 */}
      <polygon points={pointsStr}
               fill={space.color ?? '#e2e8f0'} fillOpacity={selected ? 0.35 : 0.22}
               stroke={selected ? '#3b82f6' : 'none'}
               strokeWidth={selected ? 4 : 0} strokeDasharray="8 6"
               onMouseDown={dragWhole}
               style={{ cursor: 'move' }} />

      {/* 名稱與面積 — 對齊酷家樂格式: 大字名稱、下面藍紫色面積 */}
      <text x={center.x} y={center.y - 14} fontSize={42} fontWeight="700"
            fill="#1e293b" textAnchor="middle" dominantBaseline="middle"
            pointerEvents="none" fontFamily="system-ui">
        {space.name}
      </text>
      <text x={center.x} y={center.y + 30} fontSize={28} fontWeight="500"
            fill="#7c3aed" textAnchor="middle" dominantBaseline="middle"
            pointerEvents="none">
        {areaM2} m²
      </text>
      <text x={center.x} y={center.y + 60} fontSize={20}
            fill="#64748b" textAnchor="middle" dominantBaseline="middle"
            pointerEvents="none">
        {ping} 坪
      </text>

      {/* 選取時:頂點手柄 + 邊中點加號 */}
      {selected && (
        <g>
          {vertices.map((v, i) => (
            <circle key={`vh-${i}`}
                    cx={v.x} cy={v.y} r={14}
                    fill="#3b82f6" stroke="white" strokeWidth={3}
                    onMouseDown={(e) => dragVertex(e, i)}
                    onContextMenu={(e) => removeVertex(e, i)}
                    style={{ cursor: 'grab' }} />
          ))}
          {vertices.map((v, i) => {
            const b = vertices[(i + 1) % vertices.length]
            const mx = (v.x + b.x) / 2, my = (v.y + b.y) / 2
            return (
              <g key={`eh-${i}`}>
                <circle cx={mx} cy={my} r={11} fill="white" stroke="#3b82f6" strokeWidth={2}
                        onDoubleClick={(e) => addVertexAtEdge(e, i)}
                        style={{ cursor: 'cell' }}>
                  <title>雙擊在這條邊加頂點</title>
                </circle>
                <text x={mx} y={my + 4} fontSize={16} fill="#3b82f6"
                      textAnchor="middle" pointerEvents="none">+</text>
              </g>
            )
          })}
        </g>
      )}
    </g>
  )
}
