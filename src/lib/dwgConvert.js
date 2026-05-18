/**
 * DWG → DXF 轉檔 (透過 CloudConvert API)
 *
 * 流程:
 *   1) 建立 task: 「import → convert dwg→dxf → export」三步合一 (jobs API)
 *   2) 上傳 DWG 檔
 *   3) Poll 直到完成
 *   4) 下載產生的 DXF
 */
const API_KEY = import.meta.env.VITE_CLOUDCONVERT_API_KEY
export const cloudConvertReady = Boolean(API_KEY)

const API_BASE = 'https://api.cloudconvert.com/v2'

/**
 * @param {File} dwgFile - DWG 檔
 * @param {Object} cb - { onProgress(stage, msg) }
 * @returns {Promise<File>} 轉好的 DXF File 物件
 */
export async function convertDwgToDxf(dwgFile, cb = {}) {
  if (!API_KEY) throw new Error('CloudConvert API Key 未設定。請到 https://cloudconvert.com 申請後填入 .env.local')

  function report(stage, msg) { cb.onProgress?.(stage, msg) }

  // 1) 建立 job
  report('job', '建立轉檔工作…')
  const jobRes = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: {
        'import-dwg': {
          operation: 'import/upload'
        },
        'convert': {
          operation: 'convert',
          input: 'import-dwg',
          input_format: 'dwg',
          output_format: 'dxf'
        },
        'export-dxf': {
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
  report('convert', '轉檔中…(30-120 秒)')
  let exportTask = null
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const stRes = await fetch(`${API_BASE}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    })
    if (!stRes.ok) continue
    const st = await stRes.json()
    const status = st.data.status
    if (status === 'error') throw new Error('CloudConvert 轉檔失敗: ' + JSON.stringify(st.data.tasks))
    if (status === 'finished') {
      exportTask = st.data.tasks.find(t => t.name === 'export-dxf')
      break
    }
  }
  if (!exportTask) throw new Error('CloudConvert 轉檔逾時 (>5 分鐘)')

  // 4) 下載轉好的 DXF
  const dxfUrl = exportTask.result.files[0].url
  const dxfName = exportTask.result.files[0].filename
  report('download', '下載 DXF…')
  const dxfRes = await fetch(dxfUrl)
  if (!dxfRes.ok) throw new Error('DXF 下載失敗: ' + dxfRes.status)
  const blob = await dxfRes.blob()
  return new File([blob], dxfName || dwgFile.name.replace(/\.dwg$/i, '.dxf'), { type: 'application/dxf' })
}
