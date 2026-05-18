import { useMemo } from 'react'
import { usePlanStore } from '../store/planStore.js'
import {
  furnitureCatalog, materialEstimates,
  spaceVertices, polygonArea
} from '../lib/constraints.js'

/**
 * 採購清單 + 預算 — 三聯動的「錢」那一塊
 * 自動從 plan 算出:
 *   1) 家具明細 (從 plan.furniture)
 *   2) 建材預算 (按 spaces type × 坪數 × 每坪預估)
 *   3) 總計
 */
export default function BomPanel() {
  const plan = usePlanStore(s => s.plan)
  const meta = usePlanStore(s => s.meta)

  const { furnitureRows, materialRows, totals } = useMemo(() => {
    // ---- 家具 ----
    const counts = {}
    for (const f of (plan.furniture || [])) {
      counts[f.modelKey] = (counts[f.modelKey] || 0) + 1
    }
    const furnitureRows = Object.entries(counts).map(([key, qty]) => {
      const item = furnitureCatalog.find(c => c.key === key)
      const name = item?.name || key
      const price = item?.price || 0
      const brand = item?.brand || '-'
      const category = item?.category || '-'
      return {
        key, name, brand, category, qty,
        unitPrice: price,
        subtotal: price * qty
      }
    }).sort((a, b) => b.subtotal - a.subtotal)

    // ---- 建材 (按空間 type × 坪數) ----
    const materialRows = []
    for (const sp of (plan.spaces || [])) {
      const areaCm2 = polygonArea(spaceVertices(sp))
      const ping = areaCm2 / 33057.85
      const est = materialEstimates[sp.type] || materialEstimates.custom
      materialRows.push({
        spaceId: sp.id, spaceName: sp.name, type: sp.type, ping: Number(ping.toFixed(2)),
        floor:     Math.round(est.floor * ping),
        ceiling:   Math.round(est.ceiling * ping),
        partition: Math.round(est.partition * ping),
        subtotal:  Math.round((est.floor + est.ceiling + est.partition) * ping)
      })
    }

    const furnitureTotal = furnitureRows.reduce((s, r) => s + r.subtotal, 0)
    const materialTotal  = materialRows.reduce((s, r) => s + r.subtotal, 0)
    return {
      furnitureRows, materialRows,
      totals: {
        furniture: furnitureTotal,
        material: materialTotal,
        grand: furnitureTotal + materialTotal
      }
    }
  }, [plan])

  function exportCsv() {
    const rows = [
      ['類別', '項目', '品牌/型號', '分類', '數量', '單價', '小計']
    ]
    for (const r of furnitureRows) {
      rows.push(['家具', r.name, r.brand, r.category, r.qty, r.unitPrice, r.subtotal])
    }
    for (const r of materialRows) {
      rows.push(['建材', r.spaceName, materialEstimates[r.type]?.label || '-', '-', r.ping + '坪', '-', r.subtotal])
    }
    rows.push(['', '', '', '', '', '家具合計', totals.furniture])
    rows.push(['', '', '', '', '', '建材合計', totals.material])
    rows.push(['', '', '', '', '', '總計', totals.grand])
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${meta?.title || 'plan'}-採購清單.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const showFurniture = furnitureRows.length > 0
  const showMaterial = materialRows.length > 0

  if (!showFurniture && !showMaterial) {
    return (
      <div className="p-4 text-xs text-slate-500 space-y-2">
        <div className="font-semibold text-sm">📋 採購清單 + 預算</div>
        <p>目前還沒有空間或家具,先在編輯器加空間或請 AI 規劃,這裡會自動算出清單與預算。</p>
      </div>
    )
  }

  return (
    <div className="p-3 text-xs space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">📋 採購清單 + 預算</div>
        <button onClick={exportCsv}
                className="px-2 py-1 rounded bg-slate-700 text-white hover:bg-slate-600 text-[10px]">
          ⬇ CSV
        </button>
      </div>

      {/* 總計 */}
      <div className="bg-slate-50 border rounded p-3 space-y-1">
        <Row label="家具合計"   value={fmtMoney(totals.furniture)} />
        <Row label="建材合計"   value={fmtMoney(totals.material)} />
        <div className="border-t pt-1 mt-1">
          <Row label="總預算"   value={fmtMoney(totals.grand)} bold />
        </div>
      </div>

      {/* 家具明細 */}
      {showFurniture && (
        <div>
          <div className="font-semibold mb-1">🪑 家具明細 ({furnitureRows.length} 項)</div>
          <table className="w-full text-[10px]">
            <thead className="bg-slate-100">
              <tr className="text-left">
                <th className="p-1">品項</th>
                <th className="p-1">品牌</th>
                <th className="p-1 text-right">數量</th>
                <th className="p-1 text-right">單價</th>
                <th className="p-1 text-right">小計</th>
              </tr>
            </thead>
            <tbody>
              {furnitureRows.map(r => (
                <tr key={r.key} className="border-b">
                  <td className="p-1">{r.name}</td>
                  <td className="p-1 text-slate-500">{r.brand}</td>
                  <td className="p-1 text-right">{r.qty}</td>
                  <td className="p-1 text-right">{fmtMoney(r.unitPrice)}</td>
                  <td className="p-1 text-right font-medium">{fmtMoney(r.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 建材明細 */}
      {showMaterial && (
        <div>
          <div className="font-semibold mb-1">🧱 建材預估 ({materialRows.length} 區)</div>
          <table className="w-full text-[10px]">
            <thead className="bg-slate-100">
              <tr className="text-left">
                <th className="p-1">空間</th>
                <th className="p-1 text-right">坪數</th>
                <th className="p-1 text-right">地板</th>
                <th className="p-1 text-right">天花</th>
                <th className="p-1 text-right">隔間</th>
                <th className="p-1 text-right">小計</th>
              </tr>
            </thead>
            <tbody>
              {materialRows.map(r => (
                <tr key={r.spaceId} className="border-b">
                  <td className="p-1">{r.spaceName}</td>
                  <td className="p-1 text-right">{r.ping}</td>
                  <td className="p-1 text-right">{fmtMoney(r.floor)}</td>
                  <td className="p-1 text-right">{fmtMoney(r.ceiling)}</td>
                  <td className="p-1 text-right">{fmtMoney(r.partition)}</td>
                  <td className="p-1 text-right font-medium">{fmtMoney(r.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-400 mt-1">
            * 預估值為粗估,實際依現場狀況與材料等級調整 (高端飯店建議 ×1.5,基本商辦 ×0.8)
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-base' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span>{value}</span>
    </div>
  )
}
function fmtMoney(n) {
  return 'NT$ ' + Math.round(n).toLocaleString()
}
