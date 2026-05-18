import { furnitureCatalog, newId } from '../lib/constraints.js'
import { usePlanStore } from '../store/planStore.js'

export default function FurnitureLibrary() {
  const addFurniture = usePlanStore(s => s.addFurniture)
  const plan = usePlanStore(s => s.plan)

  function place(f) {
    addFurniture({
      id: newId('furn'),
      modelKey: f.key,
      name: f.name,
      x: plan.availableZone.x + 100,
      y: plan.availableZone.y + 100,
      w: f.w,
      h: f.h,
      height: f.height,
      rot: 0,
      color: f.color
    })
  }

  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-500 px-2 pt-2">點擊新增家具</div>
      {furnitureCatalog.map(f => (
        <button key={f.key} onClick={() => place(f)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-sm">
          <span className="w-4 h-4 rounded" style={{ background: f.color }} />
          <span>{f.name}</span>
          <span className="ml-auto text-xs text-slate-400">{f.w}×{f.h}×{f.height}</span>
        </button>
      ))}
    </div>
  )
}
