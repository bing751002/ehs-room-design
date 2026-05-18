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

  return (
    <div className="absolute top-3 right-3 w-64 bg-white border rounded-lg shadow-lg text-xs p-3 space-y-2 z-20">
      <div className="flex items-center justify-between">
        <span className="font-semibold">
          {space && '🏠 空間屬性'}
          {wall && '🧱 牆屬性'}
          {door && '🚪 門屬性'}
          {win && '🪟 窗屬性'}
        </span>
        <button onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-800">✕</button>
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

function DoorForm({ door, onChange, onRemove }) {
  return (<>
    <Field label="寬度 (cm)">
      <input type="number" value={door.width || 90}
             onChange={e => onChange({ width: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <Field label="開門方向">
      <select value={door.swing || 'in-right'}
              onChange={e => onChange({ swing: e.target.value })}
              className="w-full border rounded px-1.5 py-1">
        <option value="in-left">向內開 (左)</option>
        <option value="in-right">向內開 (右)</option>
        <option value="out-left">向外開 (左)</option>
        <option value="out-right">向外開 (右)</option>
      </select>
    </Field>
    <Field label="位置 (沿牆 0-1)">
      <input type="number" step="0.01" min="0" max="1"
             value={door.t ?? 0.5}
             onChange={e => onChange({ t: Number(e.target.value) })}
             className="w-full border rounded px-1.5 py-1" />
    </Field>
    <div className="flex gap-1">
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
