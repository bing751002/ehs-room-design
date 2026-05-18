import { useMemo } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { spaceVertices, polygonArea, allRenderableWalls, wallLength } from '../lib/constraints.js'

/**
 * 樓層屬性面板 — 顯示+調整整層的元資料、統計資訊。
 * 嵌入在右側面板的「樓層」tab。
 */
export default function FloorPropsPanel() {
  const plan = usePlanStore(s => s.plan)
  const setBounds = usePlanStore(s => s.setBounds)

  const stats = useMemo(() => {
    const usedCm2 = (plan.spaces || []).reduce((sum, sp) => sum + polygonArea(spaceVertices(sp)), 0)
    const totalCm2 = (plan.bounds?.w || 0) * (plan.bounds?.h || 0)
    const wallTotalLen = allRenderableWalls(plan).reduce((s, w) => s + wallLength(w), 0)
    return {
      spaces: (plan.spaces || []).length,
      walls: allRenderableWalls(plan).length,
      doors: (plan.doors || []).length,
      windows: (plan.windows || []).length,
      furniture: (plan.furniture || []).length,
      usedM2: (usedCm2 / 10000).toFixed(2),
      usedPing: (usedCm2 / 33057.85).toFixed(2),
      totalM2: (totalCm2 / 10000).toFixed(2),
      totalPing: (totalCm2 / 33057.85).toFixed(2),
      occupy: totalCm2 ? Math.round(usedCm2 / totalCm2 * 100) : 0,
      wallLenM: (wallTotalLen / 100).toFixed(2)
    }
  }, [plan])

  return (
    <div className="p-3 space-y-3 text-xs overflow-y-auto">
      <div>
        <h3 className="font-semibold mb-1">🏢 樓層屬性</h3>
        <p className="text-[10px] text-slate-500">當前樓層的基本資訊與統計</p>
      </div>

      {/* 基礎參數 */}
      <Section title="基礎參數">
        <Row label="樓層寬 (X)">
          <input type="number" value={plan.bounds?.w || 4000}
                 onChange={e => setBounds({ ...plan.bounds, w: Number(e.target.value) })}
                 className="w-20 border rounded px-1.5 py-0.5 text-right" /> cm
        </Row>
        <Row label="樓層深 (Y)">
          <input type="number" value={plan.bounds?.h || 3000}
                 onChange={e => setBounds({ ...plan.bounds, h: Number(e.target.value) })}
                 className="w-20 border rounded px-1.5 py-0.5 text-right" /> cm
        </Row>
        <Row label="總坪數">
          <strong>{stats.totalPing} 坪</strong>
          <span className="text-slate-400 ml-1">({stats.totalM2} m²)</span>
        </Row>
      </Section>

      {/* 規劃統計 */}
      <Section title="目前規劃">
        <Row label="使用坪數">
          <strong className="text-brand-700">{stats.usedPing} 坪</strong>
          <span className="text-slate-400 ml-1">({stats.usedM2} m²)</span>
        </Row>
        <Row label="使用率">
          <div className="flex items-center gap-1">
            <div className="w-16 h-1.5 bg-slate-200 rounded overflow-hidden">
              <div className="h-full bg-brand-700" style={{ width: `${stats.occupy}%` }} />
            </div>
            <span className="text-[10px]">{stats.occupy}%</span>
          </div>
        </Row>
      </Section>

      {/* 元件統計 */}
      <Section title="元件數">
        <Grid>
          <Stat icon="🏠" label="空間" value={stats.spaces} />
          <Stat icon="🧱" label="牆段" value={stats.walls} />
          <Stat icon="🚪" label="門" value={stats.doors} />
          <Stat icon="🪟" label="窗" value={stats.windows} />
          <Stat icon="🪑" label="家具" value={stats.furniture} />
          <Stat icon="📏" label="牆總長" value={`${stats.wallLenM}m`} />
        </Grid>
      </Section>

      {/* 底圖資訊 */}
      {plan.baseLayer && (
        <Section title="底圖">
          <Row label="檔案">
            <span className="truncate max-w-[140px]" title={plan.baseLayer.filename}>
              {plan.baseLayer.filename}
            </span>
          </Row>
          <Row label="比例尺">
            {plan.baseLayer.scaleCalibration
              ? <span className="text-green-700">✓ {plan.baseLayer.scaleCalibration.note}</span>
              : <span className="text-amber-600">⚠ 未校準</span>}
          </Row>
          {plan.baseLayer.pageCount > 1 && (
            <Row label="頁數">
              {plan.baseLayer.currentPage} / {plan.baseLayer.pageCount}
            </Row>
          )}
        </Section>
      )}

      {/* 多樓層資訊 */}
      {plan.floors?.length > 0 && (
        <Section title="樓層">
          <Row label="目前">
            {plan.floors.find(f => f.id === plan.currentFloorId)?.name || '-'}
          </Row>
          <Row label="總樓層">
            {plan.floors.length}
          </Row>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-1.5 pb-3 border-b last:border-b-0">
      <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{title}</h4>
      {children}
    </div>
  )
}
function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}
function Grid({ children }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>
}
function Stat({ icon, label, value }) {
  return (
    <div className="bg-slate-50 border rounded px-2 py-1">
      <div className="text-[9px] text-slate-500">{icon} {label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}
