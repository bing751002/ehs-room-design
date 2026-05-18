import { usePlanStore } from '../store/planStore.js'

/**
 * 樓層切換 tab 條 — 出現在編輯器頂部。
 * 第一次按「+ 樓層」會自動把現有資料變成第一個樓層。
 */
export default function FloorTabs() {
  const floors = usePlanStore(s => s.plan.floors || [])
  const currentFloorId = usePlanStore(s => s.plan.currentFloorId)
  const switchFloor = usePlanStore(s => s.switchFloor)
  const addFloor = usePlanStore(s => s.addFloor)
  const renameFloor = usePlanStore(s => s.renameFloor)
  const removeFloor = usePlanStore(s => s.removeFloor)

  function onAdd() {
    const name = prompt('新樓層名稱?', `樓層 ${floors.length + 1}`)
    if (!name) return
    addFloor(name)
  }
  function onRename(f) {
    const name = prompt('改樓層名稱?', f.name)
    if (!name) return
    renameFloor(f.id, name)
  }
  function onRemove(f) {
    if (!confirm(`刪除樓層「${f.name}」?所有牆/門/窗/空間都會消失,且無法復原`)) return
    removeFloor(f.id)
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      {floors.length === 0 ? (
        <button onClick={onAdd}
                className="px-2 py-1 rounded border bg-slate-50 hover:bg-slate-100 text-slate-600">
          + 啟用多樓層
        </button>
      ) : (
        <>
          <span className="text-slate-500 mr-1">樓層:</span>
          {floors.map(f => (
            <div key={f.id} className="flex items-center">
              <button onClick={() => switchFloor(f.id)}
                      onDoubleClick={() => onRename(f)}
                      title={`點選切換,雙擊改名`}
                      className={`px-3 py-1 rounded-l border ${
                        currentFloorId === f.id
                          ? 'bg-brand-700 text-white border-brand-700'
                          : 'bg-white hover:bg-slate-50 border-slate-200'
                      }`}>
                {f.name}
              </button>
              {currentFloorId === f.id && floors.length > 1 && (
                <button onClick={() => onRemove(f)}
                        title="刪除這個樓層"
                        className="px-1.5 py-1 rounded-r border-y border-r border-brand-700 bg-brand-700 text-white hover:bg-red-600 hover:border-red-600">
                  ✕
                </button>
              )}
            </div>
          ))}
          <button onClick={onAdd}
                  className="ml-2 px-2 py-1 rounded border bg-slate-50 hover:bg-slate-100 text-slate-700">
            + 樓層
          </button>
        </>
      )}
    </div>
  )
}
