import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { newSpaceId, newDoorId, newWindowId } from '../lib/constraints.js'
import { buildDxfPdfSpacesFromBaseLayer, openingsToPlanDoorsWindows } from '../lib/dxfPdfDeterministicImport.js'

export default function DxfPdfFrameButton() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const [err, setErr] = useState('')
  const baseLayer = plan.baseLayer

  if (baseLayer?.importMode !== 'dxf-pdf') return null

  function applyFrames() {
    setErr('')
    const result = buildDxfPdfSpacesFromBaseLayer(baseLayer, plan.bounds)
    if (!result.spaces.length) {
      setErr('目前沒有可直接套用的 DXF/PDF 高信心房間框')
      return
    }
    console.info('[DXF+PDF deterministic import]', result.meta)
    const spaces = result.spaces.map(space => ({ id: newSpaceId(), ...space }))
    // 門窗 (spaceIndex/edgeIndex 參照) → 指派 id + 組 wallId,與 AI 小房間共用同一函式
    const { doors, windows } = openingsToPlanDoorsWindows(
      { doors: result.doors, windows: result.windows }, spaces, { door: newDoorId, window: newWindowId }
    )
    const latestPlan = usePlanStore.getState().plan
    setPlan({
      ...latestPlan,
      spaces,
      rooms: [],
      walls: [],
      doors,
      windows,
      importPreview: {
        source: result.source,
        meta: result.meta,
        appliedAt: Date.now(),
      },
    })
    alert(`已用 DXF+PDF 直接建立 ${spaces.length} 個房間框 / ${doors.length} 門 / ${windows.length} 窗；小房間用「🏠 AI 補小房間」補。`)
  }

  const matched = baseLayer.pdfImport?.preview?.meta?.matchedRoomCount ?? 0

  return (
    <>
      <button
        type="button"
        onClick={applyFrames}
        className="px-3 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500"
        title="不呼叫 Gemini；只用 PDF 文字 + DXF 對位房間框建立 spaces"
      >
        DXF+PDF 直接框房間{matched ? ` (${matched})` : ''}
      </button>
      {err && <span className="text-red-600 text-[10px]">{err}</span>}
    </>
  )
}
