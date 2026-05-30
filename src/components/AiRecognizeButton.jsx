import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { recognizePlanFromImage } from '../lib/aiVisionGemini.js'
import { recognizePlanTiled } from '../lib/aiVisionTiled.js'
import { renderDxfToBlobUrl, summarizeDxf } from '../lib/dxfRender.js'
import { getAiRecognitionImageSource, hasPdfImportImage } from '../lib/dxfPdfBaseLayer.js'
import { buildGeminiDxfPdfHint } from '../lib/geminiDxfPdfHint.js'
import { newWallId, newDoorId, newWindowId, newSpaceId } from '../lib/constraints.js'

/**
 * 「🤖 AI 識別圖紙」按鈕 — 出現在底圖控制條旁。
 * 看上傳的底圖,自動辨識牆/門/窗/空間/柱位並寫入 plan。
 */
export default function AiRecognizeButton() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('')
  const [err, setErr] = useState('')

  const bl = plan.baseLayer
  if (!bl) return null  // 沒底圖不顯示

  // PDF/image 直接有 URL;DXF 兩條路:
  //   - 有 bl.previewUrl (DWG 雙路徑下來的 PDF preview) → 用它,vision LLM 看品質高的 PDF 渲染
  //   - 沒有 → runtime 渲染 DXF 成 PNG (純 .dxf 上傳路徑)
  const supported = bl.type === 'pdf' || bl.type === 'image' || (bl.type === 'dxf' && bl.dxfLines?.length > 0)

  async function onRun(useTiled = false) {
    if (!supported) { setErr('此底圖格式不支援'); return }
    if (useTiled && bl.type !== 'pdf' && bl.type !== 'image' && !hasPdfImportImage(bl)) {
      setErr('切塊識別只支援 PDF / 圖片底圖'); return
    }
    // 強制提示校準
    if (!bl.scaleCalibration) {
      const ok = confirm([
        '⚠ 你還沒校準比例尺',
        '',
        '沒校準的話,AI 識別出的座標可能整體偏移或縮放錯誤。',
        '建議先點上方「📐 校準比例尺」按鈕完成校準後再用 AI 識別。',
        '',
        '仍要直接跑 AI 識別?(會用預設 bounds 估算,可能不準)'
      ].join('\n'))
      if (!ok) return
    }
    const msg = [
      'AI 會看底圖辨識牆/門/窗/空間,並覆蓋目前畫布。',
      '',
      '⚠ 注意:',
      '• 結構柱識別常常不準,如果你已經有手動加柱建議按取消',
      '• 出來的結果通常需要手動微調',
      '• 建議當作「起點」,用滑鼠拖空間/頂點再調整',
      '',
      '繼續?'
    ].join('\n')
    if (!confirm(msg)) return
    // 詢問要不要保留現有柱子 (避免重覆/手動加好的被覆蓋)
    const keepColumns = (plan.structuralColumns?.length || 0) > 0
      && confirm(`畫布上已經有 ${plan.structuralColumns.length} 根柱子。\n\n[確定] 保留現有柱子,AI 不要動柱子\n[取消] 用 AI 辨識的柱子取代`)
    setBusy(true); setErr('')
    // PDF (含 DWG 來的) / image → 純 vision OCR,無 dxfHint
    // 純 .dxf 直接上傳 → 走 hybrid:runtime 渲染 + summarizeDxf 結構提示
    let imageUrl, blobUrlToRevoke = null, dxfHint = null
    if (bl.type === 'dxf') {
      try {
        const sourceLines = bl.previewLines
        const sourceBbox = bl.bbox
        const dxfLines = sourceLines?.length ? sourceLines : bl.dxfLines
        const summary = summarizeDxf(dxfLines, sourceBbox, [])
        const structuredHint = buildGeminiDxfPdfHint(bl)
        dxfHint = structuredHint ? `${summary.hint}\n\n${structuredHint}` : summary.hint
        const pdfImage = getAiRecognitionImageSource(bl)
        if (pdfImage?.imageUrl) {
          imageUrl = pdfImage.imageUrl
        } else {
          const { url } = await renderDxfToBlobUrl(dxfLines, bl.bbox, { texts: [] })
          imageUrl = url
          blobUrlToRevoke = url
        }
      } catch (e) {
        setBusy(false)
        setErr('DXF 渲染失敗: ' + (e.message || e))
        return
      }
    } else {
      imageUrl = bl.type === 'pdf' ? bl.previewUrl : bl.publicUrl
    }
    try {
      const result = useTiled
        ? await recognizePlanTiled({
            imageUrl,
            baseLayer: bl,
            svgBounds: { w: plan.bounds.w, h: plan.bounds.h },
            dxfHint,
            onProgress: (m) => setBusyMsg(m)
          })
        : await recognizePlanFromImage({
            imageUrl,
            bounds: plan.bounds,
            baseLayer: bl,
            svgBounds: { w: plan.bounds.w, h: plan.bounds.h },
            dxfHint
          })
      // 套用到 plan
      const walls = (result.walls || []).map(w => ({
        id: newWallId(), thickness: 12, kind: 'interior', ...w
      }))
      const wallByIdx = walls.map(w => w.id)
      const doors = (result.doors || []).map(d => ({
        id: newDoorId(), width: 90, swing: 'in-right', t: 0.5, ...d,
        wallId: d.wallId || wallByIdx[d.wallIndex ?? -1]
      })).filter(d => d.wallId)
      const windows = (result.windows || []).map(w => ({
        id: newWindowId(), width: 150, t: 0.5, sillHeight: 90, ...w,
        wallId: w.wallId || wallByIdx[w.wallIndex ?? -1]
      })).filter(w => w.wallId)
      const spaces = (result.spaces || []).map(s => ({
        id: newSpaceId(), height: 280, color: '#e2e8f0', wallKind: 'interior', wallThickness: 12, ...s
      }))
      // 柱子處理:保留現有柱子的選項 + 硬上限 25 根
      const COL_HARD_LIMIT = 25
      let structuralColumns
      if (keepColumns) {
        structuralColumns = plan.structuralColumns || []
      } else {
        structuralColumns = (result.structuralColumns || []).slice(0, COL_HARD_LIMIT)
      }

      const latestPlan = usePlanStore.getState().plan
      setPlan({
        ...latestPlan, walls, doors, windows, spaces, structuralColumns,
        rooms: []  // 清掉舊色塊
      })
      const conf = result.confidence ?? 0
      const lowConf = conf < 0.5
      const tooManyCol = (result.structuralColumns || []).length > 30
      let warning = ''
      if (lowConf) warning += `\n\n⚠ AI 信心度只有 ${Math.round(conf*100)}%,結果可能不準。`
      if (!result.is_floor_plan) warning += '\n\n⚠ AI 認為這不是標準平面圖,結果僅供參考。'
      if (result.image_quality === 'poor') warning += '\n\n⚠ 圖像品質不佳,結果可能差。'
      if (tooManyCol) warning += '\n\n⚠ 偵測到大量柱子,建議手動清掉多餘的。'

      const msg = `✅ 識別完成:${walls.length} 牆 / ${doors.length} 門 / ${windows.length} 窗 / ${spaces.length} 空間 / ${structuralColumns.length || 0} 柱`
      alert(msg + warning +
        (result.scale_note ? `\n\n比例尺說明:${result.scale_note}` : '') +
        '\n\n💡 點空間拖移,Shift+點多選,Cmd+C/V 複製貼上,選空間後拖橘色手柄縮放、拖藍色頂點改形狀。')
    } catch (e) {
      console.error(e)
      setErr(e.message || 'AI 辨識失敗')
    } finally {
      if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke)
      setBusy(false)
      setBusyMsg('')
    }
  }

  function clearAll() {
    if (!confirm('清空所有牆/門/窗/空間/結構柱?(底圖與家具保留)')) return
    setPlan({ ...plan, walls: [], doors: [], windows: [], spaces: [], rooms: [], structuralColumns: [] })
  }

  const hasContent = (plan.walls?.length || plan.spaces?.length || plan.doors?.length || plan.windows?.length) > 0

  const canTile = bl.type === 'pdf' || bl.type === 'image' || hasPdfImportImage(bl)

  return (
    <>
      <button onClick={() => onRun(false)} disabled={busy || !supported}
              className="px-3 py-1 rounded bg-brand-700 text-white text-xs hover:bg-brand-500 disabled:opacity-50">
        {busy ? (busyMsg || '辨識中…(30-60秒)') : '🤖 AI 識別圖紙'}
      </button>
      {canTile && (
        <button onClick={() => onRun(true)} disabled={busy || !supported}
                title="切成多塊分別識別,中央密集小房間更準,但慢 5 倍 (約 2-3 分鐘)"
                className="px-3 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-500 disabled:opacity-50">
          {busy ? (busyMsg || '切塊辨識中…') : '🔬 切塊精細識別'}
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
