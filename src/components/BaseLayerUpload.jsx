import { useRef, useState } from 'react'
import { usePlanStore } from '../store/planStore.js'
import { uploadBaseLayer, deleteBaseLayer } from '../lib/fileUpload.js'
import { convertDwgToDxf, cloudConvertReady } from '../lib/dwgConvert.js'

/**
 * 底圖上傳按鈕 — 放在 Editor 工具列。
 * 支援: DXF / PDF / JPG / PNG / WEBP / GIF / BMP
 * (DWG 目前先拒收,提示使用者匯出 DXF;之後 v4.x 接後端轉檔服務再支援)
 */
const ACCEPT = '.dxf,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.dwg'

export default function BaseLayerUpload() {
  const planId = usePlanStore(s => s.planId)
  const baseLayer = usePlanStore(s => s.plan.baseLayer)
  const setBaseLayer = usePlanStore(s => s.setBaseLayer)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [busyStage, setBusyStage] = useState('')

  async function onPick(e) {
    let file = e.target.files?.[0]
    if (!file) return
    setErr('')

    const ext = file.name.split('.').pop().toLowerCase()

    // DWG 自動轉 DXF
    if (ext === 'dwg') {
      if (!cloudConvertReady) {
        setErr('DWG 自動轉檔未啟用 — 請到 cloudconvert.com 申請 API Key,填入 .env.local 的 VITE_CLOUDCONVERT_API_KEY。或請對方匯出 .dxf 再上傳。')
        e.target.value = ''
        return
      }
      setBusy(true)
      try {
        file = await convertDwgToDxf(file, {
          onProgress: (stage, msg) => setBusyStage(msg)
        })
      } catch (ex) {
        setErr('DWG 轉檔失敗: ' + ex.message)
        e.target.value = ''
        setBusy(false); setBusyStage('')
        return
      }
    }

    setBusy(true)
    setBusyStage('上傳中…')
    try {
      // 換新檔案前先刪掉舊的(節省 storage)
      if (baseLayer) await deleteBaseLayer(baseLayer)
      const layer = await uploadBaseLayer(file, planId)
      setBaseLayer(layer)
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
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
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
