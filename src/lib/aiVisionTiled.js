/**
 * AI 識別圖紙 — 切塊 (tiled) 版,解「整圖縮圖丟失小房間細節」問題
 *
 * 為什麼需要切塊:
 *   Gemini 對輸入圖會內部 resize 到約 1024px 長邊。一張 1800px 的辦公室
 *   工作圖被縮到 1024 後,中央電梯井那帶的小隔間 (主管室 2.7P 等) 細節糊掉,
 *   AI 把房間框錯位置 (框到下方文字 / 電梯井)。
 *   切成 2×2 後,每塊接近 1024px 不被縮,小房間在塊內佔比放大,細節保留。
 *
 * Pipeline:
 *   1. 全圖低解析跑一次 → 拿 detected_labels (房間清單當「地圖」) + 全局結構
 *      (牆/門/窗/柱 — 這些跨塊難拼,用全圖那次的結果)
 *   2. 切 tilesX × tilesY 塊,每塊帶 overlap (邊界房間至少在某塊完整)
 *      每塊送 Gemini,告知「這是整圖的哪個區塊 + 預期房間清單」
 *      回來的 tile-local 0-1 座標 → 轉回整圖 0-1
 *   3. 合併所有塊的 spaces,按房間名 + 中心距離去重 (overlap 造成重複)
 *   4. 後處理 (最小尺寸) + 用全圖的牆/柱 + 轉 svg unit
 *
 * 限制:底圖是上傳時 1.5x 渲染的 PNG (原 PDF 沒留),切塊切的是這張 PNG。
 *   解決的是「Gemini resize 丟細節」,不是「源解析度不足」。若 1.5x 仍不夠,
 *   需改上傳流程存原 PDF + 切塊時高解析重渲 (未做)。
 */
import {
  callGeminiVision,
  extendSmallSpaces,
  logSpaceBboxes,
  finalizeToSvg,
  roomPing,
  SYSTEM,
  ai
} from './aiVisionGemini.js'

const TILE_MAX_DIM = 1400  // 每塊送 Gemini 前的最大邊長 (接近 Gemini 內部處理上限)

/**
 * fetch 圖 → ImageBitmap (用 fetch+blob 避免 canvas crossOrigin taint)
 */
async function loadBitmap(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('底圖下載失敗 ' + res.status)
  const blob = await res.blob()
  return await createImageBitmap(blob)
}

/**
 * 把 bitmap 的某個區域 (像素座標) 畫到 canvas 並轉 base64 PNG。
 * 超過 maxDim 等比縮小 (避免 Gemini 再縮造成細節丟失,但也別超上限)。
 */
function regionToBase64(bitmap, sx, sy, sw, sh, maxDim = TILE_MAX_DIM) {
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dw, dh)  // 白底,避免透明 PNG 變黑
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, dw, dh)
  const dataUrl = canvas.toDataURL('image/png')
  return dataUrl.split(',')[1]
}

// ── 幾何 helper (mergeSpaces + 大房間修補共用) ──
function spaceBbox(s) {
  const xs = s.vertices.map(v => v.x), ys = s.vertices.map(v => v.y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
function bboxArea([x0, y0, x1, y1]) { return (x1 - x0) * (y1 - y0) }
function bboxOverlapRatio(a, b) {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = ix * iy
  const minArea = Math.min(bboxArea(a), bboxArea(b))
  return minArea > 0 ? inter / minArea : 0
}

/**
 * 合併各塊 spaces。overlap 區會讓同一房間在相鄰兩塊都被框 → 去重。
 *
 * 去重靠**位置重疊**而非名字 (AI 跨塊命名常不一致,名字不可靠):
 *   兩 space 的 bbox 交集 / 較小者面積 > OVERLAP_DUP → 視為同一房間,留較完整的。
 *   相鄰的不同小房間 (主管室 A/B 緊貼) 頂多邊緣碰,重疊率遠低於閾值,不會誤併。
 */
function mergeSpaces(allSpaces) {
  const OVERLAP_DUP = 0.45  // 交集佔較小房間 > 45% 視為重複框
  const score = s => bboxArea(spaceBbox(s)) * s.vertices.length
  const kept = []
  for (const s of allSpaces) {
    if (!s.vertices || s.vertices.length < 3) continue
    const sb = spaceBbox(s)
    const dupIdx = kept.findIndex(k => bboxOverlapRatio(sb, spaceBbox(k)) > OVERLAP_DUP)
    if (dupIdx < 0) { kept.push(s); continue }
    const k = kept[dupIdx]
    const sTile = s._src === 'tile', kTile = k._src === 'tile'
    // 切塊精修框 (tile) 永遠優先取代全圖粗框 (full);同來源才比完整度
    if (sTile && !kTile) kept[dupIdx] = s
    else if (!sTile && kTile) { /* 保留既有切塊框 */ }
    else if (score(s) > score(k)) kept[dupIdx] = s
  }
  return kept
}

/**
 * 切塊主流程。介面比照 recognizePlanFromImage,多了 tile 參數 + onProgress。
 *
 * @param {Object} args
 *   - imageUrl, baseLayer, svgBounds, dxfHint  (同 recognizePlanFromImage)
 *   - tilesX, tilesY: 切幾塊 (預設 2×2)
 *   - overlap: 塊間重疊比例 (預設 0.12 = 12%)
 *   - onProgress(stage, msg): 進度回報
 */
export async function recognizePlanTiled({
  imageUrl, baseLayer, svgBounds, dxfHint,
  tilesX = 2, tilesY = 2, overlap = 0.12, onProgress
}) {
  if (!ai) throw new Error('Gemini API Key 未設定')
  const report = (msg) => { onProgress?.(msg); console.log('[切塊識別]', msg) }

  // ── Step 1: 載入整圖 ────────────────────────────────────
  report('載入底圖…')
  const bitmap = await loadBitmap(imageUrl)
  const W = bitmap.width, H = bitmap.height
  console.log(`[切塊識別] 底圖 ${W} × ${H} px,切 ${tilesX}×${tilesY} (overlap ${overlap})`)

  // ── Step 2: 全圖一次,拿房間清單(地圖)+ 全局結構(牆/門/窗/柱)──
  report('全圖掃描 (取房間清單 + 牆柱)…')
  const fullBase64 = regionToBase64(bitmap, 0, 0, W, H)
  const fullPrompt = `看這張完整平面圖。

# 圖像尺寸
${W} × ${H} pixels

# 任務 (這次只要全局資訊,不用追求每個房間多邊形精準)
1. detected_labels: 逐區域掃完,列出所有中文房間標籤 + 位置
2. walls / doors / windows / structuralColumns: 全局結構,盡量完整
3. spaces: 給粗略多邊形即可 (細節稍後切塊精修)

用 normalized 0-1 座標。直接輸出 JSON。`
  const full = await callGeminiVision(fullBase64, 'image/png', fullPrompt)
  const allLabels = full.detected_labels || []
  console.log(`[切塊識別] 全圖 labels: ${allLabels.length}`, allLabels.map(l => l.name))

  // ── Step 3: 逐塊精修房間多邊形 ──────────────────────────
  // 不靠全圖 label 座標分塊 (座標常不準會錯分),改成每塊都跑、AI 看裁切圖自己挑
  // 實際看得到的房間。跨界重複框靠後面位置去重處理。
  const allTileSpaces = []
  const allLabelNames = allLabels.map(l => l.name).filter(Boolean)
  const tilePositionName = (i, j) => {
    const col = tilesX === 1 ? '' : (i === 0 ? '左' : i === tilesX - 1 ? '右' : '中')
    const row = tilesY === 1 ? '' : (j === 0 ? '上' : j === tilesY - 1 ? '下' : '中')
    return (row + col) || '整'
  }

  for (let j = 0; j < tilesY; j++) {
    for (let i = 0; i < tilesX; i++) {
      // tile 在整圖的 normalized 範圍 (含 overlap,clamp 到 [0,1])
      const tx0 = Math.max(0, i / tilesX - overlap / 2)
      const tx1 = Math.min(1, (i + 1) / tilesX + overlap / 2)
      const ty0 = Math.max(0, j / tilesY - overlap / 2)
      const ty1 = Math.min(1, (j + 1) / tilesY + overlap / 2)
      const posName = tilePositionName(i, j)
      report(`區塊 ${posName} (${j * tilesX + i + 1}/${tilesX * tilesY})…`)

      // 裁切像素區域
      const sx = Math.round(tx0 * W), sy = Math.round(ty0 * H)
      const sw = Math.round((tx1 - tx0) * W), sh = Math.round((ty1 - ty0) * H)
      const tileBase64 = regionToBase64(bitmap, sx, sy, sw, sh)

      const tilePrompt = `這是一張辦公室平面圖的「裁切區塊」(整圖的${posName}部分,約 ${sw}×${sh} px)。

# 整層樓的房間清單 (供參考,不是每個都在這塊裡)
${allLabelNames.map(n => '- ' + n).join('\n')}

# 任務
看這張裁切圖,**只框你在這張圖裡實際看得到中文標籤的房間**,畫精準的牆內側多邊形 (spaces)。
- 用相對「這張裁切圖」的 normalized 0-1 座標 (左上 0,0;右下 1,1)
- **看不到的房間不要硬框** (它在別的區塊,硬框會用猜的造成垃圾)
- 因為這是放大的局部圖,你應該能清楚分辨「小隔間」vs「電梯井 / 樓梯 / 走道」
- 房間標籤可能標在房間下緣或外面,房間實體不一定在標籤正下方 — 看清楚牆線在哪
- 被裁切邊緣切到的房間,照樣框它在這塊內可見的部分
- 遵守最小尺寸 (w/h ≥ 0.04) 與房間不重疊規則
- name 盡量照上面清單的原文
- 不用回 walls/doors/windows/columns (那些用全圖結果),只要 spaces

直接輸出 JSON。`

      let tp
      try {
        tp = await callGeminiVision(tileBase64, 'image/png', tilePrompt)
      } catch (e) {
        console.warn(`[切塊識別] 區塊 ${posName} 失敗,略過:`, e.message)
        continue
      }
      const tileSpaces = tp.spaces || []
      console.log(`[切塊識別] 區塊 ${posName}: ${tileSpaces.length} spaces`, tileSpaces.map(s => s.name))

      // tile-local 0-1 → 整圖 0-1
      tileSpaces.forEach(s => {
        if (!s.vertices) return
        s.vertices = s.vertices.map(v => ({
          x: tx0 + v.x * (tx1 - tx0),
          y: ty0 + v.y * (ty1 - ty0)
        }))
        s._src = 'tile'
        allTileSpaces.push(s)
      })
    }
  }

  // ── Step 4: 合併。優先純切塊;只在切塊涵蓋率太低時才用全圖粗框補 ──
  report('合併各塊結果…')
  const tileMerged = mergeSpaces(allTileSpaces)
  const coverage = allLabels.length > 0 ? tileMerged.length / allLabels.length : 1
  let mergedSpaces
  if (coverage >= 0.6) {
    // 切塊涵蓋夠 → 純用切塊,不補全圖粗框。
    // 全圖粗框是重複 / 巨框的來源,切塊成功時弊大於利;漏掉的少數房間手動加即可。
    mergedSpaces = tileMerged
    console.log(`[切塊識別] 切塊涵蓋 ${tileMerged.length}/${allLabels.length} (${Math.round(coverage * 100)}%) 足夠 → 純用切塊,不補全圖粗框`)

    // 補漏 + 大房間修補:掃全圖那次的每個房間,跟切塊結果比對
    //  - 切塊完全沒框到 (位置無重疊) → 補上全圖框 (例如這次漏掉的 44人討論)
    //  - 大房間切塊只框到局部 (半截) → 用全圖完整框取代 (例如 86人共享框半截)
    //  - 小房間切塊已框到的一律不動 (留切塊精修,不把全圖扁框疊上去)
    // 補漏判斷用「位置 + 名字」雙重條件。因為全圖那次與切塊那次對同一房間的
    // y 座標常系統性偏移 (全圖偏低),只靠位置會把切塊其實有框的整排當沒框到重複補。
    // normName: 去掉 (上)(下)(左)(右)(middle) 等方向後綴 + 空白,只比核心房名 + 坪數
    const normName = n => (n || '').replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').trim()
    const tileNames = new Set(mergedSpaces.map(s => normName(s.name)))
    const BIG_PING = 10  // ≥ 10 坪才算「大房間」,只有大房間才做「局部→完整」取代
                         // 用坪數判斷比 normalized 面積準 (17人會計 16.4P 面積才 0.017 會被面積門檻漏掉)
    const fullSpaces = (full.spaces || []).filter(s => s.vertices?.length >= 3)
    let added = 0, replaced = 0
    for (const F of fullSpaces) {
      const fb = spaceBbox(F)
      let bestIdx = -1, bestOv = 0
      mergedSpaces.forEach((T, idx) => {
        const ov = bboxOverlapRatio(fb, spaceBbox(T))
        if (ov > bestOv) { bestOv = ov; bestIdx = idx }
      })
      if (bestOv < 0.3 && !tileNames.has(normName(F.name))) {
        // 切塊位置沒框到 + 名字也沒出現過 → 真的漏了 (例如 44人討論),補上
        F._src = 'full'
        mergedSpaces.push(F)
        added++
      } else if (bestIdx >= 0 && (roomPing(F.name) || 0) >= BIG_PING && bboxArea(spaceBbox(mergedSpaces[bestIdx])) < bboxArea(fb) * 0.7) {
        // 大房間 (≥10坪) 切塊只框到局部 → 用全圖完整框取代 (17人會計、20人主管、86共享…)
        F._src = 'full'
        mergedSpaces[bestIdx] = F
        replaced++
      }
    }
    if (added || replaced) console.log(`[切塊識別] 補漏 ${added} 個 (切塊沒框到) + 取代 ${replaced} 個大房間局部框`)
  } else {
    // 切塊涵蓋不足 (上半整個失敗之類) → 全圖粗框補空位,位置去重切塊優先
    const fullSpaces = (full.spaces || []).filter(s => s.vertices?.length >= 3)
    fullSpaces.forEach(s => { s._src = 'full' })
    mergedSpaces = mergeSpaces([...allTileSpaces, ...fullSpaces])
    const nFull = mergedSpaces.filter(s => s._src === 'full').length
    console.warn(`[切塊識別] 切塊涵蓋僅 ${tileMerged.length}/${allLabels.length} (${Math.round(coverage * 100)}%) 偏低 → 用全圖補 ${nFull} 個 (可能出現粗框)`)
  }

  extendSmallSpaces(mergedSpaces)
  logSpaceBboxes(mergedSpaces)

  // ── Step 5: 組裝 + 轉 svg unit (牆/門/窗/柱用全圖結果) ──
  const parsed = {
    scale_note: full.scale_note,
    confidence: full.confidence,
    walls: full.walls,
    doors: full.doors,
    windows: full.windows,
    structuralColumns: full.structuralColumns,
    detected_labels: allLabels,
    spaces: mergedSpaces
  }
  report(`完成 — ${mergedSpaces.length} 房間 (預期 ${allLabels.length})`)
  return finalizeToSvg(parsed, baseLayer, svgBounds)
}
