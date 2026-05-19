/**
 * 從各種檔案抽取「給 AI 看的內容」
 *
 * 圖片/PDF/可看圖的:回 { type: 'image', base64, mimeType, fallbackText? }
 * Word/Excel/PPT:回 { type: 'text', text, fileName }
 * 純文字:回 { type: 'text', text, fileName }
 */
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/**
 * 主入口:依副檔名/mime 決定怎麼處理
 * @returns {Promise<{type:'image'|'text', ...}>}
 */
export async function extractForAI(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const mime = file.type || ''

  // 圖片
  if (['jpg','jpeg','png','webp','gif','bmp'].includes(ext) || mime.startsWith('image/')) {
    return await imageToBase64(file)
  }

  // PDF — 先試抽文字,文字夠多就用文字,不然轉首頁 PNG 給 Vision
  if (ext === 'pdf' || mime === 'application/pdf') {
    try {
      const text = await extractPdfText(file)
      if (text && text.replace(/\s/g, '').length > 50) {
        return { type: 'text', text, fileName: file.name, source: 'pdf-text' }
      }
    } catch (e) { console.warn('PDF 抽文字失敗,改 fallback Vision', e) }
    // fallback:第一頁轉 PNG 給 Vision
    try {
      const pngBlob = await pdfFirstPageAsImage(file)
      return await imageToBase64(pngBlob, file.name)
    } catch (e) {
      throw new Error('PDF 處理失敗: ' + e.message)
    }
  }

  // Word
  if (['doc','docx'].includes(ext)) {
    return await extractWord(file)
  }

  // Excel / CSV
  if (['xls','xlsx','csv','tsv'].includes(ext)) {
    return await extractExcel(file)
  }

  // PowerPoint
  if (['ppt','pptx'].includes(ext)) {
    return await extractPpt(file)
  }

  // 純文字類
  if (['txt','md','json','xml','html','log'].includes(ext) || mime.startsWith('text/')) {
    const text = await file.text()
    return { type: 'text', text, fileName: file.name, source: 'plain' }
  }

  // 其他:嘗試當文字讀
  try {
    const text = await file.text()
    return { type: 'text', text: text.slice(0, 50000), fileName: file.name, source: 'fallback-text' }
  } catch {
    throw new Error(`不支援的檔案類型: ${file.name}`)
  }
}

// ---- 工具 ----

async function imageToBase64(blob, fileName = 'image') {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return {
    type: 'image',
    base64: btoa(bin),
    mimeType: blob.type || 'image/png',
    fileName
  }
}

async function extractPdfText(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const parts = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    parts.push(`【第 ${i} 頁】\n` + tc.items.map(it => it.str).join(' '))
  }
  return parts.join('\n\n')
}

async function pdfFirstPageAsImage(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const page = await pdf.getPage(1)
  const vp = page.getViewport({ scale: 1.5 })
  const canvas = document.createElement('canvas')
  canvas.width = vp.width; canvas.height = vp.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
  return new Promise((res) => canvas.toBlob(b => res(b), 'image/png'))
}

async function extractWord(file) {
  const buf = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return {
    type: 'text',
    text: result.value || '',
    fileName: file.name,
    source: 'word'
  }
}

async function extractExcel(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheets = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    // 轉成 CSV 比較好讀
    const csv = XLSX.utils.sheet_to_csv(ws)
    sheets.push(`【工作表: ${name}】\n${csv}`)
  }
  return {
    type: 'text',
    text: sheets.join('\n\n'),
    fileName: file.name,
    source: 'excel'
  }
}

/**
 * PPTX 抽文字 — pptx 是 ZIP,每張 slide 是一個 XML
 */
async function extractPpt(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext !== 'pptx') {
    // 舊版 .ppt (二進位) 我們不解析,跳過
    throw new Error('舊版 .ppt 不支援,請另存為 .pptx 或 PDF')
  }
  const buf = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buf)
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort()
  const slides = []
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('string')
    // 用 regex 抓 <a:t>文字</a:t>
    const matches = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    const text = matches.map(m => m[1]).filter(Boolean).join(' ')
    if (text.trim()) {
      slides.push(`【投影片 ${slides.length + 1}】\n${text}`)
    }
  }
  return {
    type: 'text',
    text: slides.join('\n\n'),
    fileName: file.name,
    source: 'pptx'
  }
}
