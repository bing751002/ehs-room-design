/**
 * AI 識別圖紙生戶型
 *
 * 改良版策略:
 *  - AI 不再估算 cm 座標,改用「圖像 normalized 0-1」座標
 *  - 我們再把 0-1 用底圖 transform 換成 plan canvas 的 cm
 *  - 這樣 AI 只要看圖,不必算比例尺
 */
import Anthropic from '@anthropic-ai/sdk'

const apiKey = import.meta.env.VITE_CLAUDE_API_KEY
const client = apiKey ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : null

const SYSTEM = `你是嚴謹的建築平面圖辨識引擎。**準確 > 完整,缺項 > 錯項**。

# 座標系統 (重要!)
**所有座標都用 normalized [0, 1] 圖像座標**:
- (0, 0) = 圖像「左上角」(0% 左, 0% 上)
- (1, 1) = 圖像「右下角」(100% 右, 100% 下)
- 不要估算 cm,**就用 0-1 描述「在圖上什麼位置」**

# 重要工作流程
**Step 1 先誠實評估這張圖**:
- 是否模糊 / 大小傾斜 / 解析度低?
- 是否非標準平面圖 (3D 渲染、效果圖、施工剖面、scan 不清楚) → 直接回空結果 + 低 confidence

**Step 2 才開始辨識** (有信心才畫):
- **柱子**:看到「實心方塊 / 黑底方塊 / 軸線交點處的小方塊」才算。**不是每個交叉點都是柱子!** 軸線交叉只是參考線。**只回明確看見的柱子,寧可漏掉**。常見:整層 8-20 根,排成規則網格 (例如 4 列 × 5 排)。如果你看到 ≥ 30 個 columns,**你錯了**,請只保留最明顯的。
- **牆**:外牆是最外圈的粗黑實線;內牆是房間之間的較細實線。不要把家具線、設備邊框、軸線當牆。
- **門**:必須同時有「弧線」+「牆上缺口」兩個特徵才算。
- **窗**:牆段中間「兩條平行細線」+ 牆缺口。
- **空間**:只標**圖上有中文標籤的房間**(例如「主臥」「茶水間」)。看不到名字的不要硬加。

# 輸出規範
**只回 JSON,不要 markdown 框、不要前後文字**:

\`\`\`
{
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
      "name": "主臥",
      "type": "lounge",
      "color": "#fef3c7",
      "vertices": [{"x":0.1,"y":0.1},{"x":0.4,"y":0.1},{"x":0.4,"y":0.4},{"x":0.1,"y":0.4}]
    }
  ],
  "structuralColumns": [
    {"cx": 0.2, "cy": 0.2, "size_norm": 0.015}
  ]
}
\`\`\`

# 關鍵戒律
1. **柱子上限:**如果整張圖你判斷有 > 30 根柱子,你一定錯,**只回最確定的 10-20 根**。
2. 若 is_floor_plan = false 或 image_quality = poor → 全部陣列回空,confidence < 0.3。
3. type 從: office, meeting, pantry, gym, sauna, shower, locker, lounge, restroom, corridor, custom。
4. kind: exterior / interior / partition。
5. **寧可給空陣列也不要瞎猜**。confidence < 0.5 時使用者會被警告。
`

/**
 * @param {Object} args
 *   - imageUrl: 底圖 URL
 *   - bounds: plan.bounds {w, h}
 *   - baseLayer: 底圖物件 (要 width/height/transform 來換座標)
 *   - svgBounds: { w, h }  畫布 SVG 座標尺寸 (cm)
 */
export async function recognizePlanFromImage({ imageUrl, bounds, baseLayer, svgBounds }) {
  if (!client) throw new Error('Claude API Key 未設定')

  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error('底圖下載失敗 ' + res.status)
  const blob = await res.blob()
  const mimeType = blob.type || 'image/png'
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const base64 = btoa(bin)

  const userPrompt = `看這張平面圖,辨識牆/門/窗/空間/柱位。

# 圖像尺寸
${baseLayer.width || '未知'} × ${baseLayer.height || '未知'} pixels

# 重要
- 用 normalized 0-1 座標,**不要**換算 cm。
- 我會自己把 0-1 換成最終座標。
- 你只要老老實實看圖,看到什麼說什麼。

請直接輸出 JSON。`

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: userPrompt }
      ]
    }]
  })

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('AI 沒回有效 JSON: ' + text.slice(0, 200))
    parsed = JSON.parse(m[0])
  }

  // 把 normalized 0-1 換成 plan canvas cm 座標
  // 底圖在 SVG 中的實際 render box:
  //   width=baseLayer.width, height=baseLayer.height (image px)
  //   fit = min(svgW*0.9/W, svgH*0.9/H)
  //   scale = fit * t.scale
  //   drawW = W * scale
  //   x_offset = (svgW - drawW)/2 + t.x   (image 左上角的 svg x)
  const W = baseLayer.width || svgBounds.w
  const H = baseLayer.height || svgBounds.h
  const t = baseLayer.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
  const fit = Math.min((svgBounds.w * 0.9) / W, (svgBounds.h * 0.9) / H)
  const scale = fit * t.scale
  const drawW = W * scale, drawH = H * scale
  const xOff = (svgBounds.w - drawW) / 2 + t.x
  const yOff = (svgBounds.h - drawH) / 2 + t.y

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
      width: Math.round((d.width_norm || 0.04) * minSide / 100 * 100)  // 0-1 → cm
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
