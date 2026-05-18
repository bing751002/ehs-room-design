import { useMemo } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { scorePlan } from '../lib/constraints.js'

export default function ScorePanel() {
  const plan = usePlanStore(s => s.plan)
  const s = useMemo(() => scorePlan(plan), [plan])

  const Row = ({ label, v }) => (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold ${v >= 80 ? 'text-green-600' : v >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{v}</span>
    </div>
  )

  return (
    <div className="p-3 space-y-1.5">
      <div className="flex items-end gap-1 mb-2">
        <span className="text-2xl font-bold">{s.total}</span>
        <span className="text-xs text-slate-500 mb-1">/100 總分</span>
      </div>
      <Row label="動線" v={s.movement} />
      <Row label="密度" v={s.density} />
      <Row label="衝突" v={s.conflict} />
      <Row label="業態合規" v={s.compliance} />
      <Row label="結構避讓" v={s.structure} />
    </div>
  )
}
