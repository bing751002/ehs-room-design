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

const SYSTEM = `你是建築平面圖辨識引擎。看一張平面圖,輸出 JSON 描述其中的牆/門/窗/空間/結構柱。

# 座標系統 (重要!)
**所有座標都用 normalized [0, 1] 圖像座標**:
- (0, 0) = 圖像左上角
- (1, 1) = 圖像右下角
- 不要估算 cm,**就用 0-1 描述「在圖上什麼位置」**

# 輸出規範
**只回 JSON,不要 markdown 框、不要前後文字**:

\`\`\`
{
  "scale_note": "你看到的軸線標註與比例線索",
  "confidence": 0.7,
  "walls": [
    {"x1": 0.05, "y1": 0.08, "x2": 0.95, "y2": 0.08, "kind": "exterior"}
  ],
  "doors": [
    {"wallIndex": 3, "t": 0.5, "width_norm": 0.04, "swing": "in-right"}
  ],
  "windows": [
    {"wallIndex": 0, "t": 0.3, "width_norm": 0.08}
  ],
  "spaces": [
    {
      "name": "辦公室",
      "type": "office",
      "color": "#bfdbfe",
      "vertices": [{"x":0.1,"y":0.1},{"x":0.4,"y":0.1},{"x":0.4,"y":0.4},{"x":0.1,"y":0.4}]
    }
  ],
  "structuralColumns": [
    {"cx": 0.2, "cy": 0.2, "size_norm": 0.015}
  ]
}
\`\`\`

# 重要原則
1. **準確至上,寧缺勿濫**: 看不清楚的不要硬加,寧可少。confidence 設低 (例 0.3) 也比假裝高分好。
2. **牆 = 圖上實際畫出的牆線**(實線、雙線、厚線)。不要把家具邊緣、車道、外框當牆。
3. **門 = 圓弧 + 牆上缺口** 同時出現。沒看到弧不要硬加門。
4. **窗 = 牆上兩條平行線中間有縫**。
5. **空間命名只用看得到的中文/英文字標籤**,看不到字就用 type 當名稱(例如 "辦公區")。
6. **不要編造**任何沒看到的房間。**寧可只給 3 個準的,不要給 15 個亂的**。
7. width_norm / size_norm 也是 0-1 (相對於圖像短邊)。
8. type 從: office, meeting, pantry, gym, sauna, shower, locker, lounge, restroom, corridor, custom。
9. kind: exterior (外牆) / interior (內牆) / partition (輕隔間)。

# 看不到/不確定就回空陣列
寧可給空陣列也不要瞎猜。
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
