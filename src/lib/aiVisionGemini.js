/**
 * AI 識別圖紙生戶型 — Gemini 版（aiVision.js 的並排實驗版本）
 *
 * 同樣策略:
 *  - AI 不估算 cm，只回 normalized [0,1] 座標
 *  - 程式碼用 baseLayer.placement 把 0-1 換成 svg unit
 *
 * 切換: AiRecognizeButton.jsx 的 import 指向哪個檔
 */
import { GoogleGenAI } from '@google/genai'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

// 可調：'gemini-3.5-flash' / 'gemini-3-pro' / 'gemini-2.5-pro' / 'gemini-2.5-flash'
const MODEL = 'gemini-3.5-flash'

const SYSTEM = `你是嚴謹的建築平面圖辨識引擎。**完整 ≥ 準確**:有中文標籤的房間一定要標到。

# 座標系統 (重要!)
**所有座標都用 normalized [0, 1] 圖像座標**:
- (0, 0) = 圖像「左上角」(0% 左, 0% 上)
- (1, 1) = 圖像「右下角」(100% 右, 100% 下)
- 不要估算 cm,**就用 0-1 描述「在圖上什麼位置」**

# 工作流程 (必須照順序填 JSON,前面欄位是後面的思考依據)

## Step 1 → 填 \`detected_labels\`:先掃完整張圖列出所有中文房間標籤
仔細**逐區域**掃描(左上 → 右上 → 中央 → 左下 → 右下),把每一個寫著房間名稱的標籤都列出來。
範例標籤:「主臥」「17人會計辦公室」「茶水區 7.1P」「治療室 5.5P」「會議室 5.6P」「20人主管中心辦公室」「44人討論休息區」「8人辦公室」「主管室」「影印區」「收發」「模擬室」「預留區」

**重要 prior:辦公室工作圖通常 15-30 個房間。如果你只列出 3-5 個 labels,你一定漏了大半,回頭再掃一次**。看到「P」結尾(坪數)、「人」字、室/區/間 的詞都是候選標籤。

每個 label 給:
- \`name\`: 標籤文字 (含坪數,例如「17人會計辦公室 16.4P」)
- \`label_x\`, \`label_y\`: 標籤文字中心的 normalized 座標

## Step 2 → 填 \`structural\`:牆 / 門 / 窗 / 柱
- **牆**: 外牆 = 最外圈粗黑實線;內牆 = 房間之間較細實線。**不要**把家具邊框、軸線、設備外緣當牆。
- **門**: 必須同時有「弧線」+「牆上缺口」兩個特徵。
- **窗**: 牆段中間「兩條平行細線」+ 牆缺口。
- **柱**: 「實心方塊 / 黑底方塊」才算,軸線交點不是柱。整層典型 8-20 根。**≥30 就是你錯,只保留最確定的 10-20 根**。

## Step 3 → 填 \`spaces\`:為每個 detected_label 找對應的房間多邊形

**這是關鍵 — 房間邊界規則必須遵守**:

✅ **正確邊界 = 圍繞此空間的「牆內側」連線**
   - 從牆角點到牆角點畫一圈封閉多邊形
   - **整個房間內部都框進去**,包含:家具區、桌椅 cluster、Lounge 角、走道內凹處
   - 邊界貼著牆走,不留空隙

❌ **錯誤邊界 (這幾條是這個任務最常見的地雷)**:
   1. **只框桌椅 cluster** ← 最常犯。桌椅佔房間的 50-70%,你框它會比真實房間小一半
   2. **只框文字標籤 bounding box** ← 比真實小 80%
   3. **跨牆把走道一起框進來** ← 走道不屬於這個房間
   4. **少數頂點切角** ← 應該緊貼牆內側,別偷工只給 3-4 個頂點
   5. **把橫向排列的小房間當「窄條」處理** ← 中央電梯井旁邊一排主管辦公室、顧問室,每個 2.7-3.3 坪,實際是 **3×3 米的方塊**,不是 3 米寬 × 0.5 米高的窄條!
   6. **高度被壓縮**:就算房間「視覺上看起來扁」(沿走廊排),也不可以給 height < 0.04 的多邊形

**📐 最小尺寸硬規則 (絕對遵守)**:
   - 每個 space 的 bbox **必須 width ≥ 0.04 AND height ≥ 0.04** (即至少 4% × 4% 圖面積)
   - 就算最小的洽談室、主管室,也是 ~3 米見方的空間,h 不可能 < 0.04
   - 寫完每個 space 的 vertices 後,**自己算 max(y) - min(y),如果 < 0.04 → 你錯了,重畫**

**檢核法**:你框完後想像「站在房間中央,從這個多邊形邊界到最近的牆有多遠?」應該是 0 (緊貼牆)。如果你心裡覺得「牆跟我框的邊界中間還有空間」→ 你框小了,重畫。

每個 space 必須帶 \`label_source\` 欄位,值是它對應的 detected_labels 裡某個 name(這樣可以追溯一對一關係)。

**完整性要求**:\`spaces.length\` 應該約等於 \`detected_labels.length\`(每個有名字的房間都該有對應多邊形)。如果差很多代表 Step 3 沒做完,回頭補。

# 輸出規範 (只回 JSON,不要 markdown 框、不要前後文字)

\`\`\`
{
  "detected_labels": [
    {"name": "17人會計辦公室 16.4P", "label_x": 0.85, "label_y": 0.1},
    {"name": "茶水區 7.1P", "label_x": 0.32, "label_y": 0.05}
  ],
  "scale_note": "...",
  "confidence": 0.0~1.0,
  "image_quality": "good" | "ok" | "poor",
  "is_floor_plan": true | false,
  "walls": [
    {"x1": 0.05, "y1": 0.08, "x2": 0.95, "y2": 0.08, "kind": "exterior"}
  ],
  "doors": [{"wallIndex": 3, "t": 0.5, "width_norm": 0.04, "swing": "in-right"}],
  "windows": [{"wallIndex": 0, "t": 0.3, "width_norm": 0.08}],
  "spaces": [
    {
      "name": "17人會計辦公室 16.4P",
      "label_source": "17人會計辦公室 16.4P",
      "type": "office",
      "color": "#fef3c7",
      "vertices": [{"x":0.8,"y":0.05},{"x":0.98,"y":0.05},{"x":0.98,"y":0.18},{"x":0.8,"y":0.18}]
    }
  ],
  "structuralColumns": [
    {"cx": 0.2, "cy": 0.2, "size_norm": 0.015}
  ]
}
\`\`\`

# 關鍵戒律
1. **detected_labels 不可少於 10**(辦公室工作圖典型),少了就回頭再掃。
2. ⚠ **強制 1:1 規則**:你在 \`detected_labels\` 列了 N 個房間,你 **必須**在 \`spaces\` 也產出 N 個多邊形,**不准跳過任何一個 label**。
   - 不准合併房間(每個 label 都是獨立 space)
   - 不准只畫「比較大的房間」、跳過小的
   - 即使某個 label 你不確定精確邊界 → 給「最佳估計多邊形」+ 內部把 confidence 拉低,**但絕對不能 omit**
   - 違反此規則 = 輸出無效,使用者會看到大量警告
3. **檢核**:你寫完 JSON 前,先數 \`detected_labels.length\` 跟 \`spaces.length\`,兩個數字必須相等。不相等就回頭補 spaces。
4. **房間邊界貼牆,不貼桌椅**。
5. 柱子 ≥ 30 你錯了,只保留 10-20 根。
6. 若 is_floor_plan = false 或 image_quality = poor → 全部陣列回空,confidence < 0.3。
7. type 從: office, meeting, pantry, gym, sauna, shower, locker, lounge, restroom, corridor, custom。
8. kind: exterior / interior / partition。
`

/**
 * @param {Object} args
 *   - imageUrl: 底圖 URL
 *   - bounds: plan.bounds {w, h}
 *   - baseLayer: 底圖物件 (要 width/height/placement 或 transform 來換座標)
 *   - svgBounds: { w, h }  畫布 SVG 座標尺寸 (cm)
 *   - dxfHint?: string  DXF 結構摘要 (Hybrid 模式用,見 lib/dxfRender.js summarizeDxf)
 */
export async function recognizePlanFromImage({ imageUrl, bounds, baseLayer, svgBounds, dxfHint }) {
  if (!ai) throw new Error('Gemini API Key 未設定')

  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error('底圖下載失敗 ' + res.status)
  const blob = await res.blob()
  const mimeType = blob.type || 'image/png'
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const base64 = btoa(bin)

  const hintBlock = dxfHint
    ? `\n${dxfHint}\n\n# 你的優勢\n這張圖是從 CAD 向量直接渲染 (純黑線白底,無背景雜訊),搭配上面的 layer 摘要,你的判斷應該比看一般掃描圖更有把握。`
    : ''

  const userPrompt = `看這張平面圖,辨識牆/門/窗/空間/柱位。

# 圖像尺寸
${baseLayer.width || '未知'} × ${baseLayer.height || '未知'} pixels

# 重要
- 用 normalized 0-1 座標,**不要**換算 cm。
- 我會自己把 0-1 換成最終座標。
- 你只要老老實實看圖,看到什麼說什麼。
${hintBlock}
請直接輸出 JSON。`

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: userPrompt }
      ]
    }],
    config: {
      systemInstruction: SYSTEM,
      temperature: 0.1,
      responseMimeType: 'application/json',
      // 25 個房間 × 8 vertex + walls + 其他 JSON 大約 5-8K tokens,
      // 預設 8192 邊緣,設大避免被截斷導致 AI 偷懶降採樣
      maxOutputTokens: 32768
    }
  })

  // Gemini SDK 提供 resp.text helper；保底直接掃 candidates
  const text = (resp.text
    || resp?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('')
    || '').trim()
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('Gemini 沒回有效 JSON: ' + text.slice(0, 200))
    parsed = JSON.parse(m[0])
  }

  // === debug 用:印 chain-of-thought 第一步結果 ===
  const labels = parsed.detected_labels || []
  const spaces = parsed.spaces || []
  console.log('[AI 識別] detected_labels:', labels.length, labels.map(l => l.name))
  console.log('[AI 識別] spaces:', spaces.length, spaces.map(s => s.name))
  if (labels.length > 0 && spaces.length < labels.length * 0.7) {
    console.warn(`[AI 識別] ⚠ 列了 ${labels.length} 個 labels 但只給 ${spaces.length} 個 spaces,AI 可能漏畫多邊形`)
  }
  if (labels.length < 8) {
    console.warn(`[AI 識別] ⚠ 只列出 ${labels.length} 個 labels (典型工作圖 15-30 個),可能漏掃`)
  }

  // 後處理:強制最小尺寸 — AI 對中央密集小房間常給 h < 0.03 的「窄條」,
  // 視覺上完全看不見。從多邊形中心點往外擴到至少 0.04 × 0.04,確保可見。
  const MIN_DIM = 0.04
  let extendedCount = 0
  spaces.forEach(s => {
    if (!s.vertices || s.vertices.length < 3) return
    const xs = s.vertices.map(v => v.x)
    const ys = s.vertices.map(v => v.y)
    const x1 = Math.min(...xs), x2 = Math.max(...xs)
    const y1 = Math.min(...ys), y2 = Math.max(...ys)
    const w = x2 - x1, h = y2 - y1
    if (w < MIN_DIM || h < MIN_DIM) {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
      const halfW = Math.max(MIN_DIM, w) / 2
      const halfH = Math.max(MIN_DIM, h) / 2
      s.vertices = [
        { x: cx - halfW, y: cy - halfH },
        { x: cx + halfW, y: cy - halfH },
        { x: cx + halfW, y: cy + halfH },
        { x: cx - halfW, y: cy + halfH }
      ]
      extendedCount++
    }
  })
  if (extendedCount > 0) {
    console.log(`[AI 識別] 後處理:${extendedCount} 個過小 space 被擴張到最小 0.04 × 0.04`)
  }

  // 印各 space 的 normalized bbox (在轉成 svg unit 前的原始 0-1 座標)
  // 用來診斷:同座標重複 / 太小 / 越界
  console.table(spaces.map(s => {
    const xs = (s.vertices || []).map(v => v.x)
    const ys = (s.vertices || []).map(v => v.y)
    if (xs.length === 0) return { name: s.name, pts: 0 }
    const x1 = Math.min(...xs), y1 = Math.min(...ys)
    const x2 = Math.max(...xs), y2 = Math.max(...ys)
    return {
      name: s.name,
      x1: +x1.toFixed(3), y1: +y1.toFixed(3),
      x2: +x2.toFixed(3), y2: +y2.toFixed(3),
      w: +(x2 - x1).toFixed(3),
      h: +(y2 - y1).toFixed(3),
      pts: xs.length
    }
  }))

  // 把 normalized 0-1 換成 plan canvas svg unit 座標
  // 新格式直接用 baseLayer.placement（跟 Canvas2D / Canvas3D / BaseLayerControls 一致）
  // 舊資料 fallback 用 transform 重算（保留相容）
  const W = baseLayer.width || svgBounds.w
  const H = baseLayer.height || svgBounds.h
  let p = baseLayer.placement
  if (!p) {
    const t = baseLayer.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
    const fit = Math.min((svgBounds.w * 0.9) / W, (svgBounds.h * 0.9) / H)
    const scale = fit * t.scale
    const drawW0 = W * scale, drawH0 = H * scale
    p = {
      offsetX: (svgBounds.w - drawW0) / 2 + t.x,
      offsetY: (svgBounds.h - drawH0) / 2 + t.y,
      drawW: drawW0,
      drawH: drawH0,
    }
  }
  const xOff = p.offsetX, yOff = p.offsetY
  const drawW = p.drawW, drawH = p.drawH

  function n2x(nx) { return Math.round(xOff + nx * drawW) }
  function n2y(ny) { return Math.round(yOff + ny * drawH) }
  const minSide = Math.min(drawW, drawH)

  return {
    scale_note: parsed.scale_note,
    confidence: parsed.confidence,
    walls: (parsed.walls || []).map(w => ({
      x1: n2x(w.x1), y1: n2y(w.y1), x2: n2x(w.x2), y2: n2y(w.y2),
      kind: w.kind || 'interior',
      thickness: w.kind === 'exterior' ? 24 : w.kind === 'partition' ? 8 : 12
    })),
    doors: (parsed.doors || []).map(d => ({
      wallIndex: d.wallIndex, t: d.t, swing: d.swing || 'in-right',
      width: Math.round((d.width_norm || 0.04) * minSide / 100 * 100)
    })),
    windows: (parsed.windows || []).map(w => ({
      wallIndex: w.wallIndex, t: w.t, sillHeight: 90,
      width: Math.round((w.width_norm || 0.08) * minSide / 100 * 100)
    })),
    spaces: (parsed.spaces || []).map(s => ({
      name: s.name, type: s.type || 'custom',
      color: s.color || '#e2e8f0',
      vertices: (s.vertices || []).map(v => ({ x: n2x(v.x), y: n2y(v.y) }))
    })).filter(s => s.vertices.length >= 3),
    structuralColumns: (parsed.structuralColumns || []).map(c => {
      const size = (c.size_norm || 0.015) * minSide
      return {
        x: Math.round(n2x(c.cx) - size / 2),
        y: Math.round(n2y(c.cy) - size / 2),
        w: Math.round(size), h: Math.round(size)
      }
    })
  }
}
