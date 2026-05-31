import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { recognizePlanTiled } from '../lib/aiVisionTiled.js'
import { renderDxfToBlobUrl, summarizeDxf } from '../lib/dxfRender.js'
import { getAiRecognitionImageSource, hasPdfImportImage } from '../lib/dxfPdfBaseLayer.js'
import { buildGeminiDxfPdfHint } from '../lib/geminiDxfPdfHint.js'
import { newSpaceId, newDoorId, newWindowId } from '../lib/constraints.js'
import { attachOpeningsToSpaces, openingsToPlanDoorsWindows } from '../lib/dxfPdfDeterministicImport.js'

/**
 * 「🏠 AI 補小房間」按鈕 — 出現在底圖控制條旁。
 * 大房間 / 牆 / 門 / 窗由 DXF 幾何框 (準);小房間 DXF 框不準,改用切塊 AI 重框,
 * 非破壞地合併回畫布 (只換掉同位置的舊小框,大房間與牆門窗保留不動)。
 */
export default function AiRecognizeButton() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('')
  const [err, setErr] = useState('')

  const bl = plan.baseLayer
  if (!bl) return null  // 沒底圖不顯示

  const canTile = bl.type === 'pdf' || bl.type === 'image' || hasPdfImportImage(bl)

  // 解析底圖來源 (PDF clean image / DXF runtime 渲染)。
  async function resolveImageSource() {
    if (bl.type === 'dxf') {
      const sourceLines = bl.previewLines
      const dxfLines = sourceLines?.length ? sourceLines : bl.dxfLines
      const summary = summarizeDxf(dxfLines, bl.bbox, [])
      const structuredHint = buildGeminiDxfPdfHint(bl)
      const dxfHint = structuredHint ? `${summary.hint}\n\n${structuredHint}` : summary.hint
      const pdfImage = getAiRecognitionImageSource(bl)
      if (pdfImage?.imageUrl) return { imageUrl: pdfImage.imageUrl, blobUrlToRevoke: null, dxfHint }
      const { url } = await renderDxfToBlobUrl(dxfLines, bl.bbox, { texts: [] })
      return { imageUrl: url, blobUrlToRevoke: url, dxfHint }
    }
    return { imageUrl: bl.type === 'pdf' ? bl.previewUrl : bl.publicUrl, blobUrlToRevoke: null, dxfHint: null }
  }

  // 只用切塊 AI 重框 ≤ SMALL_MAX 坪的小房間,合併回畫布 (非破壞)。
  const SMALL_MAX = 6
  async function onRunSmall() {
    if (!canTile) { setErr('小房間 AI 補框只支援 PDF / 圖片底圖'); return }
    if (!confirm([
      `AI 只重新框「小房間 (≤${SMALL_MAX} 坪)」,大房間與牆/門/窗保留不動。`,
      '用切塊精細模式,約 2-3 分鐘。',
      '',
      '會取代畫布上現有的小房間色塊。繼續?'
    ].join('\n'))) return
    setBusy(true); setErr('')
    let blobUrlToRevoke = null
    try {
      const src = await resolveImageSource()
      blobUrlToRevoke = src.blobUrlToRevoke
      const result = await recognizePlanTiled({
        imageUrl: src.imageUrl,
        baseLayer: bl,
        svgBounds: { w: plan.bounds.w, h: plan.bounds.h },
        dxfHint: src.dxfHint,
        keepSpace: p => p !== null && p <= SMALL_MAX,  // 只留小房間
        onProgress: (m) => setBusyMsg(m)
      })
      const aiSmall = (result.spaces || []).map(s => ({
        id: newSpaceId(), height: 280, color: '#e2e8f0', wallKind: 'interior', wallThickness: 12, ...s
      }))
      if (aiSmall.length === 0) { setErr('AI 沒框到任何小房間'); return }
      const latest = usePlanStore.getState().plan
      // 用「空間重疊」判斷而非名字 (deterministic 房名可能不含坪數):
      // 既有框若覆蓋到某個 AI 小房間 footprint 的 35% 以上 → 視為同位置的舊小框,換掉;
      // 其餘 (大房間、不相干的) 全保留。
      const bbox = verts => {
        const xs = verts.map(v => v.x), ys = verts.map(v => v.y)
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      }
      const coverFrac = (a, small) => {
        const ix = Math.max(0, Math.min(a[2], small[2]) - Math.max(a[0], small[0]))
        const iy = Math.max(0, Math.min(a[3], small[3]) - Math.max(a[1], small[1]))
        const sa = (small[2] - small[0]) * (small[3] - small[1])
        return sa > 0 ? (ix * iy) / sa : 0
      }
      const aiBoxes = aiSmall.filter(s => s.vertices?.length >= 3).map(s => bbox(s.vertices))
      const kept = (latest.spaces || []).filter(s => {
        if (!s.vertices || s.vertices.length < 3) return true
        const sb = bbox(s.vertices)
        return !aiBoxes.some(ab => coverFrac(sb, ab) > 0.35)
      })
      // 把同一批 DXF 門窗也貼到 AI 小房間框的邊上 (DXF+PDF 底圖才有 openings;純圖無)。
      const openings = bl.pdfImport?.preview?.openings
      const crop = bl.pdfImport?.crop
      let smallDoors = [], smallWindows = []
      if (openings && crop) {
        const att = attachOpeningsToSpaces(openings, aiSmall, crop, bl.placement, plan.bounds)
        const o = openingsToPlanDoorsWindows(att, aiSmall, { door: newDoorId, window: newWindowId })
        smallDoors = o.doors; smallWindows = o.windows
      }
      // 保留貼在「存活空間」上的既有門窗 (大房間的),丟掉貼在被換掉小框上的
      const keptIds = kept.map(s => s.id)
      const onKept = wallId => !wallId || !wallId.startsWith('edge-') || keptIds.some(id => wallId.startsWith(`edge-${id}-`))
      const doors = [...(latest.doors || []).filter(d => onKept(d.wallId)), ...smallDoors]
      const windows = [...(latest.windows || []).filter(w => onKept(w.wallId)), ...smallWindows]
      setPlan({ ...latest, spaces: [...kept, ...aiSmall], doors, windows, rooms: [] })
      alert(`✅ AI 補小房間完成:新增 ${aiSmall.length} 間小房間 + ${smallDoors.length} 門 / ${smallWindows.length} 窗 (保留 ${kept.length} 間大房間)\n\n💡 點空間拖移、拖藍色頂點微調。`)
    } catch (e) {
      console.error(e)
      setErr(e.message || 'AI 補小房間失敗')
    } finally {
      if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke)
      setBusy(false); setBusyMsg('')
    }
  }

  function clearAll() {
    if (!confirm('清空所有牆/門/窗/空間/結構柱?(底圖與家具保留)')) return
    setPlan({ ...plan, walls: [], doors: [], windows: [], spaces: [], rooms: [], structuralColumns: [] })
  }

  const hasContent = (plan.walls?.length || plan.spaces?.length || plan.doors?.length || plan.windows?.length) > 0

  return (
    <>
      {canTile && (
        <button onClick={onRunSmall} disabled={busy || !canTile}
                title={`只用 AI 重框小房間 (≤${SMALL_MAX}坪),大房間與牆門窗保留不動。約 2-3 分鐘`}
                className="px-3 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500 disabled:opacity-50">
          {busy ? (busyMsg || '補小房間中…') : '🏠 AI 補小房間'}
        </button>
      )}
      {hasContent && (
        <button onClick={clearAll}
                className="px-2 py-1 rounded border text-[10px] text-red-600 hover:bg-red-50">
          🗑 清空牆/空間
        </button>
      )}
      {err && <span className="text-red-600 text-[10px] ml-2">{err}</span>}
    </>
  )
}
