import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { roomTemplates } from '../lib/constraints.js'

/**
 * 屬性面板 — 浮動在畫布右下,選取後出現。
 * 支援:空間、牆、門、窗 的屬性編輯。
 */
const SPACE_TYPES = [
  { value: 'office',   label: '辦公室',     color: '#bfdbfe' },
  { value: 'meeting',  label: '會議室',     color: '#a7f3d0' },
  { value: 'pantry',   label: '茶水間',     color: '#fde68a' },
  { value: 'gym',      label: '健身區',     color: '#fca5a5' },
  { value: 'sauna',    label: '三溫暖室',   color: '#fdba74' },
  { value: 'shower',   label: '淋浴間',     color: '#93c5fd' },
  { value: 'locker',   label: '更衣室',     color: '#c4b5fd' },
  { value: 'lounge',   label: '休息區',     color: '#fbcfe8' },
  { value: 'restroom', label: '洗手間',     color: '#cbd5e1' },
  { value: 'corridor', label: '走道',       color: '#e5e7eb' },
  { value: 'custom',   label: '其他',       color: '#e2e8f0' }
]

export default function PropertiesPanel() {
  const plan = usePlanStore(s => s.plan)
  const selectedId = usePlanStore(s => s.selectedId)
  const setSelected = usePlanStore(s => s.setSelected)
  const [collapsed, setCollapsed] = useState(false)
  const updateSpace = usePlanStore(s => s.updateSpace)
  const updateWall = usePlanStore(s => s.updateWall)
  const updateDoor = usePlanStore(s => s.updateDoor)
  const updateWindow = usePlanStore(s => s.updateWindow)
  const removeSpace = usePlanStore(s => s.removeSpace)
  const removeWall = usePlanStore(s => s.removeWall)
  const removeDoor = usePlanStore(s => s.removeDoor)
  const removeWindow = usePlanStore(s => s.removeWindow)

  if (!selectedId) return null

  const space = plan.spaces?.find(s => s.id === selectedId)
  const wall  = plan.walls?.find(w => w.id === selectedId)
  const door  = plan.doors?.find(d => d.id === selectedId)
  const win   = plan.windows?.find(w => w.id === selectedId)

  if (!space && !wall && !door && !win) return null

  const title = space ? '🏠 空間屬性' : wall ? '🧱 牆屬性' : door ? '🚪 門屬性' : '🪟 窗屬性'

  // 摺疊狀態:只顯示一個小條,點開展開
  if (collapsed) {
    return (
      <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-white border rounded-full shadow-md px-3 py-1 z-20 flex items-center gap-2 text-xs">
        <button onClick={() => setCollapsed(false)}
                className="hover:text-brand-700">▾ {title}</button>
        <button onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-800">✕</button>
      </div>
    )
  }

  // 完整面板:放右上,寬 256
  return (
    <div className="absolute top-3 right-3 w-64 bg-white border rounded-lg shadow-lg text-xs p-3 space-y-2 z-20">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{title}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCollapsed(true)} title="摺疊"
                  className="text-slate-400 hover:text-slate-800">▴</button>
          <button onClick={() => setSelected(null)} title="關閉"
                  className="text-slate-400 hover:text-slate-800">✕</button>
        </div>
      </div>

      {space && (
        <SpaceForm space={space}
                   onChange={(p) => updateSpace(space.id, p)}
                   onRemove={() => { removeSpace(space.id); setSelected(null) }} />
      )}
      {wall && (
        <WallForm wall={wall}
                  onChange={(p) => updateWall(wall.id, p)}
                  onRemove={() => { removeWall(wall.id); setSelected(null) }} />
      )}
      {door && (
        <DoorForm door={door}
                  onChange={(p) => updateDoor(door.id, p)}
                  onRemove={() => { removeDoor(door.id); setSelected(null) }} />
      )}
      {win && (
        <WindowForm win={win}
                    onChange={(p) => updateWindow(win.id, p)}
                    onRemove={() => { removeWindow(win.id); setSelected(null) }} />
      )}
    </div>
  )
}

function SpaceForm({ space, onChange, onRemove }) {
  const plan = usePlanStore(s => s.plan)
  const f = plan?.svgUnitToRealCm || 1
  // 從 vertices 算 bounding box 寬高 (svg unit) → 真實 cm
  const vs = space.vertices?.length >= 3 ? space.vertices : [
    { x: space.x ?? 0, y: space.y ?? 0 },
    { x: (space.x ?? 0) + (space.w ?? 0), y: space.y ?? 0 },
    { x: (space.x ?? 0) + (space.w ?? 0), y: (space.y ?? 0) + (space.h ?? 0) },
    { x: space.x ?? 0, y: (space.y ?? 0) + (space.h ?? 0) }
  ]
  const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const widthCm = (maxX - minX) * f
  const heightCm = (maxY - minY) * f
  // 計算面積
  let area = 0
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    area += a.x * b.y - b.x * a.y
  }
  area = Math.abs(area / 2) * f * f  // cm²
  const ping = (area / 33057.85).toFixed(2)
  const m2 = (area / 10000).toFixed(2)

  function setDimensions(newWidthCm, newHeightCm) {
    // 等比把多邊形縮放到新尺寸
    const newWidthSvg = newWidthCm / f
    const newHeightSvg = newHeightCm / f
    const scaleX = (maxX - minX) > 0 ? newWidthSvg / (maxX - minX) : 1
    const scaleY = (maxY - minY) > 0 ? newHeightSvg / (maxY - minY) : 1
    const newVs = vs.map(v => ({
      x: Math.round(minX + (v.x - minX) * scaleX),
      y: Math.round(minY + (v.y - minY) * scaleY)
    }))
    onChange({ vertices: newVs, x: undefined, y: undefined, w: undefined, h: undefined })
  }

  return (<>
    <Field label="名稱">
      <input value={space.name || ''}
             onChange={e => onChange({ name: e.target.value })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <Field label="類型">
      <select value={space.type || 'custom'}
              onChange={e => {
                const t = SPACE_TYPES.find(x => x.value === e.target.value)
                onChange({ type: e.target.value, color: t?.color || space.color })
              }}
              className="w-full border rounded px-1.5 py-1">
        {SPACE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
    </Field>
    {/* 尺寸輸入 */}
    <div className="grid grid-cols-2 gap-1">
      <Field label="寬 (cm)">
        <input type="number" min="1" value={Math.round(widthCm)}
               onChange={e => setDimensions(Number(e.target.value), heightCm)}
               className="w-full border rounded px-1.5 py-1" />
      </Field>
      <Field label="長 (cm)">
        <input type="number" min="1" value={Math.round(heightCm)}
               onChange={e => setDimensions(widthCm, Number(e.target.value))}
               className="w-full border rounded px-1.5 py-1" />
      </Field>
    </div>
    <div className="text-[10px] text-slate-500 -mt-1">
      面積:{m2} m² · <b>{ping} 坪</b>
      {vs.length > 4 && <span className="ml-1 text-amber-600">(多邊形,改尺寸為等比縮放)</span>}
    </div>
    <Field label="顏色">
      <input type="color" value={space.color || '#e2e8f0'}
             onChange={e => onChange({ color: e.target.value })}
             className="w-full h-7 border rounded cursor-pointer" />
    </Field>
    <Field label="樓高 (cm)">
      <input type="number" value={space.height || 280}
             onChange={e => onChange({ height: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <RemoveBtn onClick={onRemove} label="刪除空間" />
  </>)
}

function WallForm({ wall, onChange, onRemove }) {
  return (<>
    <Field label="類型">
      <select value={wall.kind || 'interior'}
              onChange={e => {
                const k = e.target.value
                const t = k === 'exterior' ? 24 : k === 'partition' ? 8 : 12
                onChange({ kind: k, thickness: t })
              }}
              className="w-full border rounded px-1.5 py-1">
        <option value="exterior">外牆 (24cm)</option>
        <option value="interior">內牆 (12cm)</option>
        <option value="partition">輕隔間 (8cm)</option>
      </select>
    </Field>
    <Field label="厚度 (cm)">
      <input type="number" value={wall.thickness || 12}
             onChange={e => onChange({ thickness: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <RemoveBtn onClick={onRemove} label="刪除牆" />
  </>)
}

// 門類型 → 預設寬度
const DOOR_DEFAULT_WIDTH = { single: 90, double: 180, slide: 150 }

function DoorForm({ door, onChange, onRemove }) {
  const type = door.type || 'single'
  const sw = door.swing || 'in-right'
  // 拆解 swing 成兩個獨立可切的維度
  const direction = sw.startsWith('in') ? 'in' : 'out'   // 向內/向外
  const side = sw.endsWith('right') ? 'right' : 'left'   // 合葉在右/左
  function setSwingParts(nextDir, nextSide) {
    onChange({ swing: `${nextDir}-${nextSide}` })
  }
  function setType(nextType) {
    // 切換類型時若 width 還是舊類型的預設,自動帶入新預設
    const oldDefault = DOOR_DEFAULT_WIDTH[type]
    const newDefault = DOOR_DEFAULT_WIDTH[nextType]
    const patch = { type: nextType }
    if (!door.width || door.width === oldDefault) patch.width = newDefault
    onChange(patch)
  }

  return (<>
    <Field label="門類型">
      <div className="grid grid-cols-3 gap-1">
        {[
          { v: 'single', label: '🚪 單開', w: 90 },
          { v: 'double', label: '🚪🚪 雙開', w: 180 },
          { v: 'slide',  label: '⇆ 推拉',  w: 150 }
        ].map(o => (
          <button key={o.v} type="button"
                  onClick={() => setType(o.v)}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    type === o.v ? 'bg-brand-700 text-white border-brand-700' : 'bg-white hover:bg-slate-100'
                  }`}
                  title={`預設寬 ${o.w}cm`}>
            {o.label}
          </button>
        ))}
      </div>
    </Field>

    <Field label="寬度 (cm)">
      <div className="flex gap-1">
        <input type="number" value={door.width || DOOR_DEFAULT_WIDTH[type]}
               onChange={e => onChange({ width: Number(e.target.value) })}
               className="flex-1 border rounded px-1.5 py-1" />
        <button type="button"
                onClick={() => onChange({ width: DOOR_DEFAULT_WIDTH[type] })}
                title="重設為預設寬度"
                className="px-2 text-[11px] bg-slate-100 rounded hover:bg-slate-200">
          ↺ {DOOR_DEFAULT_WIDTH[type]}
        </button>
      </div>
    </Field>

    <Field label={type === 'slide' ? '滑入方向' : '開門方向'}>
      <div className="space-y-1">
        {/* 向內/向外切換 */}
        <div className="grid grid-cols-2 gap-1">
          <button type="button"
                  onClick={() => setSwingParts('in', side)}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    direction === 'in' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-slate-100'
                  }`}>
            ↓ 向內
          </button>
          <button type="button"
                  onClick={() => setSwingParts('out', side)}
                  className={`px-2 py-1 rounded border text-[11px] ${
                    direction === 'out' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-slate-100'
                  }`}>
            ↑ 向外
          </button>
        </div>
        {/* 左/右合葉 (雙開門隱藏,因為兩邊都有合葉) */}
        {type !== 'double' && (
          <div className="grid grid-cols-2 gap-1">
            <button type="button"
                    onClick={() => setSwingParts(direction, 'left')}
                    className={`px-2 py-1 rounded border text-[11px] ${
                      side === 'left' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white hover:bg-slate-100'
                    }`}>
              ← {type === 'slide' ? '往左滑' : '左合葉'}
            </button>
            <button type="button"
                    onClick={() => setSwingParts(direction, 'right')}
                    className={`px-2 py-1 rounded border text-[11px] ${
                      side === 'right' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white hover:bg-slate-100'
                    }`}>
              {type === 'slide' ? '往右滑' : '右合葉'} →
            </button>
          </div>
        )}
        {/* 一鍵翻轉鈕 */}
        <button type="button"
                onClick={() => {
                  // 翻轉:in↔out, left↔right 都翻
                  const nd = direction === 'in' ? 'out' : 'in'
                  const ns = side === 'left' ? 'right' : 'left'
                  setSwingParts(nd, ns)
                }}
                className="w-full px-2 py-1 rounded border bg-slate-100 hover:bg-slate-200 text-[11px]">
          🔄 整個翻轉 (試所有方向)
        </button>
      </div>
    </Field>

    <Field label="沿牆位置 (0-1)">
      <input type="range" min="0" max="1" step="0.01"
             value={door.t ?? 0.5}
             onChange={e => onChange({ t: Number(e.target.value) })}
             className="w-full" />
      <div className="text-[10px] text-slate-500 text-right">{((door.t ?? 0.5) * 100).toFixed(0)}%</div>
    </Field>

    <div className="flex gap-2 pt-1">
      <label className="flex items-center gap-1 text-[11px]">
        <input type="checkbox" checked={!!door.isEntry}
               onChange={e => onChange({ isEntry: e.target.checked })} />
        主入口
      </label>
      <label className="flex items-center gap-1 text-[11px]">
        <input type="checkbox" checked={!!door.isExit}
               onChange={e => onChange({ isExit: e.target.checked })} />
        逃生口
      </label>
    </div>
    <RemoveBtn onClick={onRemove} label="刪除門" />
  </>)
}

function WindowForm({ win, onChange, onRemove }) {
  return (<>
    <Field label="寬度 (cm)">
      <input type="number" value={win.width || 150}
             onChange={e => onChange({ width: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <Field label="窗台高度 (cm)">
      <input type="number" value={win.sillHeight || 90}
             onChange={e => onChange({ sillHeight: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <Field label="位置 (沿牆 0-1)">
      <input type="number" step="0.01" min="0" max="1"
             value={win.t ?? 0.5}
             onChange={e => onChange({ t: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <RemoveBtn onClick={onRemove} label="刪除窗" />
  </>)
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-500 block mb-0.5">{label}</span>
      {children}
    </label>
  )
}
function RemoveBtn({ onClick, label }) {
  return (
    <button onClick={onClick}
            className="w-full mt-1 px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">
      🗑 {label}
    </button>
  )
}
