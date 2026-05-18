import { useState, useMemo } from 'react'
import { roomTemplates, newId, newSpaceId } from '../lib/constraints.js'
import { usePlanStore } from '../store/planStore.js'

export default function RoomLibrary() {
  const addSpace = usePlanStore(s => s.addSpace)
  const plan = usePlanStore(s => s.plan)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('全部')

  const categories = useMemo(() => {
    const s = new Set(['全部'])
    for (const t of roomTemplates) s.add(t.category || '其他')
    return Array.from(s)
  }, [])

  const filtered = useMemo(() => {
    return roomTemplates.filter(t => {
      const okQ = !q || t.name.includes(q) || (t.category || '').includes(q)
      const okC = cat === '全部' || t.category === cat
      return okQ && okC
    })
  }, [q, cat])

  function place(t) {
    const baseX = (plan.availableZone?.x ?? 200) + 50
    const baseY = (plan.availableZone?.y ?? 200) + 50
    // 用 vertices 格式直接加入,後端會自動轉
    addSpace({
      name: t.name,
      type: t.type,
      color: t.color,
      height: 280,
      vertices: [
        { x: baseX,           y: baseY },
        { x: baseX + t.w,     y: baseY },
        { x: baseX + t.w,     y: baseY + t.h },
        { x: baseX,           y: baseY + t.h }
      ]
    })
  }

  return (
    <div className="space-y-1.5 p-2">
      <input value={q} onChange={e => setQ(e.target.value)}
             placeholder="搜尋房間…"
             className="w-full text-xs border rounded px-2 py-1 outline-brand-700" />
      <div className="flex gap-1 flex-wrap">
        {categories.map(c => (
          <button key={c} onClick={() => setCat(c)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    cat === c ? 'bg-brand-700 text-white border-brand-700' : 'bg-white hover:bg-slate-50'
                  }`}>
            {c}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-slate-500 px-1 pt-1">點擊加到畫布</div>
      <div className="space-y-0.5">
        {filtered.map(t => (
          <button key={t.key} onClick={() => place(t)}
                  className="w-full flex items-center gap-2 px-2 py-1 hover:bg-slate-100 rounded text-xs text-left">
            <span className="w-4 h-4 rounded shrink-0" style={{ background: t.color }} />
            <span className="flex-1 truncate">{t.name}</span>
            <span className="text-[9px] text-slate-400 shrink-0">{t.w}×{t.h}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-[10px] text-slate-400 text-center py-2">沒有符合的房型</p>
        )}
      </div>
    </div>
  )
}
