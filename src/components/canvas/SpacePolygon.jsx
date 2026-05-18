import { spaceVertices, polygonCenter, polygonArea, polygonRealArea } from '../../lib/constraints.js'
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
  const selectedIds = usePlanStore(s => s.selectedIds) || []
  const toggleSelectedId = usePlanStore(s => s.toggleSelectedId)
  const setSelectedIds = usePlanStore(s => s.setSelectedIds)
  const isMultiSelected = selectedIds.includes(space.id)

  const plan = usePlanStore.getState().plan
  const zoom = usePlanStore(s => s.canvasZoom) || 0.15
  const center = polygonCenter(vertices)
  const real = polygonRealArea(vertices, plan)
  const areaM2 = real.m2
  const ping = real.ping
  const pointsStr = vertices.map(v => `${v.x},${v.y}`).join(' ')
  // 字體跟著縮放 (svg 縮放越小,字體相對放大),保持螢幕視覺一致
  const fontMain = Math.min(120, Math.max(28, 14 / zoom))
  const fontSub  = Math.min(80,  Math.max(20, 9 / zoom))
  // 手柄大小也跟著縮放 (螢幕上始終 ~12px)
  const handleR = Math.min(28, Math.max(10, 8 / zoom))
  const handleStrokeW = Math.max(2, 2 / zoom)
  // bounding box for resize 手柄
  const xs = vertices.map(v => v.x), ys = vertices.map(v => v.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const bbW = maxX - minX, bbH = maxY - minY

  // 拖拉整個空間 (點空間內部任何位置)
  function dragWhole(e) {
    e.stopPropagation()
    // Shift + 點 = 多選 toggle (不進入拖移)
    if (e.shiftKey) {
      toggleSelectedId(space.id)
      return
    }
    // 一般點擊:如果這個空間在多選中,拖移整組;否則先單選
    const plan = usePlanStore.getState().plan
    const groupIds = isMultiSelected ? selectedIds : []
    if (!isMultiSelected) {
      setSelectedIds([])
      onSelect?.(space.id)
    }
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    function getPos(ev) {
      const pt = svg.createSVGPoint()
      pt.x = ev.clientX; pt.y = ev.clientY
      const ctm = svg.getScreenCTM()
      return ctm ? pt.matrixTransform(ctm.inverse()) : null
    }
    const start = getPos(e); if (!start) return
    // 記錄所有要被拖的空間的起始 vertices
    const groupStart = groupIds.length
      ? plan.spaces.filter(sp => groupIds.includes(sp.id)).map(sp => ({
          id: sp.id, vs: spaceVertices(sp).map(v => ({ ...v }))
        }))
      : [{ id: space.id, vs: vertices.map(v => ({ ...v })) }]
    function move(ev) {
      const p = getPos(ev); if (!p) return
      const dx = Math.round(p.x - start.x)
      const dy = Math.round(p.y - start.y)
      for (const g of groupStart) {
        const newVs = g.vs.map(v => ({ x: v.x + dx, y: v.y + dy }))
        updateSpace(g.id, { vertices: newVs, x: undefined, y: undefined, w: undefined, h: undefined })
      }
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

  /**
   * 8 方向整體縮放 — 拖某個 bbox 上的手柄,等比/單軸縮放整個多邊形。
   * anchor 是「不動的對角點」,handle 是被拖的角。
   */
  function bboxResize(e, anchor, axis) {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    function getPos(ev) {
      const pt = svg.createSVGPoint()
      pt.x = ev.clientX; pt.y = ev.clientY
      const ctm = svg.getScreenCTM()
      return ctm ? pt.matrixTransform(ctm.inverse()) : null
    }
    const startVs = vertices.map(v => ({ ...v }))
    const startBb = { minX, minY, maxX, maxY, w: bbW, h: bbH }
    function move(ev) {
      const p = getPos(ev); if (!p) return
      // 依 axis 決定新尺寸
      let newW = startBb.w, newH = startBb.h
      if (axis === 'xy' || axis === 'x') {
        newW = Math.max(20, Math.abs(p.x - anchor.x))
      }
      if (axis === 'xy' || axis === 'y') {
        newH = Math.max(20, Math.abs(p.y - anchor.y))
      }
      // Shift = 等比縮放
      if (ev.shiftKey && startBb.w > 0 && startBb.h > 0) {
        const ratio = Math.min(newW / startBb.w, newH / startBb.h)
        newW = startBb.w * ratio
        newH = startBb.h * ratio
      }
      const scaleX = startBb.w > 0 ? newW / startBb.w : 1
      const scaleY = startBb.h > 0 ? newH / startBb.h : 1
      // 以 anchor 為定點縮放
      const newVs = startVs.map(v => ({
        x: Math.round(anchor.x + (v.x - anchor.x) * (anchor.x === startBb.minX ? scaleX : anchor.x === startBb.maxX ? scaleX : 1)),
        y: Math.round(anchor.y + (v.y - anchor.y) * (anchor.y === startBb.minY ? scaleY : anchor.y === startBb.maxY ? scaleY : 1))
      }))
      // 修正:用乾淨的 scale (anchor 不動,其他點按比例縮)
      const cleanVs = startVs.map(v => ({
        x: Math.round(anchor.x + (v.x - anchor.x) * scaleX),
        y: Math.round(anchor.y + (v.y - anchor.y) * scaleY)
      }))
      updateSpace(space.id, { vertices: cleanVs, x: undefined, y: undefined, w: undefined, h: undefined })
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
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
               fill={space.color ?? '#e2e8f0'}
               fillOpacity={selected || isMultiSelected ? 0.4 : 0.22}
               stroke={selected ? '#3b82f6' : isMultiSelected ? '#10b981' : 'none'}
               strokeWidth={(selected || isMultiSelected) ? 4 : 0} strokeDasharray="8 6"
               onMouseDown={dragWhole}
               style={{ cursor: 'move' }} />

      {/* 名稱與面積 — 字體自動隨畫布縮放,確保螢幕上一直可讀 */}
      <text x={center.x} y={center.y - fontMain * 0.4} fontSize={fontMain} fontWeight="700"
            fill="#1e293b" textAnchor="middle" dominantBaseline="middle"
            pointerEvents="none" fontFamily="system-ui">
        {space.name}
      </text>
      <text x={center.x} y={center.y + fontMain * 0.5} fontSize={fontSub} fontWeight="500"
            fill="#7c3aed" textAnchor="middle" dominantBaseline="middle"
            pointerEvents="none">
        {areaM2} m² · {ping} 坪
      </text>

      {/* 選取時:bbox 縮放手柄 (橘色,8方向) + 頂點手柄 (藍色) + 邊中點加號 */}
      {selected && (
        <g>
          {/* bbox 縮放 8 方向手柄 — 螢幕視覺保持一致大小 */}
          {(() => {
            const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
            const handles = [
              { x: minX, y: minY, anchor: { x: maxX, y: maxY }, axis: 'xy', cursor: 'nwse-resize', label: '↖' },
              { x: cx,   y: minY, anchor: { x: cx, y: maxY }, axis: 'y', cursor: 'ns-resize',  label: '↑' },
              { x: maxX, y: minY, anchor: { x: minX, y: maxY }, axis: 'xy', cursor: 'nesw-resize', label: '↗' },
              { x: maxX, y: cy,   anchor: { x: minX, y: cy }, axis: 'x', cursor: 'ew-resize',  label: '→' },
              { x: maxX, y: maxY, anchor: { x: minX, y: minY }, axis: 'xy', cursor: 'nwse-resize', label: '↘' },
              { x: cx,   y: maxY, anchor: { x: cx, y: minY }, axis: 'y', cursor: 'ns-resize',  label: '↓' },
              { x: minX, y: maxY, anchor: { x: maxX, y: minY }, axis: 'xy', cursor: 'nesw-resize', label: '↙' },
              { x: minX, y: cy,   anchor: { x: maxX, y: cy }, axis: 'x', cursor: 'ew-resize',  label: '←' }
            ]
            return handles.map((h, i) => (
              <rect key={`rh-${i}`}
                    x={h.x - handleR} y={h.y - handleR}
                    width={handleR * 2} height={handleR * 2}
                    fill="#f59e0b" stroke="white" strokeWidth={handleStrokeW}
                    onMouseDown={(e) => bboxResize(e, h.anchor, h.axis)}
                    style={{ cursor: h.cursor }}>
                <title>拖動縮放 {h.label} (Shift = 等比)</title>
              </rect>
            ))
          })()}

          {/* 頂點手柄 (藍色,個別拖頂點調整形狀);多邊形 ≥ 5 個頂點才顯示,矩形不顯示避免擁擠 */}
          {vertices.length >= 5 && vertices.map((v, i) => (
            <circle key={`vh-${i}`}
                    cx={v.x} cy={v.y} r={handleR * 0.75}
                    fill="#3b82f6" stroke="white" strokeWidth={handleStrokeW}
                    onMouseDown={(e) => dragVertex(e, i)}
                    onContextMenu={(e) => removeVertex(e, i)}
                    style={{ cursor: 'grab' }}>
              <title>拖動改變形狀,右鍵刪除此頂點</title>
            </circle>
          ))}

          {/* 邊中點加新頂點 (雙擊) */}
          {vertices.map((v, i) => {
            const b = vertices[(i + 1) % vertices.length]
            const mx = (v.x + b.x) / 2, my = (v.y + b.y) / 2
            return (
              <g key={`eh-${i}`}>
                <circle cx={mx} cy={my} r={handleR * 0.55} fill="white" stroke="#3b82f6"
                        strokeWidth={handleStrokeW}
                        onDoubleClick={(e) => addVertexAtEdge(e, i)}
                        style={{ cursor: 'cell' }}>
                  <title>雙擊在這條邊加頂點</title>
                </circle>
                <text x={mx} y={my + handleR * 0.2}
                      fontSize={handleR * 0.9} fill="#3b82f6"
                      textAnchor="middle" dominantBaseline="middle"
                      pointerEvents="none">+</text>
              </g>
            )
          })}
        </g>
      )}
    </g>
  )
}
