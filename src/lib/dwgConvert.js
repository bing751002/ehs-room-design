/**
 * DWG 轉檔 (透過 CloudConvert API) — 支援兩個 target 格式
 *
 * 主路徑: convertDwgToDxf (向量結構化,給 fileUpload.js dxf 分支解析)
 *   - 優點: 精準座標、可抽 layer / TEXT / 家具圖塊,給 AI 識別當結構提示
 *   - 缺點: 需要完整 parser (CIRCLE/ARC/ELLIPSE/TEXT/INSERT 都要 cover)
 *
 * 備案: convertDwgToPdf (CloudConvert 直接渲染 PDF)
 *   - 優點: 視覺保真,所有 entity 都在
 *   - 缺點: 失去結構化資料,後續精準幾何運算做不了
 *
 * BaseLayerUpload 預設用 convertDwgToDxf。若 DXF 路徑解析品質不佳,
 * 把 import 換成 convertDwgToPdf 即可切換。
 */
const API_KEY = import.meta.env.VITE_CLOUDCONVERT_API_KEY
export const cloudConvertReady = Boolean(API_KEY)

const API_BASE = 'https://api.cloudconvert.com/v2'

/**
 * 通用 DWG 轉檔邏輯,只是 output 格式不同。
 * @param {File} dwgFile
 * @param {'dxf'|'pdf'} targetFormat
 * @param {Object} cb - { onProgress(stage, msg) }
 * @param {string|null} engine - CloudConvert engine 覆寫 (預設 null = cadconverter)。
 *   可試:'cadconverter' (預設,ODA-based) / 'inventor' / 'autodwg' / 'librecad'
 *   若 cadconverter OPEN_FAILED,可試其他 engine 看 ROI
 * @returns {Promise<File>}
 */
async function convertDwg(dwgFile, targetFormat, cb = {}, engine = null) {
  if (!API_KEY) throw new Error('CloudConvert API Key 未設定。請到 https://cloudconvert.com 申請後填入 .env.local')
  if (targetFormat !== 'dxf' && targetFormat !== 'pdf') {
    throw new Error('不支援的 target format: ' + targetFormat)
  }
  const exportTaskName = `export-${targetFormat}`
  const mimeType = targetFormat === 'dxf' ? 'application/dxf' : 'application/pdf'

  function report(stage, msg) { cb.onProgress?.(stage, msg) }

  const convertTask = {
    operation: 'convert',
    input: 'import-dwg',
    input_format: 'dwg',
    output_format: targetFormat,
    ...(engine ? { engine } : {})
  }

  // 1) 建立 job
  report('job', `建立轉檔工作 (engine: ${engine || 'default'})…`)
  const jobRes = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: {
        'import-dwg': {
          operation: 'import/upload'
        },
        'convert': convertTask,
        [exportTaskName]: {
          operation: 'export/url',
          input: 'convert'
        }
      }
    })
  })
  if (!jobRes.ok) throw new Error('CloudConvert job 建立失敗: ' + jobRes.status + ' ' + await jobRes.text())
  const job = await jobRes.json()
  const jobId = job.data.id

  // 2) 上傳 DWG
  const uploadTask = job.data.tasks.find(t => t.name === 'import-dwg')
  const uploadUrl = uploadTask.result.form.url
  const formParams = uploadTask.result.form.parameters
  const fd = new FormData()
  for (const [k, v] of Object.entries(formParams)) fd.append(k, v)
  fd.append('file', dwgFile)
  report('upload', '上傳 DWG…')
  const upRes = await fetch(uploadUrl, { method: 'POST', body: fd })
  if (!upRes.ok && upRes.status !== 201) throw new Error('DWG 上傳失敗: ' + upRes.status)

  // 3) Poll job 狀態
  report('convert', `轉檔中…(30-120 秒,目標 ${targetFormat.toUpperCase()})`)
  let exportTask = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const stRes = await fetch(`${API_BASE}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    })
    if (!stRes.ok) continue
    const st = await stRes.json()
    const status = st.data.status
    if (status === 'error') {
      // OPEN_FAILED 通常是 DWG 版本過新 (AutoCAD 2024+) 或非標準變體
      const failedTask = st.data.tasks.find(t => t.status === 'error' && t.code === 'OPEN_FAILED')
      if (failedTask) {
        throw new Error(
          'CloudConvert 開不了這份 DWG (可能是版本過新或非標準變體)。\n' +
          '解法:\n' +
          '  1. AutoCAD 另存新檔 → 選 "AutoCAD 2018 DWG" 格式 → 重傳\n' +
          '  2. 或 SAVEAS → 選 "AutoCAD 2018 DXF" → 直接上傳 .dxf'
        )
      }
      throw new Error('CloudConvert 轉檔失敗: ' + JSON.stringify(st.data.tasks))
    }
    if (status === 'finished') {
      exportTask = st.data.tasks.find(t => t.name === exportTaskName)
      break
    }
  }
  if (!exportTask) throw new Error('CloudConvert 轉檔逾時 (>5 分鐘)')

  // 4) 下載
  const fileUrl = exportTask.result.files[0].url
  const fileName = exportTask.result.files[0].filename
  report('download', `下載 ${targetFormat.toUpperCase()}…`)
  const fileRes = await fetch(fileUrl)
  if (!fileRes.ok) throw new Error(`${targetFormat.toUpperCase()} 下載失敗: ` + fileRes.status)
  const blob = await fileRes.blob()
  const replaceExt = new RegExp(`\\.dwg$`, 'i')
  return new File(
    [blob],
    fileName || dwgFile.name.replace(replaceExt, '.' + targetFormat),
    { type: mimeType }
  )
}

/**
 * DWG → DXF
 * @param {File} dwgFile
 * @param {Object} cb - { onProgress(stage, msg) }
 * @param {string|null} engine - CloudConvert engine 覆寫 (見 convertDwg 參數說明)
 * @returns {Promise<File>} DXF File 物件
 */
export function convertDwgToDxf(dwgFile, cb = {}, engine = null) {
  return convertDwg(dwgFile, 'dxf', cb, engine)
}

/**
 * DWG → PDF
 * @param {File} dwgFile
 * @param {Object} cb - { onProgress(stage, msg) }
 * @param {string|null} engine - CloudConvert engine 覆寫 (見 convertDwg 參數說明)
 * @returns {Promise<File>} PDF File 物件
 */
export function convertDwgToPdf(dwgFile, cb = {}, engine = null) {
  return convertDwg(dwgFile, 'pdf', cb, engine)
}

/**
 * DWG → DXF + PDF 雙輸出 (方案 B,給 AI 識別精度用)
 *
 * 為什麼:
 *   DXF 給 Canvas2D 顯示精準向量 + AI hybrid 的 dxfHint;
 *   PDF 同一張圖渲染品質高(有顏色 + 線粗 hierarchy),vision LLM 認牆比看 DXF 純黑線準。
 *
 * 一個 CloudConvert job 含兩個 convert task,共用同一個 import-upload,
 * 只上傳一次 DWG,並行轉換,credit 算兩次 convert 但 import 只算一次。
 *
 * @param {File} dwgFile
 * @param {Object} cb - { onProgress(stage, msg) }
 * @returns {Promise<{dxf: File, pdf: File}>}
 */
export async function convertDwgToBoth(dwgFile, cb = {}) {
  if (!API_KEY) throw new Error('CloudConvert API Key 未設定。請到 https://cloudconvert.com 申請後填入 .env.local')
  function report(stage, msg) { cb.onProgress?.(stage, msg) }

  // 1) 建立 job (一個 import + 兩個 convert + 兩個 export)
  report('job', '建立轉檔工作 (DXF + PDF)…')
  const jobRes = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: {
        'import-dwg': { operation: 'import/upload' },
        'convert-dxf': {
          operation: 'convert',
          input: 'import-dwg',
          input_format: 'dwg',
          output_format: 'dxf'
        },
        'convert-pdf': {
          operation: 'convert',
          input: 'import-dwg',
          input_format: 'dwg',
          output_format: 'pdf'
        },
        'export-dxf': { operation: 'export/url', input: 'convert-dxf' },
        'export-pdf': { operation: 'export/url', input: 'convert-pdf' }
      }
    })
  })
  if (!jobRes.ok) throw new Error('CloudConvert job 建立失敗: ' + jobRes.status + ' ' + await jobRes.text())
  const job = await jobRes.json()
  const jobId = job.data.id

  // 2) 上傳 DWG (只傳一次)
  const uploadTask = job.data.tasks.find(t => t.name === 'import-dwg')
  const fd = new FormData()
  for (const [k, v] of Object.entries(uploadTask.result.form.parameters)) fd.append(k, v)
  fd.append('file', dwgFile)
  report('upload', '上傳 DWG…')
  const upRes = await fetch(uploadTask.result.form.url, { method: 'POST', body: fd })
  if (!upRes.ok && upRes.status !== 201) throw new Error('DWG 上傳失敗: ' + upRes.status)

  // 3) Poll 雙輸出完成
  report('convert', '轉檔中 (DXF + PDF 並行,30-180 秒)…')
  let dxfExport = null
  let pdfExport = null
  for (let i = 0; i < 72; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const stRes = await fetch(`${API_BASE}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    })
    if (!stRes.ok) continue
    const st = await stRes.json()
    const status = st.data.status
    if (status === 'error') {
      // OPEN_FAILED 通常是 DWG 版本過新 (AutoCAD 2024+) 或非標準變體
      const failedTask = st.data.tasks.find(t => t.status === 'error' && t.code === 'OPEN_FAILED')
      if (failedTask) {
        throw new Error(
          'CloudConvert 開不了這份 DWG (可能是版本過新或非標準變體)。\n' +
          '解法:\n' +
          '  1. AutoCAD 另存新檔 → 選 "AutoCAD 2018 DWG" 格式 → 重傳\n' +
          '  2. 或 SAVEAS → 選 "AutoCAD 2018 DXF" → 直接上傳 .dxf'
        )
      }
      throw new Error('CloudConvert 轉檔失敗: ' + JSON.stringify(st.data.tasks))
    }
    if (status === 'finished') {
      dxfExport = st.data.tasks.find(t => t.name === 'export-dxf')
      pdfExport = st.data.tasks.find(t => t.name === 'export-pdf')
      break
    }
  }
  if (!dxfExport || !pdfExport) throw new Error('CloudConvert 雙輸出轉檔逾時 (>6 分鐘)')

  // 4) 並行下載兩個結果
  report('download', '下載 DXF + PDF…')
  const dxfUrl = dxfExport.result.files[0].url
  const pdfUrl = pdfExport.result.files[0].url
  const baseName = dwgFile.name.replace(/\.dwg$/i, '')

  const [dxfBlob, pdfBlob] = await Promise.all([
    fetch(dxfUrl).then(r => { if (!r.ok) throw new Error('DXF 下載失敗'); return r.blob() }),
    fetch(pdfUrl).then(r => { if (!r.ok) throw new Error('PDF 下載失敗'); return r.blob() })
  ])

  return {
    dxf: new File([dxfBlob], baseName + '.dxf', { type: 'application/dxf' }),
    pdf: new File([pdfBlob], baseName + '.pdf', { type: 'application/pdf' })
  }
}
