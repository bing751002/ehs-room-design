import { useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { recognizePlanFromImage } from '../lib/aiVision.js'
import { newWallId, newDoorId, newWindowId, newSpaceId } from '../lib/constraints.js'

/**
 * 「🤖 AI 識別圖紙」按鈕 — 出現在底圖控制條旁。
 * 看上傳的底圖,自動辨識牆/門/窗/空間/柱位並寫入 plan。
 */
export default function AiRecognizeButton() {
  const plan = usePlanStore(s => s.plan)
  const setPlan = usePlanStore(s => s.setPlan)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const bl = plan.baseLayer
  if (!bl) return null  // 沒底圖不顯示

  const imgUrl = bl.type === 'pdf' ? bl.previewUrl : (bl.type === 'image' ? bl.publicUrl : null)
  const supported = Boolean(imgUrl)

  async function onRun() {
    if (!supported) { setErr('此底圖格式不支援'); return }
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
      'AI 會看底圖自動辨識牆/門/窗/空間,然後覆蓋目前畫布上所有牆/門/窗/空間。',
      '',
      '⚠ AI 識別精度不一定 100% 準,出來的結果通常需要手動微調。',
      '建議用法:當作起點,再用滑鼠拖空間/頂點調整。',
      '',
      '繼續?'
    ].join('\n')
    if (!confirm(msg)) return
    setBusy(true); setErr('')
    try {
      const result = await recognizePlanFromImage({
        imageUrl: imgUrl,
        bounds: plan.bounds,
        baseLayer: bl,
        svgBounds: { w: plan.bounds.w, h: plan.bounds.h }
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
      const structuralColumns = result.structuralColumns || plan.structuralColumns

      setPlan({
        ...plan, walls, doors, windows, spaces, structuralColumns,
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
      setBusy(false)
    }
  }

  function clearAll() {
    if (!confirm('清空所有牆/門/窗/空間/結構柱?(底圖與家具保留)')) return
    setPlan({ ...plan, walls: [], doors: [], windows: [], spaces: [], rooms: [], structuralColumns: [] })
  }

  const hasContent = (plan.walls?.length || plan.spaces?.length || plan.doors?.length || plan.windows?.length) > 0

  return (
    <>
      <button onClick={onRun} disabled={busy || !supported}
              className="px-3 py-1 rounded bg-brand-700 text-white text-xs hover:bg-brand-500 disabled:opacity-50">
        {busy ? '辨識中…(30-60秒)' : '🤖 AI 識別圖紙'}
      </button>
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
