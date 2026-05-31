import { useRef, useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { uploadBaseLayer, uploadDxfPdfBaseLayer, deleteBaseLayer } from '../lib/fileUpload.js'
import { openingsToPlanOpenings, roomsToPlanSpaces } from '../lib/dxfSpaceExtract.js'
import { newDoorId, newSpaceId, newWindowId } from '../lib/constraints.js'
// DWG → DXF 路徑:CloudConvert 轉 DXF (只含 model space,沒 paper space 紙張範圍 + viewport 框)。
// 適合「工作圖」這種有 paper space layout 的 DWG。
// 缺點:hybrid 模式 AI 識別座標精度有限,但內容對。
// 若想要 PDF 視覺品質,請對方在 AutoCAD/DWG TrueView 印 model space PDF 後直接上傳。
import { convertDwgToDxf, cloudConvertReady } from '../lib/dwgConvert.js'

/**
 * 底圖上傳按鈕 — 放在 Editor 工具列。
 * 支援: DWG / DXF / PDF / JPG / PNG / WEBP / GIF / BMP
 *
 * DWG: CloudConvert 自動轉 PDF (保留家具/文字/標註),走 PDF 解析路徑
 * DXF: 直接解析向量 + 走 hybrid (dxfLines + dxfHint),AI 識別效果最好
 * PDF: pdf.js 渲染每頁成 PNG
 * 圖片: 直接當 raster 底圖
 */
const ACCEPT = '.dxf,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.dwg'

export default function BaseLayerUpload() {
  const planId = usePlanStore(s => s.planId)
  const baseLayer = usePlanStore(s => s.plan.baseLayer)
  const setBaseLayer = usePlanStore(s => s.setBaseLayer)
  const setPlan = usePlanStore(s => s.setPlan)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [busyStage, setBusyStage] = useState('')

  async function onPick(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    let file = files[0]
    setErr('')

    const dxfFile = files.find(f => f.name.toLowerCase().endsWith('.dxf'))
    const pdfFile = files.find(f => f.name.toLowerCase().endsWith('.pdf'))
    const isDxfPdfPair = !!(dxfFile && pdfFile)
    const ext = file.name.split('.').pop().toLowerCase()

    // DWG → PDF 單路徑:CloudConvert 直接轉 PDF
    // 若 cadconverter (預設) OPEN_FAILED (常見於 AutoCAD 2024+ 新版 DWG),
    // 自動 fallback 試其他 engine
    if (!isDxfPdfPair && ext === 'dwg') {
      if (!cloudConvertReady) {
        setErr('DWG 自動轉檔未啟用 — 請到 cloudconvert.com 申請 API Key,填入 .env.local 的 VITE_CLOUDCONVERT_API_KEY。或請對方匯出 .dxf / .pdf 再上傳。')
        e.target.value = ''
        return
      }
      setBusy(true)
      // null = CloudConvert 預設 engine (cadconverter / ODA),已實證可開 AC1018(2004)~較新格式。
      // 不要傳 'inventor'/'autodwg' — 那不是 dwg→dxf 的有效 engine,會回 422 Invalid engine 污染重試。
      const enginesToTry = [null]
      const originalDwg = file
      let convertedFile = null
      let lastError = null
      for (const engine of enginesToTry) {
        try {
          convertedFile = await convertDwgToDxf(originalDwg, {
            onProgress: (stage, msg) => setBusyStage(`[engine: ${engine || 'cadconverter'}] ${msg}`)
          }, engine)
          break  // 成功
        } catch (ex) {
          lastError = ex
          const isOpenFailed = /OPEN_FAILED|開不了/.test(ex.message || '')
          const isBuildFailed = /job 建立失敗/.test(ex.message || '')
          if (isOpenFailed || isBuildFailed) {
            console.warn(`[DWG] engine "${engine || 'cadconverter'}" 失敗,試下一個:`, ex.message?.slice(0, 100))
            continue
          }
          break  // 其他類型錯誤不 retry
        }
      }
      if (!convertedFile) {
        setErr('所有 CloudConvert engine 都無法開這份 DWG\n\n' + (lastError?.message || ''))
        e.target.value = ''
        setBusy(false); setBusyStage('')
        return
      }
      file = convertedFile
    }

    setBusy(true)
    setBusyStage('上傳中…')
    try {
      // 換新檔案前先刪掉舊的(節省 storage)
      if (baseLayer) await deleteBaseLayer(baseLayer)
      const layer = isDxfPdfPair
        ? await uploadDxfPdfBaseLayer(dxfFile, pdfFile, planId)
        : await uploadBaseLayer(file, planId)

      // 自動設定 placement: 居中填滿可用區的 90% (與 SVG viewBox 同座標系,單位 cm)
      const plan = usePlanStore.getState().plan
      const bounds = plan.bounds || { w: 4000, h: 3000 }
      const W = layer.width || 1000, H = layer.height || 1000
      const fit = Math.min((bounds.w * 0.9) / W, (bounds.h * 0.9) / H)
      const drawW = W * fit, drawH = H * fit
      layer.placement = {
        offsetX: (bounds.w - drawW) / 2,
        offsetY: (bounds.h - drawH) / 2,
        drawW, drawH,
        rotation: 0,
        opacity: 0.85
      }
      // DXF/DWG 直接抽取的房間 → 套用成可編輯 spaces (零 vision,mm 精度)
      const rooms = layer.spaceObjects?.rooms?.filter(r => r.vertices) || []
      if (rooms.length && layer.importMode !== 'dxf-pdf') {
        const spaces = roomsToPlanSpaces(rooms, layer).map(s => ({ id: newSpaceId(), ...s }))
        const openings = openingsToPlanOpenings(layer.openingObjects, spaces, layer)
        const doors = openings.doors.map(d => ({ id: newDoorId(), ...d }))
        const windows = openings.windows.map(w => ({ id: newWindowId(), ...w }))
        setPlan({ ...plan, baseLayer: layer, spaces, doors, windows, rooms: [] })
        const m = layer.spaceObjects.meta
        alert(
          `✅ 從 DXF 直接抽出 ${spaces.length} 個房間 (零 vision)\n` +
          `房名+坪數 ${m.roomNamesFound} 個 / 配到框 ${m.roomsMatched} 個\n\n` +
          `⚠ 目前用坪數+位置配對,框可能重疊或配錯,需人工校正。`
        )
      } else if (isDxfPdfPair) {
        setPlan({
          ...plan,
          baseLayer: layer,
          spaces: [],
          rooms: [],
          walls: [],
          doors: [],
          windows: [],
        })
      } else {
        setBaseLayer(layer)
      }
    } catch (ex) {
      console.error(ex)
      setErr(ex.message || '上傳失敗')
    } finally {
      setBusy(false)
      setBusyStage('')
      e.target.value = ''  // reset 讓相同檔名可重傳
    }
  }

  async function onRemove() {
    if (!baseLayer) return
    if (!confirm(`移除底圖「${baseLayer.filename}」?`)) return
    setBusy(true)
    try {
      await deleteBaseLayer(baseLayer)
      setBaseLayer(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={onPick} />
      {baseLayer ? (
        <>
          <span className="text-slate-600 max-w-[180px] truncate" title={baseLayer.filename}>
            📐 {baseLayer.filename}
          </span>
          <button onClick={() => inputRef.current?.click()} disabled={busy}
                  className="px-2 py-1 rounded border hover:bg-slate-50 disabled:opacity-50">
            換底圖
          </button>
          <button onClick={onRemove} disabled={busy}
                  className="px-2 py-1 rounded text-red-600 hover:bg-red-50 disabled:opacity-50">
            移除
          </button>
        </>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={busy}
                className="px-3 py-1 rounded bg-brand-700 text-white hover:bg-brand-500 disabled:opacity-50">
          {busy ? (busyStage || '上傳中…') : '＋ 上傳底圖 (DWG/DXF/PDF/圖片)'}
        </button>
      )}
      {err && <span className="text-red-600 text-xs">{err}</span>}
    </div>
  )
}
