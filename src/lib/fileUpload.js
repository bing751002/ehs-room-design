import { supabase } from './supabase.js'
import DxfParser from 'dxf-parser'
import * as pdfjsLib from 'pdfjs-dist'
// Vite 會把 worker 打包進 dist,不依賴 CDN
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const BUCKET = 'plan-assets'

/**
 * 上傳檔案到 Supabase Storage，並依副檔名解析內容。
 * 回傳 baseLayer 物件,呼叫方再寫入 planStore。
 *
 * 路徑規則:{user_id}/{plan_id}/{timestamp}_{filename}
 * 這樣 RLS 政策可用第一段資料夾名等於 auth.uid() 來保護。
 */
export async function uploadBaseLayer(file, planId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')

  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const storagePath = `${user.id}/${planId}/${ts}_${safeName}`

  // 1. 先上傳檔案
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false })
  if (upErr) throw upErr

  // 2. 拿 signed URL (1 年有效,因為是 private bucket)
  const { data: signed, error: urlErr } = await supabase.storage.from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
  if (urlErr) throw urlErr

  const ext = file.name.split('.').pop().toLowerCase()
  const base = {
    storagePath,
    publicUrl: signed.signedUrl,
    filename: file.name,
    size: file.size,
    uploadedAt: ts,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 }
  }

  // 3. 依檔型解析
  if (ext === 'dxf') {
    const text = await file.text()
    const parser = new DxfParser()
    const dxf = parser.parseSync(text)
    const lines = extractDxfLines(dxf)
    const bbox = computeBbox(lines)
    return {
      ...base, type: 'dxf',
      dxfLines: lines,
      width: bbox.width, height: bbox.height,
      bbox
    }
  }

  if (ext === 'pdf') {
    const arrayBuf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise
    // 把每一頁都渲染成 PNG 上傳 (多頁 PDF 切換用)
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const vp = page.getViewport({ scale: 1.5 })  // 1.5x 提高底圖清晰度
      const canvas = document.createElement('canvas')
      canvas.width = vp.width; canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      const pngBlob = await new Promise(r => canvas.toBlob(r, 'image/png'))
      const pngPath = storagePath.replace(/\.pdf$/i, `.page${i}.png`)
      const { error: pngErr } = await supabase.storage.from(BUCKET)
        .upload(pngPath, pngBlob, { cacheControl: '3600', upsert: true, contentType: 'image/png' })
      if (pngErr) throw pngErr
      const { data: pngSigned } = await supabase.storage.from(BUCKET)
        .createSignedUrl(pngPath, 60 * 60 * 24 * 365)
      pages.push({
        page: i,
        previewUrl: pngSigned.signedUrl,
        previewStoragePath: pngPath,
        width: vp.width,
        height: vp.height
      })
    }
    return {
      ...base, type: 'pdf',
      pages,
      currentPage: 1,
      // 為了相容舊欄位,把第一頁資訊放外層
      previewUrl: pages[0].previewUrl,
      previewStoragePath: pages[0].previewStoragePath,
      width: pages[0].width, height: pages[0].height,
      pageCount: pdf.numPages
    }
  }

  // 圖片類 (jpg/jpeg/png/webp/gif/施工圖檔常見)
  if (['jpg','jpeg','png','webp','gif','bmp'].includes(ext)) {
    const dim = await readImageSize(file)
    return { ...base, type: 'image', width: dim.width, height: dim.height }
  }

  // 其他 (例如 dwg) — 暫時當作不可直接渲染,只記錄 metadata
  return { ...base, type: 'other', extension: ext }
}

/** 刪除底圖 (從 storage 也刪掉) */
export async function deleteBaseLayer(baseLayer) {
  if (!baseLayer) return
  const paths = [baseLayer.storagePath]
  if (baseLayer.previewStoragePath) paths.push(baseLayer.previewStoragePath)
  // 多頁 PDF: 把所有 page PNG 也刪
  if (baseLayer.pages?.length) {
    for (const p of baseLayer.pages) {
      if (p.previewStoragePath && p.previewStoragePath !== baseLayer.previewStoragePath) {
        paths.push(p.previewStoragePath)
      }
    }
  }
  await supabase.storage.from(BUCKET).remove(paths)
}

// ---- DXF 工具 ----
function extractDxfLines(dxf) {
  // dxf-parser 給的 entities: LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC
  // MVP 只抓 LINE 與 LWPOLYLINE,足以呈現大多數樓層平面
  const out = []
  if (!dxf?.entities) return out
  for (const e of dxf.entities) {
    if (e.type === 'LINE' && e.vertices?.length >= 2) {
      const [a, b] = e.vertices
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer: e.layer })
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length >= 2) {
      const vs = e.vertices
      for (let i = 0; i < vs.length - 1; i++) {
        out.push({ x1: vs[i].x, y1: vs[i].y, x2: vs[i+1].x, y2: vs[i+1].y, layer: e.layer })
      }
      if (e.shape && vs.length >= 3) {
        out.push({ x1: vs[vs.length-1].x, y1: vs[vs.length-1].y, x2: vs[0].x, y2: vs[0].y, layer: e.layer })
      }
    }
  }
  return out
}

function computeBbox(lines) {
  if (!lines.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const l of lines) {
    minX = Math.min(minX, l.x1, l.x2)
    minY = Math.min(minY, l.y1, l.y2)
    maxX = Math.max(maxX, l.x1, l.x2)
    maxY = Math.max(maxY, l.y1, l.y2)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
