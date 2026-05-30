import { supabase } from './supabase.js'
import DxfParser from 'dxf-parser'
import * as pdfjsLib from 'pdfjs-dist'
import { resolveEntityColor, getLayerColor, DEFAULT_LINE_COLOR } from './dxfColor.js'
import { summarizeDxf } from './dxfRender.js'
import { decodeDxfText, extractOpeningObjects, extractSpaceObjects } from './dxfSpaceExtract.js'
import { extractDxfPreviewContent } from './dxfPreview.js'
import { buildDxfPdfImportPreview, extractPdfImportData } from './dxfPdfImport.js'
import { composeDxfPdfBaseLayer } from './dxfPdfBaseLayer.js'
import { buildDxfUploadContent } from './dxfUploadContent.js'
// Vite 會把 worker 打包進 dist,不依賴 CDN
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const BUCKET = 'plan-assets'

async function uploadDataUrlAsset(dataUrl, storagePath, contentType = 'image/png') {
  const blob = await fetch(dataUrl).then(res => {
    if (!res.ok) throw new Error('data URL 轉 Blob 失敗')
    return res.blob()
  })
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storagePath, blob, { cacheControl: '3600', upsert: true, contentType })
  if (upErr) throw upErr
  const { data: signed, error: urlErr } = await supabase.storage.from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
  if (urlErr) throw urlErr
  return { signedUrl: signed.signedUrl, storagePath }
}

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
    // Big5(ANSI_950) 解碼 — DWG 轉的 DXF / 台灣 CAD 圖中文都是 Big5,用 file.text() (UTF-8) 會亂碼
    const arrayBuf = await file.arrayBuffer()
    const text = decodeDxfText(arrayBuf)
    const parser = new DxfParser()
    const dxf = parser.parseSync(text)
    const { lines, texts } = extractDxfContent(dxf)
    const rawBbox = computeBbox(lines)
    const preview = extractDxfPreviewContent(dxf)
    const content = buildDxfUploadContent({ preview, rawLines: lines, rawBbox, texts })
    // 直接從 DXF 幾何抽結構化空間物件 (房名+坪數+房間框+家具),不靠 vision
    let spaceObjects = null
    let openingObjects = null
    try {
      spaceObjects = extractSpaceObjects(dxf)
      console.log('[DXF] 空間物件:', spaceObjects.meta)
    } catch (e) {
      console.warn('[DXF] 空間物件抽取失敗 (不影響底圖顯示):', e)
    }
    // 有房間 → 用乾淨底圖(裁離群星爆 + 只留牆線),否則維持原樣(純線稿 DXF)
    try {
      openingObjects = extractOpeningObjects(dxf)
      console.log('[DXF] openings:', openingObjects.meta)
    } catch (e) {
      console.warn('[DXF] opening extraction failed:', e)
    }
    console.log(`[DXF] preview: ${lines.length} -> ${content.previewLines.length} lines, bbox ${Math.round(content.bbox.width)}x${Math.round(content.bbox.height)}`)
    return {
      ...base, type: 'dxf',
      ...content,
      spaceObjects,
      openingObjects
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

/**
 * DWG 雙路徑用:in-memory 解析 DXF File,抽 dxfHint 字串給 AI 識別當結構提示。
 * 不上傳到 Supabase,不返回 baseLayer。只用於 hint 提取。
 *
 * @param {File} dxfFile DXF File 物件
 * @returns {Promise<string>} dxfHint 字串 (~5-10KB,可塞 baseLayer)
 */
export async function uploadDxfPdfBaseLayer(dxfFile, pdfFile, planId) {
  let dxfLayer = null
  let pdfLayer = null
  try {
    dxfLayer = await uploadBaseLayer(dxfFile, planId)
    pdfLayer = await uploadBaseLayer(pdfFile, planId)

    const dxfText = decodeDxfText(await dxfFile.arrayBuffer())
    const dxf = new DxfParser().parseSync(dxfText)
    const pdfImportData = await extractPdfImportData(pdfFile)
    const cropPath = pdfLayer.storagePath.replace(/\.pdf$/i, '.floorplan-crop.png')
    const cropAsset = await uploadDataUrlAsset(pdfImportData.imageHref, cropPath, 'image/png')
    pdfImportData.imageHref = cropAsset.signedUrl
    pdfImportData.imageStoragePath = cropAsset.storagePath
    const importPreview = buildDxfPdfImportPreview({
      dxf,
      textItems: pdfImportData.textItems,
      crop: pdfImportData.crop,
      imageHref: pdfImportData.imageHref,
      pdfColumns: pdfImportData.pdfColumns,
    })

    return composeDxfPdfBaseLayer({
      dxfLayer,
      pdfLayer,
      pdfImportData,
      importPreview,
    })
  } catch (error) {
    await Promise.all([
      dxfLayer ? deleteBaseLayer(dxfLayer).catch(() => {}) : null,
      pdfLayer ? deleteBaseLayer(pdfLayer).catch(() => {}) : null,
    ])
    throw error
  }
}

export async function parseDxfToHint(dxfFile) {
  const text = decodeDxfText(await dxfFile.arrayBuffer())
  const parser = new DxfParser()
  const dxf = parser.parseSync(text)
  const { lines, texts } = extractDxfContent(dxf)
  const bbox = computeBbox(lines)
  const summary = summarizeDxf(lines, bbox, texts)
  return summary.hint
}

/** 刪除底圖 (從 storage 也刪掉) */
export async function deleteBaseLayer(baseLayer) {
  if (!baseLayer) return
  const paths = [baseLayer.storagePath]
  if (baseLayer.previewStoragePath) paths.push(baseLayer.previewStoragePath)
  // DWG 雙輸出: PDF 原檔 storage path 也要清 (DXF 主 + PDF 副)
  if (baseLayer.pdfStoragePath) paths.push(baseLayer.pdfStoragePath)
  if (baseLayer.pdfImport?.imageStoragePath) paths.push(baseLayer.pdfImport.imageStoragePath)
  // 多頁 PDF: 把所有 page PNG 也刪
  if (baseLayer.pages?.length) {
    for (const p of baseLayer.pages) {
      if (p.previewStoragePath && p.previewStoragePath !== baseLayer.previewStoragePath) {
        paths.push(p.previewStoragePath)
      }
    }
  }
  if (baseLayer.pdfPages?.length) {
    for (const p of baseLayer.pdfPages) {
      if (p.previewStoragePath && p.previewStoragePath !== baseLayer.pdfPreviewStoragePath) {
        paths.push(p.previewStoragePath)
      }
    }
  }
  await supabase.storage.from(BUCKET).remove(paths)
}

// ---- DXF 工具 ----

// 系統 layer 黑名單 — CloudConvert / AutoCAD 常帶進來的「非圖紙內容」
// 大寫比對,涵蓋 DEFPOINTS (定義點)、VIEWPORT (paper space 視口)、
// TITLEBLOCK / BORDER (圖框標題欄)
const NOISE_LAYER_PATTERNS = [
  /^DEFPOINTS$/i,
  /^VIEWPORT/i,
  /TITLE.?BLOCK/i,
  /^BORDER$/i,
  /^\$/,  // 系統內部 layer (前綴 $)
]

function isNoiseLayer(layer) {
  if (!layer) return false
  return NOISE_LAYER_PATTERNS.some(rx => rx.test(layer))
}

// ---- 幾何工具:CIRCLE / ARC / ELLIPSE 拆 LINE ----

const ARC_SEGMENTS = 32  // 每整圈 32 段直線近似 (家具弧 / 馬桶 / 門弧)

/** 圓弧拆成 line segments。startAngle/endAngle 單位:度數 (dxf-parser 給的就是度) */
function arcToLines(cx, cy, r, startAngle, endAngle, layer, color) {
  const out = []
  let span = endAngle - startAngle
  if (span <= 0) span += 360
  const segCount = Math.max(4, Math.ceil(ARC_SEGMENTS * span / 360))
  for (let i = 0; i < segCount; i++) {
    const a1 = (startAngle + (span * i / segCount)) * Math.PI / 180
    const a2 = (startAngle + (span * (i + 1) / segCount)) * Math.PI / 180
    out.push({
      x1: cx + r * Math.cos(a1), y1: cy + r * Math.sin(a1),
      x2: cx + r * Math.cos(a2), y2: cy + r * Math.sin(a2),
      layer, color
    })
  }
  return out
}

/** 橢圓拆 line。dxf-parser ELLIPSE: startAngle/endAngle 是 parametric radian */
function ellipseToLines(cx, cy, majorDx, majorDy, ratio, startAngle, endAngle, layer, color) {
  const majorLen = Math.hypot(majorDx, majorDy)
  if (!majorLen) return []
  const minorLen = majorLen * (ratio ?? 1)
  const rotation = Math.atan2(majorDy, majorDx)
  let span = endAngle - startAngle
  if (span <= 0) span += 2 * Math.PI
  const segCount = Math.max(4, Math.ceil(ARC_SEGMENTS * span / (2 * Math.PI)))
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation)
  const out = []
  for (let i = 0; i < segCount; i++) {
    const a1 = startAngle + (span * i / segCount)
    const a2 = startAngle + (span * (i + 1) / segCount)
    const lx1 = majorLen * Math.cos(a1), ly1 = minorLen * Math.sin(a1)
    const lx2 = majorLen * Math.cos(a2), ly2 = minorLen * Math.sin(a2)
    out.push({
      x1: cx + lx1 * cosR - ly1 * sinR,
      y1: cy + lx1 * sinR + ly1 * cosR,
      x2: cx + lx2 * cosR - ly2 * sinR,
      y2: cy + lx2 * sinR + ly2 * cosR,
      layer, color
    })
  }
  return out
}

/** MTEXT formatting code 清理 (\\f...; / \\H...; / {...} 之類控制碼) */
function cleanMTextContent(s) {
  if (!s) return ''
  return String(s)
    .replace(/\\P/g, ' ')           // \P 是換行,簡化成空格
    .replace(/\\[A-Za-z][^;]*;/g, '') // \fArial|... 之類
    .replace(/[{}]/g, '')             // grouping
    .trim()
}

/**
 * 把單一 entity 轉成 { lines: [...], texts: [...] }。
 * INSERT 會遞迴展開 BLOCK,套用 transform + 繼承 color (BYBLOCK)。
 *
 * @param {Object} e - dxf entity
 * @param {Object} ctx - { dxf, inheritedColor }
 *   - dxf: 完整 dxf object,給 layer color 查詢用
 *   - inheritedColor: 父 INSERT 的 effective color (entity color = BYBLOCK 時繼承)
 * @param {number} depth - 遞迴深度,防無限引用
 */
function entityToContent(e, ctx, depth = 0) {
  const lines = []
  const texts = []
  if (!e) return { lines, texts }
  const layer = e.layer

  // 解出此 entity 的最終 CSS color
  const layerColor = getLayerColor(layer, ctx.dxf?.tables)
  const color = resolveEntityColor(e, layerColor, ctx.inheritedColor)

  if (e.type === 'LINE' && e.vertices?.length >= 2) {
    const [a, b] = e.vertices
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer, color })
  }
  else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices?.length >= 2) {
    const vs = e.vertices
    for (let i = 0; i < vs.length - 1; i++) {
      lines.push({ x1: vs[i].x, y1: vs[i].y, x2: vs[i+1].x, y2: vs[i+1].y, layer, color })
    }
    if (e.shape && vs.length >= 3) {
      lines.push({ x1: vs[vs.length-1].x, y1: vs[vs.length-1].y, x2: vs[0].x, y2: vs[0].y, layer, color })
    }
  }
  else if (e.type === 'CIRCLE' && e.center && e.radius != null) {
    lines.push(...arcToLines(e.center.x, e.center.y, e.radius, 0, 360, layer, color))
  }
  else if (e.type === 'ARC' && e.center && e.radius != null) {
    lines.push(...arcToLines(
      e.center.x, e.center.y, e.radius,
      e.startAngle ?? 0, e.endAngle ?? 360, layer, color
    ))
  }
  else if (e.type === 'ELLIPSE' && e.center) {
    lines.push(...ellipseToLines(
      e.center.x, e.center.y,
      e.majorAxisEndPoint?.x ?? 1, e.majorAxisEndPoint?.y ?? 0,
      e.axisRatio ?? 1,
      e.startAngle ?? 0, e.endAngle ?? Math.PI * 2,
      layer, color
    ))
  }
  else if (e.type === 'SPLINE' && e.controlPoints?.length >= 2) {
    const cps = e.controlPoints
    for (let i = 0; i < cps.length - 1; i++) {
      lines.push({ x1: cps[i].x, y1: cps[i].y, x2: cps[i+1].x, y2: cps[i+1].y, layer, color })
    }
  }
  else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text != null) {
    const x = e.startPoint?.x ?? e.position?.x ?? 0
    const y = e.startPoint?.y ?? e.position?.y ?? 0
    const content = cleanMTextContent(e.text)
    if (content) {
      texts.push({
        x, y,
        content,
        height: e.height || e.textHeight || 100,
        rotation: e.rotation || 0,
        layer, color
      })
    }
  }
  else if (e.type === 'INSERT' && ctx.dxf?.blocks) {
    const sub = expandInsert(e, ctx, depth)
    lines.push(...sub.lines)
    texts.push(...sub.texts)
  }
  else if (e.type === 'DIMENSION') {
    const blockName = e.block || e.blockName
    if (blockName && ctx.dxf?.blocks?.[blockName]) {
      const fakeInsert = {
        name: blockName,
        position: { x: 0, y: 0 },
        xScale: 1, yScale: 1, rotation: 0,
        layer,
        colorIndex: e.colorIndex  // 傳 ACI 給 anonymous BLOCK 解析
      }
      const sub = expandInsert(fakeInsert, ctx, depth)
      lines.push(...sub.lines)
      texts.push(...sub.texts)
    }
  }
  // HATCH / 其他 entity 暫不處理

  return { lines, texts }
}

/**
 * INSERT 展開:把 BLOCK 內部 entity 套用 transform + color 繼承後放到 INSERT 位置。
 *
 * Transform 順序 (DXF spec):
 *   1. entity 座標扣掉 BLOCK base point (block.position)
 *   2. 套用 xScale / yScale
 *   3. 繞 (0,0) 旋轉 rotation
 *   4. 平移到 INSERT position
 *
 * Color 繼承 (BYBLOCK 機制):
 *   BLOCK 內 entity 若 color = 0 (BYBLOCK),繼承 INSERT 自己的 effective color。
 *   INSERT 自己的 color 也可能是 BYLAYER / 具體 ACI,先解析出來再往下傳。
 */
function expandInsert(insertEntity, parentCtx, depth) {
  if (depth > 6) return { lines: [], texts: [] }
  const block = parentCtx.dxf?.blocks?.[insertEntity.name]
  if (!block?.entities) return { lines: [], texts: [] }

  // 計算 INSERT 自己的 effective color,當作 child 的 inheritedColor
  const insertLayerColor = getLayerColor(insertEntity.layer, parentCtx.dxf?.tables)
  const insertEffectiveColor = resolveEntityColor(insertEntity, insertLayerColor, parentCtx.inheritedColor)
  const childCtx = { ...parentCtx, inheritedColor: insertEffectiveColor }

  const px = insertEntity.position?.x || 0
  const py = insertEntity.position?.y || 0
  const sx = insertEntity.xScale ?? 1
  const sy = insertEntity.yScale ?? 1
  const rot = (insertEntity.rotation || 0) * Math.PI / 180
  const cosR = Math.cos(rot), sinR = Math.sin(rot)
  const bx = block.position?.x || 0
  const by = block.position?.y || 0

  function tx(x, y) {
    const lx = (x - bx) * sx
    const ly = (y - by) * sy
    return {
      x: px + lx * cosR - ly * sinR,
      y: py + lx * sinR + ly * cosR
    }
  }

  const outLines = []
  const outTexts = []
  for (const child of block.entities) {
    const sub = entityToContent(child, childCtx, depth + 1)
    for (const l of sub.lines) {
      const p1 = tx(l.x1, l.y1)
      const p2 = tx(l.x2, l.y2)
      outLines.push({
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        layer: l.layer || insertEntity.layer,
        color: l.color || insertEffectiveColor
      })
    }
    for (const t of sub.texts) {
      const p = tx(t.x, t.y)
      outTexts.push({
        ...t,
        x: p.x, y: p.y,
        rotation: (t.rotation || 0) + (insertEntity.rotation || 0),
        height: t.height * Math.abs(sx),
        layer: t.layer || insertEntity.layer,
        color: t.color || insertEffectiveColor
      })
    }
  }
  return { lines: outLines, texts: outTexts }
}

/**
 * 從 dxf 抽出所有可視 entity → { lines, texts }。
 * 支援:LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT / INSERT / DIMENSION
 * 過濾:系統 layer (DEFPOINTS / VIEWPORT / TITLEBLOCK 等)
 */
function isFiniteCoord(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

function extractDxfContent(dxf) {
  const allLines = []
  const allTexts = []
  if (!dxf?.entities) return { lines: allLines, texts: allTexts }

  const rootCtx = { dxf, inheritedColor: null }
  let noiseFiltered = 0
  let entityErrors = 0
  let nanLineDropped = 0
  let nanTextDropped = 0
  const typeStats = {}
  const errorTypes = {}

  for (const e of dxf.entities) {
    if (isNoiseLayer(e.layer)) { noiseFiltered++; continue }
    typeStats[e.type] = (typeStats[e.type] || 0) + 1

    let result
    try {
      result = entityToContent(e, rootCtx)
    } catch (err) {
      entityErrors++
      errorTypes[e.type] = (errorTypes[e.type] || 0) + 1
      continue
    }

    for (const l of result.lines) {
      if (isFiniteCoord(l.x1) && isFiniteCoord(l.y1) && isFiniteCoord(l.x2) && isFiniteCoord(l.y2)) {
        allLines.push(l)
      } else {
        nanLineDropped++
      }
    }
    for (const t of result.texts) {
      if (isFiniteCoord(t.x) && isFiniteCoord(t.y) && t.content) {
        allTexts.push({
          ...t,
          height: isFiniteCoord(t.height) && t.height > 0 ? t.height : 100,
          rotation: isFiniteCoord(t.rotation) ? t.rotation : 0
        })
      } else {
        nanTextDropped++
      }
    }
  }

  if (noiseFiltered > 0) console.log(`[DXF] 過濾 ${noiseFiltered} 個系統 layer entity`)
  if (entityErrors > 0) console.warn(`[DXF] ${entityErrors} 個 entity 解析時拋錯,已隔離忽略:`, errorTypes)
  if (nanLineDropped > 0) console.warn(`[DXF] 丟棄 ${nanLineDropped} 條 NaN 座標的線`)
  if (nanTextDropped > 0) console.warn(`[DXF] 丟棄 ${nanTextDropped} 個 NaN 座標的文字`)
  console.log(`[DXF] 解析結果: ${allLines.length} 條線, ${allTexts.length} 個文字`)
  console.log(`[DXF] Entity 統計:`, typeStats)

  return { lines: allLines, texts: allTexts }
}

/**
 * 全範圍 bbox — 涵蓋所有 dxfLines (不剔除離群)。
 *
 * 為什麼不用 IQR 過濾:
 *   方案 B 雙路徑 (DWG → DXF + PDF) 下,AI 識別吃 PDF previewUrl,
 *   Gemini 認的 normalized 0-1 對應「整張 PDF 含圖框 + 標題」。
 *   若 DXF bbox 只取主體 (過濾離群),Canvas2D 顯示跟 AI 識別座標系不一致,
 *   會出現「藍框偏移、比例尺對不上」。
 *
 *   保留 simple min/max,讓 DXF bbox 跟 PDF 全範圍對齊。
 *   noise layer filter (DEFPOINTS/VIEWPORT 等) 仍在 extractDxfContent 過濾掉,
 *   所以不會被「假成員」撐爆。
 *
 *   若特定 DWG 有真離群點 (例如 PinCAD 圖庫家具放遠處),會撐大 bbox 讓主體變小,
 *   後續再用 BaseLayerControls 的縮放/移動補救。
 */
function computeBbox(lines) {
  if (!lines.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const l of lines) {
    minX = Math.min(minX, l.x1, l.x2)
    minY = Math.min(minY, l.y1, l.y2)
    maxX = Math.max(maxX, l.x1, l.x2)
    maxY = Math.max(maxY, l.y1, l.y2)
  }

  if (!isFinite(minX)) {
    minX = -1000; minY = -1000; maxX = 1000; maxY = 1000
  }
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  // 健檢:若 bbox 極端寬/高比 (>20:1) 警告,可能有遠處離群點
  const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height))
  if (ratio > 20) {
    console.warn(`[DXF] bbox 寬高比異常 ${ratio.toFixed(1)}:1,可能含遠處離群 entity。如顯示主體過小,請考慮在 fileUpload.js 加 outlier filter`)
  }

  return { minX, minY, maxX, maxY, width, height }
}

function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
