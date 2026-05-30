/**
 * DXF 渲染與結構摘要 — 給 Hybrid AI 識別用。
 *
 * 流程:
 *   uploadBaseLayer (fileUpload.js) 解出 dxfLines + bbox 後,
 *   AiRecognizeButton 呼叫這裡:
 *     1) renderDxfToBlobUrl — 線段渲染成乾淨黑線白底 PNG (給 Vision LLM 看圖)
 *     2) summarizeDxf — 抽 layer 統計與幾何摘要 (給 Vision LLM 當文字線索)
 *   兩個一起餵 Gemini = Hybrid (圖 + JSON)。
 */

/**
 * 把 dxfLines + dxfTexts 渲染成 PNG blob。
 * 純黑線、白底、無背景紋路 — 對 vision LLM 比 PDF 渲染圖更友善。
 *
 * @param {Array<{x1,y1,x2,y2,layer?:string}>} lines
 * @param {{minX:number,minY:number,maxX:number,maxY:number,width:number,height:number}} bbox
 * @param {Object} [opts]
 * @param {number} [opts.maxSize=1600] 長邊像素上限
 * @param {number} [opts.padding=40] 邊框留白 (px)
 * @param {Array<{x,y,content,height?,rotation?}>} [opts.texts] DXF TEXT/MTEXT 內容
 * @returns {Promise<Blob>} image/png
 */
export async function renderDxfToPng(lines, bbox, opts = {}) {
  const maxSize = opts.maxSize ?? 1600
  // padding 預設 0:讓 PNG normalized [0,1] 完全對應 DXF bbox,
  // aiVisionGemini.js 用 placement 換算座標時不需要 padding 補償,避免 2-3% 偏移
  const padding = opts.padding ?? 0
  const texts = opts.texts || []

  const bw = bbox.width || 1
  const bh = bbox.height || 1
  const ratio = bw / bh
  let canvasW, canvasH
  if (ratio >= 1) {
    canvasW = maxSize
    canvasH = Math.max(200, Math.round(maxSize / ratio))
  } else {
    canvasH = maxSize
    canvasW = Math.max(200, Math.round(maxSize * ratio))
  }

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  const drawW = canvasW - 2 * padding
  const drawH = canvasH - 2 * padding
  const sx = drawW / bw
  const sy = drawH / bh

  // 1) 線
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'

  for (const l of lines) {
    const x1 = padding + (l.x1 - bbox.minX) * sx
    const y1 = padding + (bbox.maxY - l.y1) * sy
    const x2 = padding + (l.x2 - bbox.minX) * sx
    const y2 = padding + (bbox.maxY - l.y2) * sy
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // 2) 文字 (給 vision LLM 看清楚)
  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'alphabetic'
  for (const t of texts) {
    const x = padding + (t.x - bbox.minX) * sx
    const y = padding + (bbox.maxY - t.y) * sy
    const fontPx = Math.max(8, (t.height || 100) * Math.min(sx, sy))
    ctx.save()
    ctx.translate(x, y)
    if (t.rotation) ctx.rotate(-t.rotation * Math.PI / 180)
    ctx.font = `${fontPx}px sans-serif`
    ctx.fillText(t.content, 0, 0)
    ctx.restore()
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas toBlob 失敗'))
    }, 'image/png')
  })
}

/**
 * 渲染並回傳 ObjectURL — 給 AiRecognizeButton 當作 imageUrl 用。
 * 呼叫端負責 URL.revokeObjectURL 清理。
 */
export async function renderDxfToBlobUrl(lines, bbox, opts) {
  const blob = await renderDxfToPng(lines, bbox, opts)
  return { url: URL.createObjectURL(blob), blob }
}

/**
 * 抽 DXF 結構摘要,當作 LLM 的文字線索 (hybrid 的「JSON」那一半)。
 *
 * 為什麼這個有用:
 *   渲染圖只給 vision LLM 看「形狀」,看不出 layer 名稱。
 *   "WALL" / "牆" / "AXIS" / "DOOR" 這些 layer 名稱是 CAD 圖最有 semantic 的線索,
 *   塞進 prompt 能讓 Gemini 對「哪些線是牆 vs 軸線 vs 門窗」分得更乾淨。
 */
export function summarizeDxf(lines, bbox, texts = []) {
  const layerStats = new Map()
  for (const l of lines) {
    const layer = l.layer || '(無 layer)'
    const stat = layerStats.get(layer) || { count: 0, lenSum: 0, horiz: 0, vert: 0 }
    stat.count++
    const dx = l.x2 - l.x1
    const dy = l.y2 - l.y1
    stat.lenSum += Math.hypot(dx, dy)
    if (Math.abs(dx) > Math.abs(dy) * 5) stat.horiz++
    else if (Math.abs(dy) > Math.abs(dx) * 5) stat.vert++
    layerStats.set(layer, stat)
  }

  const layers = [...layerStats.entries()]
    .map(([name, s]) => ({
      name,
      count: s.count,
      avgLength: Math.round(s.lenSum / Math.max(s.count, 1)),
      horizCount: s.horiz,
      vertCount: s.vert
    }))
    .sort((a, b) => b.count - a.count)

  const layerLines = layers
    .slice(0, 12)
    .map(l => `- ${l.name}: ${l.count} 線 (平均長 ${l.avgLength}, 水平 ${l.horizCount}, 垂直 ${l.vertCount})`)
    .join('\n')

  // 文字摘要:挑出有意義的標籤 (排除純尺寸數字、單字符 garbage)
  const meaningfulTexts = texts
    .map(t => t.content?.trim())
    .filter(c => c && c.length >= 2 && !/^\d+['"\-\s.]+$/.test(c))  // 排除純尺寸如 "15'-0\""
    .slice(0, 40)
  const textBlock = meaningfulTexts.length
    ? meaningfulTexts.map(c => `- "${c}"`).join('\n')
    : '(無)'

  const hint = [
    `# DXF 向量結構摘要 (補充線索,你看到的圖就是把這些線段+文字渲染出來)`,
    ``,
    `- 線段總數: ${lines.length}`,
    `- 文字數: ${texts.length}`,
    `- 圖紙範圍 (DXF 單位): ${Math.round(bbox.width)} × ${Math.round(bbox.height)}`,
    ``,
    `## 主要 layers (前 12 名,依線段數排序)`,
    layerLines || '(此 DXF 沒有 layer 命名)',
    ``,
    `## 圖上的文字標籤 (前 40 個有意義的字串)`,
    textBlock,
    ``,
    `## 怎麼利用這份摘要`,
    `- 文字標籤是房名 / 標題 / 注釋 — 你 OCR 認不清楚時對這個列表查正確拼法`,
    `- layer 名稱含 "WALL" / "牆" / "墙" → 很可能是牆`,
    `- 名稱含 "AXIS" / "軸" / "轴" / "GRID" → 通常是軸線/網格,**不是牆**,不要算進去`,
    `- 名稱含 "DOOR" / "WIN" / "門" / "窗" → 對應門窗`,
    `- 名稱含 "DIM" / "TEXT" / "標註" → 標註文字,忽略`,
    `- 名稱含 "FURN" / "EQUIP" / "家具" → 家具/設備邊框,**不是牆**`,
    `- layer 名稱只是線索,最終以視覺特徵 (粗線/實線/位置) 為準`,
  ].join('\n')

  return {
    totalLines: lines.length,
    totalTexts: texts.length,
    bbox: { width: bbox.width, height: bbox.height },
    layers,
    texts: meaningfulTexts,
    hint
  }
}
