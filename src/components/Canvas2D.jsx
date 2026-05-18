import { useRef, useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { toPing, spaceVertices, spaceEdges, allRenderableWalls, polygonCenter, polygonArea } from '../lib/constraints.js'
import WallsLayer from './canvas/WallsLayer.jsx'
import SpacePolygon from './canvas/SpacePolygon.jsx'
import MapOverlay from './canvas/MapOverlay.jsx'

// ---- 幾何工具 ----
function pointToSegmentDistance(p, seg) {
  const { x1, y1, x2, y2 } = seg
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { dist: Math.hypot(p.x - x1, p.y - y1), t: 0 }
  const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len2))
  const x = x1 + t * dx, y = y1 + t * dy
  return { dist: Math.hypot(p.x - x, p.y - y), t }
}
/**
 * 按角度吸附:
 *  - force=true (按 Shift):強制鎖死水平或垂直 (取較大軸)
 *  - force=false:接近 ±10° 才自動吸附
 */
function snapToOrtho(p1, p2, force) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (force) {
    // 按 Shift:強制鎖正交
    if (Math.abs(dx) >= Math.abs(dy)) return { x: p2.x, y: p1.y }
    return { x: p1.x, y: p2.y }
  }
  // 沒按 Shift:接近 ±10° 才自動吸附 (避免完全水平/垂直的小抖動)
  if (Math.abs(dx) > Math.abs(dy) * 5.7) return { x: p2.x, y: p1.y }  // 水平
  if (Math.abs(dy) > Math.abs(dx) * 5.7) return { x: p1.x, y: p2.y }  // 垂直
  return p2
}

/**
 * 底圖渲染 — v3_8 風格:
 *   底圖 placement 用 4 個 cm 值 (offsetX, offsetY, drawW, drawH) 直接畫到 SVG。
 *   畫布 zoom 變大時,底圖跟所有其他元素一起放大 (走 SVG viewBox 縮放)。
 *   保留 rotation/opacity 控制。第一次上傳時自動算 placement 居中填滿可用區。
 */
function BaseLayerRender({ baseLayer, svgW, svgH }) {
  if (!baseLayer) return null
  // 新 placement schema (cm 單位,跟 SVG viewBox 同一個座標系):
  //   { offsetX, offsetY, drawW, drawH, rotation, opacity }
  // 舊資料可能還用 transform.{x,y,scale,rotation} → 自動 fallback
  let p = baseLayer.placement
  if (!p) {
    // legacy compatibility
    const t = baseLayer.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
    const W = baseLayer.width  || 1000
    const H = baseLayer.height || 1000
    const fit = Math.min((svgW * 0.9) / W, (svgH * 0.9) / H)
    const s = fit * (t.scale || 1)
    p = {
      drawW: W * s,
      drawH: H * s,
      offsetX: (svgW - W * s) / 2 + (t.x || 0),
      offsetY: (svgH - H * s) / 2 + (t.y || 0),
      rotation: t.rotation || 0,
      opacity: baseLayer.opacity ?? 0.6
    }
  }
  const cx = p.offsetX + p.drawW / 2
  const cy = p.offsetY + p.drawH / 2
  const transformStr = p.rotation ? `rotate(${p.rotation} ${cx} ${cy})` : undefined

  if (baseLayer.type === 'dxf' && baseLayer.dxfLines?.length) {
    const bb = baseLayer.bbox
    const sx = p.drawW / (bb.width || 1)
    const sy = p.drawH / (bb.height || 1)
    return (
      <g transform={transformStr} opacity={p.opacity ?? 0.55}>
        {baseLayer.dxfLines.map((l, i) => (
          <line key={i}
                x1={p.offsetX + (l.x1 - bb.minX) * sx}
                y1={p.offsetY + (bb.maxY - l.y1) * sy}  // CAD Y 朝上 → SVG Y 翻轉
                x2={p.offsetX + (l.x2 - bb.minX) * sx}
                y2={p.offsetY + (bb.maxY - l.y2) * sy}
                stroke="#475569" strokeWidth={Math.max(1, 2 / Math.max(sx, sy))} />
        ))}
      </g>
    )
  }

  const imgUrl = baseLayer.type === 'pdf' ? baseLayer.previewUrl : baseLayer.publicUrl
  if (!imgUrl) return null
  return (
    <g transform={transformStr}>
      <image href={imgUrl}
             x={p.offsetX} y={p.offsetY}
             width={p.drawW} height={p.drawH}
             opacity={p.opacity ?? 0.6}
             preserveAspectRatio="none" />
    </g>
  )
}

/**
 * 2D 拖拉畫布 — SVG 實作(從 v3_8 精簡)
 *  - 房間、家具都可拖移
 *  - 點選後右下角可拉伸 (resize handle)
 *  - 顯示底稿:可用區邊界、保留走道、結構柱
 *  - 1px 在 SVG viewBox 裡 = 1cm,外層 wrapper 控制縮放
 */
export default function Canvas2D() {
  const plan = usePlanStore(s => s.plan)
  const updateRoom = usePlanStore(s => s.updateRoom)
  const updateFurniture = usePlanStore(s => s.updateFurniture)
  const removeRoom = usePlanStore(s => s.removeRoom)
  const removeFurniture = usePlanStore(s => s.removeFurniture)
  const removeWall = usePlanStore(s => s.removeWall)
  const removeDoor = usePlanStore(s => s.removeDoor)
  const removeWindow = usePlanStore(s => s.removeWindow)
  const removeSpace = usePlanStore(s => s.removeSpace)
  const selectedIds = usePlanStore(s => s.selectedIds) || []
  const setSelectedIds = usePlanStore(s => s.setSelectedIds)
  const clipboard = usePlanStore(s => s.clipboard)
  const setClipboard = usePlanStore(s => s.setClipboard)
  const selectedId = usePlanStore(s => s.selectedId)
  const setSelected = usePlanStore(s => s.setSelected)
  const calibMode = usePlanStore(s => s.calibMode)
  const setCalibMode = usePlanStore(s => s.setCalibMode)
  const calibPoints = usePlanStore(s => s.calibPoints)
  const addCalibPoint = usePlanStore(s => s.addCalibPoint)

  // 編輯模式 + 工具的暫存
  const editMode = usePlanStore(s => s.editMode)
  const setEditMode = usePlanStore(s => s.setEditMode)
  const measurePoints = usePlanStore(s => s.measurePoints)
  const addMeasurePoint = usePlanStore(s => s.addMeasurePoint)
  const clearMeasurePoints = usePlanStore(s => s.clearMeasurePoints)
  const snapGuides = usePlanStore(s => s.snapGuides) || []
  const pinnedMeasures = usePlanStore(s => s.pinnedMeasures)
  const pinCurrentMeasure = usePlanStore(s => s.pinCurrentMeasure)
  const removePinnedMeasure = usePlanStore(s => s.removePinnedMeasure)
  const pendingWallStart = usePlanStore(s => s.pendingWallStart)
  const setPendingWallStart = usePlanStore(s => s.setPendingWallStart)
  const addWall = usePlanStore(s => s.addWall)
  const addDoor = usePlanStore(s => s.addDoor)
  const addWindow = usePlanStore(s => s.addWindow)
  const addSpace = usePlanStore(s => s.addSpace)
  const undo = usePlanStore(s => s.undo)
  const redo = usePlanStore(s => s.redo)

  const svgRef = useRef(null)
  const dragRef = useRef(null)  // { kind, id, offsetX, offsetY, mode:'move'|'resize' }
  const setBaseLayer = usePlanStore(s => s.setBaseLayer)
  const [mouseSvg, setMouseSvg] = useState(null)  // 滑鼠目前 SVG 座標 (給工具預覽用)
  const [shiftHeld, setShiftHeld] = useState(false)

  const setCanvasZoom = usePlanStore(s => s.setCanvasZoom)
  const [zoom, _setZoom] = useState(0.15)
  function setZoom(v) {
    const z = typeof v === 'function' ? v(zoom) : v
    _setZoom(z)
    setCanvasZoom(z)
  }
  const svgW = plan.bounds.w
  const svgH = plan.bounds.h

  // Alt + 滾輪縮放底圖 (CAD 慣例的 zoom)
  function onWheel(e) {
    if (!plan.baseLayer) return
    if (!(e.altKey || e.metaKey)) return  // 只有按 Alt/Cmd 才生效,避免影響頁面滾動
    e.preventDefault()
    const t = plan.baseLayer.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
    const factor = e.deltaY < 0 ? 1.08 : 1/1.08
    const newScale = Math.max(0.1, Math.min(10, t.scale * factor))
    setBaseLayer({ ...plan.baseLayer, transform: { ...t, scale: newScale } })
  }

  function clientToSvg(e) {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  function startDrag(e, kind, item, mode='move') {
    e.stopPropagation()
    setSelected(item.id)
    const p = clientToSvg(e)
    dragRef.current = {
      kind, id: item.id, mode,
      startX: p.x, startY: p.y,
      origX: item.x, origY: item.y, origW: item.w, origH: item.h
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  function onMove(e) {
    const d = dragRef.current; if (!d) return
    const svg = svgRef.current; if (!svg) return
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    const dx = p.x - d.startX, dy = p.y - d.startY
    const patch = d.mode === 'move'
      ? { x: Math.max(0, Math.round(d.origX + dx)), y: Math.max(0, Math.round(d.origY + dy)) }
      : { w: Math.max(30, Math.round(d.origW + dx)), h: Math.max(30, Math.round(d.origH + dy)) }
    if (d.kind === 'room') updateRoom(d.id, patch)
    else if (d.kind === 'furn') updateFurniture(d.id, patch)
  }
  function onUp() {
    dragRef.current = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  function onKey(e) {
    // 全域快捷鍵
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo(); else undo()
      return
    }
    // Cmd+C 複製選取空間
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : [])
      const items = (plan.spaces || []).filter(sp => ids.includes(sp.id))
      if (items.length) {
        setClipboard({ type: 'spaces', items: JSON.parse(JSON.stringify(items)) })
      }
      return
    }
    // Cmd+V 貼上 (偏移 100,100)
    if (mod && e.key.toLowerCase() === 'v' && clipboard?.items?.length) {
      e.preventDefault()
      const newIds = []
      for (const item of clipboard.items) {
        const vs = spaceVertices(item)
        const newVs = vs.map(v => ({ x: v.x + 100, y: v.y + 100 }))
        const newId = addSpace({
          name: (item.name || '空間') + ' (副本)',
          type: item.type,
          color: item.color,
          height: item.height,
          wallKind: item.wallKind,
          wallThickness: item.wallThickness,
          vertices: newVs
        })
        if (newId) newIds.push(newId)
      }
      setSelectedIds(newIds)
      setSelected(null)
      return
    }
    // Cmd+A 全選空間
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      const all = (plan.spaces || []).map(sp => sp.id)
      setSelectedIds(all)
      setSelected(null)
      return
    }
    if (e.key === 'Escape') {
      setEditMode('select')
      setPendingWallStart(null)
      clearMeasurePoints()
      setSelected(null)
      setSelectedIds([])
      return
    }
    // 模式快捷鍵
    if (!mod && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'v') return setEditMode('select')
      if (k === 'w') return setEditMode('add-wall')
      if (k === 'd') return setEditMode('add-door')
      if (k === 'n') return setEditMode('add-window')
      if (k === 'r') return setEditMode('add-space')
      if (k === 'c') return setEditMode('add-column')
      if (k === 'm') return setEditMode('measure')
    }
    // 刪除 (支援多選)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const toDelete = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : [])
      if (!toDelete.length) return
      for (const id of toDelete) {
        if ((plan.walls   || []).find(w => w.id === id)) removeWall(id)
        else if ((plan.doors   || []).find(d => d.id === id)) removeDoor(id)
        else if ((plan.windows || []).find(w => w.id === id)) removeWindow(id)
        else if ((plan.spaces  || []).find(s => s.id === id)) removeSpace(id)
        else if (plan.rooms.find(r => r.id === id)) removeRoom(id)
        else if (plan.furniture.find(f => f.id === id)) removeFurniture(id)
        else if (id?.startsWith('col') && plan.structuralColumns?.find(c => c.id === id)) {
          // 刪掉柱子
          const cur = usePlanStore.getState().plan
          usePlanStore.getState().setPlan({
            ...cur,
            structuralColumns: cur.structuralColumns.filter(c => c.id !== id)
          })
        }
      }
      setSelected(null)
      setSelectedIds([])
    }
  }

  // 找出滑鼠位置最近的牆 (給加門/加窗用) — 包含空間的邊與獨立牆
  function findNearestWall(p) {
    let best = null, bestDist = Infinity
    for (const w of allRenderableWalls(plan)) {
      const d = pointToSegmentDistance(p, w)
      if (d.dist < bestDist && d.dist < 50) {  // 50cm 內才算
        bestDist = d.dist
        best = { wall: w, t: d.t }
      }
    }
    return best
  }

  function onCanvasMouseDown(e) {
    if (calibMode) {
      const p = clientToSvg(e)
      addCalibPoint({ x: Math.round(p.x), y: Math.round(p.y) })
      return
    }
    const p = clientToSvg(e)
    if (editMode === 'measure') {
      addMeasurePoint({ x: Math.round(p.x), y: Math.round(p.y) })
      return
    }
    if (editMode === 'add-wall') {
      if (!pendingWallStart) {
        setPendingWallStart({ x: Math.round(p.x), y: Math.round(p.y) })
      } else {
        // 按 Shift = 強制正交;沒按 = 接近正交才自動吸
        const snap = snapToOrtho(pendingWallStart, p, e.shiftKey)
        addWall({ x1: pendingWallStart.x, y1: pendingWallStart.y, x2: Math.round(snap.x), y2: Math.round(snap.y) })
        setPendingWallStart(null)
      }
      return
    }
    if (editMode === 'add-door' || editMode === 'add-window') {
      const near = findNearestWall(p)
      if (!near) return
      if (editMode === 'add-door') {
        addDoor({ wallId: near.wall.id, t: near.t, width: 90 })
      } else {
        addWindow({ wallId: near.wall.id, t: near.t, width: 150 })
      }
      return
    }
    if (editMode === 'add-space') {
      // 預設加一個 300×300 的空間,使用者再拖大小
      addSpace({ name: '空間', type: 'custom', x: Math.round(p.x), y: Math.round(p.y), w: 300, h: 300, color: '#fef3c7' })
      setEditMode('select')
      return
    }
    if (editMode === 'add-column') {
      // 點哪裡加一根 60×60 cm 柱子
      const size = 60
      const cur = usePlanStore.getState().plan
      const newCol = {
        id: 'col_' + Math.random().toString(36).slice(2, 9),
        x: Math.round(p.x - size / 2),
        y: Math.round(p.y - size / 2),
        w: size, h: size
      }
      usePlanStore.getState().setPlan({
        ...cur,
        structuralColumns: [...(cur.structuralColumns || []), newCol]
      })
      // 連續加柱模式:不退回 select,可以連續點
      return
    }
    setSelected(null)
  }

  const cssW = svgW * zoom, cssH = svgH * zoom

  return (
    <div className="relative h-full overflow-auto bg-slate-100 p-4"
         tabIndex={0} onKeyDown={onKey} onWheel={onWheel}>
      <MapOverlay zoom={zoom} svgW={svgW} svgH={svgH} svgUnitToRealCm={plan.svgUnitToRealCm || 1} />
      <div className="absolute top-2 right-4 z-10 bg-white rounded shadow px-2 py-1 flex gap-2 text-xs items-center">
        <button onClick={() => setZoom(z => Math.max(0.05, z - 0.03))} className="px-2">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(0.6, z + 0.03))} className="px-2">+</button>
      </div>
      <svg ref={svgRef} className="canvas-svg"
           viewBox={`0 0 ${svgW} ${svgH}`}
           style={{ width: cssW, height: cssH, background: 'white',
             cursor: calibMode || editMode !== 'select' ? 'crosshair' : 'default' }}
           onMouseDown={onCanvasMouseDown}
           onMouseMove={(e) => { setMouseSvg(clientToSvg(e)); setShiftHeld(e.shiftKey) }}>
        {/* 底圖 (DXF/PDF/圖片) — 放在最底層 */}
        <BaseLayerRender baseLayer={plan.baseLayer} svgW={svgW} svgH={svgH} />

        {/* 樓層邊界 */}
        <rect x={0} y={0} width={svgW} height={svgH} fill="none" stroke="#0f172a" strokeWidth={6} />

        {/* 可用區 — 改成只描虛線邊框,不填色,避免遮住底圖 */}
        <rect x={plan.availableZone.x} y={plan.availableZone.y}
              width={plan.availableZone.w} height={plan.availableZone.h}
              fill="none" stroke="#94a3b8" strokeDasharray="20 10" strokeWidth={2} />

        {/* 區外保留走道 */}
        {plan.keepOutCorridors.map((c, i) => (
          <g key={i}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#fee2e2" stroke="#ef4444" />
            <text x={c.x + 10} y={c.y + 30} fontSize={28} fill="#b91c1c">走道(不可動) {c.note ?? ''}</text>
          </g>
        ))}

        {/* 結構柱 (點擊選取 → Backspace 可刪) */}
        {plan.structuralColumns.map((c, i) => {
          const id = c.id || `col_idx_${i}`
          const isSel = selectedId === id
          return (
            <g key={id}
               onMouseDown={(e) => { e.stopPropagation(); setSelected(id) }}
               style={{ cursor: 'pointer' }}>
              <rect x={c.x} y={c.y} width={c.w} height={c.h}
                    fill={isSel ? '#ef4444' : '#1f2937'}
                    stroke={isSel ? '#fbbf24' : 'none'}
                    strokeWidth={isSel ? 4 : 0} />
            </g>
          )
        })}

        {/* 空間多邊形 (填色 + 名稱 + 面積),牆已併入 WallsLayer */}
        {(plan.spaces || []).map(sp => (
          <SpacePolygon key={sp.id} space={sp}
                        selected={selectedId === sp.id}
                        onSelect={setSelected} />
        ))}

        {/* 牆 / 門 / 窗 — 牆 = 所有空間的邊 + legacy 獨立牆 */}
        <WallsLayer
          walls={allRenderableWalls(plan)}
          doors={plan.doors || []}
          windows={plan.windows || []}
          selectedId={selectedId}
          onSelect={(id) => setSelected(id)} />

        {/* 房間 (legacy:只有 walls 都空才顯示色塊,過渡用) */}
        {(plan.walls?.length || 0) === 0 && plan.rooms.map(r => (
          <g key={r.id} onMouseDown={(e) => startDrag(e, 'room', r)} style={{ cursor: 'move' }}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h}
                  fill={r.color ?? '#e2e8f0'} stroke={selectedId === r.id ? '#3b82f6' : '#475569'}
                  strokeWidth={selectedId === r.id ? 6 : 2} />
            <text x={r.x + 10} y={r.y + 36} fontSize={32} fill="#0f172a">{r.name}</text>
            <text x={r.x + 10} y={r.y + 72} fontSize={24} fill="#475569">
              {(r.w/100).toFixed(2)}×{(r.h/100).toFixed(2)}m · {toPing(r.w, r.h)} 坪
            </text>
            {selectedId === r.id && (
              <rect x={r.x + r.w - 30} y={r.y + r.h - 30} width={30} height={30}
                    fill="#3b82f6"
                    onMouseDown={(e) => startDrag(e, 'room', r, 'resize')}
                    style={{ cursor: 'nwse-resize' }} />
            )}
          </g>
        ))}

        {/* 加牆預覽:第一點已點,第二點跟著滑鼠 */}
        {editMode === 'add-wall' && pendingWallStart && mouseSvg && (() => {
          const snap = snapToOrtho(pendingWallStart, mouseSvg, shiftHeld)
          const len = Math.hypot(snap.x - pendingWallStart.x, snap.y - pendingWallStart.y)
          return (
            <g opacity={0.7}>
              <line x1={pendingWallStart.x} y1={pendingWallStart.y} x2={snap.x} y2={snap.y}
                    stroke="#3b82f6" strokeWidth={12} strokeDasharray="20 8" />
              <text x={(pendingWallStart.x + snap.x) / 2 + 20}
                    y={(pendingWallStart.y + snap.y) / 2 - 20}
                    fontSize={28} fill="#1d4ed8" fontWeight="bold">
                {((len * (plan.svgUnitToRealCm || 1)) / 100).toFixed(2)}m
              </text>
            </g>
          )
        })()}

        {/* 對齊輔助線 (拖移時顯示) */}
        {snapGuides.map((g, i) => (
          g.type === 'v'
            ? <line key={`sg-${i}`} x1={g.value} y1={0} x2={g.value} y2={svgH}
                    stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" opacity={0.85} pointerEvents="none" />
            : <line key={`sg-${i}`} x1={0} y1={g.value} x2={svgW} y2={g.value}
                    stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" opacity={0.85} pointerEvents="none" />
        ))}

        {/* 已釘住的量距離 (永遠顯示) */}
        {pinnedMeasures.map((m, i) => {
          const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y)
          return (
            <g key={`pin-${i}`} onMouseDown={(e) => { e.stopPropagation(); if (e.shiftKey) removePinnedMeasure(i) }}>
              <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y}
                    stroke="#0ea5e9" strokeWidth={3} strokeDasharray="8 4" />
              <circle cx={m.a.x} cy={m.a.y} r={8} fill="#0ea5e9" />
              <circle cx={m.b.x} cy={m.b.y} r={8} fill="#0ea5e9" />
              <text x={(m.a.x + m.b.x) / 2 + 14} y={(m.a.y + m.b.y) / 2 - 14}
                    fontSize={26} fill="#0369a1" fontWeight="600">
                {(len / 100).toFixed(2)} m
              </text>
            </g>
          )
        })}

        {/* 量距離結果 (進行中) */}
        {editMode === 'measure' && measurePoints.length > 0 && (
          <g>
            {measurePoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={14} fill="#f59e0b" stroke="white" strokeWidth={3} />
            ))}
            {measurePoints.length === 2 && (() => {
              const [a, b] = measurePoints
              const len = Math.hypot(b.x - a.x, b.y - a.y)
              return (
                <>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke="#f59e0b" strokeWidth={4} strokeDasharray="16 8" />
                  <text x={(a.x + b.x) / 2 + 20} y={(a.y + b.y) / 2 - 20}
                        fontSize={32} fill="#d97706" fontWeight="bold">
                    {((len * (plan.svgUnitToRealCm || 1)) / 100).toFixed(2)} m
                  </text>
                  {/* 釘住按鈕 */}
                  <g onMouseDown={(e) => { e.stopPropagation(); pinCurrentMeasure() }}
                     style={{ cursor: 'pointer' }}>
                    <rect x={(a.x + b.x) / 2 - 30} y={(a.y + b.y) / 2 + 16}
                          width={60} height={28} rx={6} fill="#0ea5e9" />
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 36}
                          fontSize={20} fill="white" fontWeight="bold"
                          textAnchor="middle">📌 釘住</text>
                  </g>
                </>
              )
            })()}
          </g>
        )}

        {/* 校準點視覺呈現 (點兩點測距用) */}
        {calibMode && calibPoints.map((p, i) => (
          <g key={`cal-${i}`}>
            <circle cx={p.x} cy={p.y} r={20} fill="#ef4444" stroke="white" strokeWidth={4} />
            <text x={p.x + 25} y={p.y + 8} fontSize={28} fill="#b91c1c" fontWeight="bold">P{i+1}</text>
          </g>
        ))}
        {calibMode && calibPoints.length === 2 && (
          <line x1={calibPoints[0].x} y1={calibPoints[0].y}
                x2={calibPoints[1].x} y2={calibPoints[1].y}
                stroke="#ef4444" strokeWidth={6} strokeDasharray="20 10" />
        )}

        {/* 家具 */}
        {plan.furniture.map(f => (
          <g key={f.id} onMouseDown={(e) => startDrag(e, 'furn', f)} style={{ cursor: 'move' }}>
            <rect x={f.x} y={f.y} width={f.w} height={f.h}
                  fill={f.color ?? '#94a3b8'} fillOpacity={0.85}
                  stroke={selectedId === f.id ? '#3b82f6' : '#1f2937'}
                  strokeWidth={selectedId === f.id ? 4 : 1} />
            <text x={f.x + 5} y={f.y + 20} fontSize={18} fill="white">{f.name}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}
