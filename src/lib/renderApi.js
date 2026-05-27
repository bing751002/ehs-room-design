/**
 * 渲染圖 API — 用 Google Gemini Imagen 4
 * 申請:https://aistudio.google.com
 * 免費 tier 每天 50 張
 */
import { GoogleGenAI } from '@google/genai'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
export const renderReady = Boolean(API_KEY)

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null

/**
 * 統一友善錯誤包裝
 */
function friendlyError(e) {
  const raw = (e?.message || String(e))
  // Quota 429
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(raw)) {
    // 嘗試抽出 retryDelay 秒數
    const m = raw.match(/retry\s*[Dd]elay[":\s]*['"]?(\d+)s/) ||
              raw.match(/retry in (\d+)s/i) ||
              raw.match(/(\d+)s/)
    const retryHint = m ? `(請等約 ${m[1]} 秒後再試,或明天再來)` : '(可能要等幾分鐘到一天才會 reset)'
    return new Error(
      `⚠ Google 免費 quota 用完了 ${retryHint}\n\n` +
      `解決方案:\n` +
      `1. 等 Google 配額重置 (每分鐘/每日 reset)\n` +
      `2. 到 https://aistudio.google.com 升級為付費 tier ($)\n` +
      `3. 或換成其他 image API (我們之後可接 fal.ai / OpenAI)`
    )
  }
  if (/API key/i.test(raw)) {
    return new Error('Gemini API Key 無效,請確認 .env 設定。')
  }
  if (/safety|SAFETY|blocked/i.test(raw)) {
    return new Error('Gemini 認為這個 prompt 違反安全規則被擋住,請改個描述試試。')
  }
  return new Error('渲染失敗:' + raw.slice(0, 200))
}

// 風格預設
const STYLE_PRESETS = [
  { id: 'modern',       label: '現代簡約',  prompt: 'modern minimalist interior, clean lines, neutral palette, soft natural light, photorealistic, 4k' },
  { id: 'japanese',     label: '日式禪意',  prompt: 'japanese zen interior, wabi-sabi, natural wood, paper lanterns, soft warm lighting, photorealistic 8k' },
  { id: 'luxury',       label: '五星飯店',  prompt: 'five-star luxury hotel interior, marble floor, ambient lighting, plush furniture, gold accents, photorealistic 4k' },
  { id: 'industrial',   label: '工業風',    prompt: 'industrial loft interior, exposed brick, concrete, edison bulbs, metal accents, photorealistic 4k' },
  { id: 'scandinavian', label: '北歐風',    prompt: 'scandinavian interior, white walls, light wood, cozy textiles, natural daylight, photorealistic 4k' },
  { id: 'spa',          label: 'SPA 禪',    prompt: 'luxury spa interior, soft warm lighting, stone and water elements, towels and candles, steam, photorealistic 4k' },
  { id: 'office',       label: '現代辦公',  prompt: 'modern office interior, ergonomic furniture, glass partitions, plants, abundant natural light, photorealistic 4k' },
  { id: 'restaurant',   label: '高級餐廳',  prompt: 'upscale restaurant interior, ambient warm lighting, well-set tables, elegant decor, photorealistic 4k' },
  { id: 'gym',          label: '健身房',    prompt: 'modern gym interior, rubber flooring, mirrors, exercise machines, dynamic lighting, photorealistic 4k' }
]
export function getStylePresets() { return STYLE_PRESETS }

/**
 * 文字 → 渲染圖
 */
export async function generateRender({ prompt, style = 'modern' }) {
  if (!ai) throw new Error('Gemini API Key 未設定')
  const stylePrompt = STYLE_PRESETS.find(s => s.id === style)?.prompt || ''
  const fullPrompt = [prompt, stylePrompt].filter(Boolean).join(', ')

  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: fullPrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '16:9',
        personGeneration: 'dont_allow'
      }
    })
    const images = response.generatedImages
    if (!images?.length) throw new Error('Gemini 沒回圖片')
    const imgBytes = images[0].image.imageBytes
    return `data:image/png;base64,${imgBytes}`
  } catch (e) { throw friendlyError(e) }
}

/**
 * 視角預設 — 給 renderFromPlan 用,讓使用者選不同角度生圖
 */
export const VIEW_PRESETS = [
  {
    id: 'interior_wide',
    label: '🏠 室內全景 (站著看)',
    desc: '從空間內部、人眼高度 (1.6m)、24mm 廣角鏡頭',
    prompt: 'photorealistic interior rendering viewed from INSIDE the space at human eye level (1.6m height), wide-angle 24mm lens, natural composition showing the room atmosphere'
  },
  {
    id: 'interior_corner',
    label: '🏠 室內角落 (進門視角)',
    desc: '站在主入口進門位置看整個空間',
    prompt: 'photorealistic interior rendering from the main entrance looking into the space, eye-level (1.6m), 28mm lens, showing the entryway perspective'
  },
  {
    id: 'topdown_3d',
    label: '📐 3D 俯瞰 (酷家樂式)',
    desc: '從上方斜 45° 看整個樓層,沒有屋頂',
    prompt: 'photorealistic 3D isometric floor plan view from 45-degree angle above, no roof shown, full layout visible like a doll house, architectural visualization style (similar to Kujiale or Planner5D), all rooms and furniture visible'
  },
  {
    id: 'topdown_flat',
    label: '🗺 2D 渲染平面 (建築展示版)',
    desc: '純俯視,但加上材質、光影,像建築事務所的成果圖',
    prompt: 'top-down architectural floor plan visualization with realistic materials, textures, and soft shadows, like an architect presentation board, no perspective distortion'
  },
  {
    id: 'walk_through',
    label: '🚶 漫遊風 (走廊深透)',
    desc: '從一個空間望向另一個的長走廊感',
    prompt: 'cinematic photorealistic interior rendering with depth, viewer standing in one room looking through a doorway into another, sense of journey and depth, 35mm lens'
  }
]
export function getViewPresets() { return VIEW_PRESETS }

/**
 * 從目前平面圖渲染 — Nano Banana (gemini-2.5-flash-image) 看 plan 截圖直接生 3D 渲染。
 * 這是「酷家樂式」核心:結構照你 plan、材質+光照交給 AI。
 *
 * @param {Object} args
 *   - planImageDataUrl: plan 截圖 base64
 *   - plan: 方案物件 (抽空間/尺寸資訊塞 prompt 增強對齊)
 *   - style: 風格 id (見 STYLE_PRESETS)
 *   - viewType: 視角 id (見 VIEW_PRESETS),預設 'interior_wide'
 *   - focusSpace: 要 zoom 到的空間名稱 (可選,例 "主展廳")
 *   - extra: 額外描述
 */
/**
 * 模型選擇 (2026/05 最新 Google 官方型號)
 * - nano-banana   = Gemini 2.5 Flash Image (舊版,但穩定便宜)
 * - nano-banana-2 = Gemini 3.1 Flash Image Preview (新!介於 Flash 與 Pro 之間,推薦預設)
 * - nano-banana-pro = Gemini 3 Pro Image Preview (最高品質,給總裁最終版用)
 */
export const MODEL_PRESETS = [
  {
    id: 'nano-banana',
    label: '⚡ Nano Banana (舊版/最便宜)',
    desc: 'Gemini 2.5 Flash · ~10 秒 · $0.04/張 · 大量批次測試',
    model: 'gemini-2.5-flash-image'
  },
  {
    id: 'nano-banana-2',
    label: '🍌 Nano Banana 2 (新版預設)',
    desc: 'Gemini 3.1 Flash · ~10 秒 · 比舊版品質好很多 · 日常推薦',
    model: 'gemini-3.1-flash-image-preview'
  },
  {
    id: 'nano-banana-pro',
    label: '💎 Nano Banana Pro (最高品質)',
    desc: 'Gemini 3 Pro · ~20 秒 · 約 $0.10/張 · 給總裁/客戶最終版',
    model: 'gemini-3-pro-image-preview'
  }
]
export function getModelPresets() { return MODEL_PRESETS }

export async function renderFromPlan({
  planImageDataUrl, plan,
  style = 'modern',
  styleCustom = '',
  modelId = 'nano-banana-2',
  viewType = 'interior_wide',
  focusSpace = '', extra = ''
}) {
  if (!ai) throw new Error('Gemini API Key 未設定')
  // 風格:純自由描述 (styleCustom) — 預設按鈕現在只是 quick add
  // 若 styleCustom 完全空白,fallback 用 style 的預設文字
  const presetPrompt = STYLE_PRESETS.find(s => s.id === style)?.prompt || ''
  const stylePrompt = styleCustom.trim() || presetPrompt || 'modern interior, photorealistic'
  const viewPrompt = VIEW_PRESETS.find(v => v.id === viewType)?.prompt || VIEW_PRESETS[0].prompt
  const modelName = MODEL_PRESETS.find(m => m.id === modelId)?.model || 'gemini-2.5-flash-image'

  // 抽空間清單 (含真實尺寸,Gemini 才知比例) — 用 svg unit + svgUnitToRealCm 換算
  const f = plan.svgUnitToRealCm || 1
  const spaces = (plan.spaces || []).map(sp => {
    const vs = sp.vertices?.length >= 3 ? sp.vertices : null
    let wM = 0, hM = 0
    if (vs) {
      const xs = vs.map(v => v.x), ys = vs.map(v => v.y)
      wM = (Math.max(...xs) - Math.min(...xs)) * f / 100
      hM = (Math.max(...ys) - Math.min(...ys)) * f / 100
    } else if (sp.w && sp.h) {
      wM = sp.w * f / 100; hM = sp.h * f / 100
    }
    return `${sp.name || '空間'} (${(wM * hM).toFixed(1)}m², ${wM.toFixed(1)}×${hM.toFixed(1)}m)`
  }).filter(Boolean).join('; ')

  const totalBounds = plan.bounds
    ? `Floor total bounds: ${(plan.bounds.w * f / 100).toFixed(1)}×${(plan.bounds.h * f / 100).toFixed(1)}m.`
    : ''

  // ⚠️ 關鍵 prompt 重寫:
  // 1. 把 plan 圖當「控制圖 (control image)」明示給 AI
  // 2. 強化 IGNORE-IS-FAILURE 措辭,Nano Banana 對這類指令敏感
  // 3. 把空間文字清單砍掉,避免 AI 把它當作「自由發揮的房型清單」
  // 4. 圖片放在 prompt 之前、prompt 中再次提及「ABOVE」雙重強調
  const fullPrompt = [
    '# TASK: Convert a 2D architectural floor plan into a photorealistic 3D rendering',
    '',
    '## INPUT IMAGE (ABOVE):',
    'The image attached at the top of this message IS the floor plan you must follow. It shows:',
    '- Wall layout (the lines)',
    '- Room boundaries and labels (Chinese text marking each space)',
    '- Doors, windows, openings',
    '- Pillars / structural elements',
    'THIS IMAGE IS A STRICT CONTROL — not a suggestion.',
    '',
    '## ABSOLUTE RULES (violating any = failure):',
    '1. Your output MUST share the same overall floor shape as the input image (L-shape, rectangle, ㄇ-shape, etc.)',
    '2. The number of rooms and their positions MUST match the input',
    '3. Room proportions (which is big, which is small) MUST match',
    '4. Wall positions, door/window locations MUST be respected',
    '5. If the input shows a core (central elevator/staircase block), your render MUST also show walls/rooms wrapping around it',
    '6. DO NOT invent a generic interior. DO NOT ignore the layout and just produce "a nice modern office".',
    '',
    '## WHAT YOU CAN FREELY ADD (use the style guide below):',
    '- Materials: floor type, wall finish, ceiling',
    '- Lighting: natural sun direction, fixtures',
    '- Furniture: chairs, sofas, desks (placed inside the existing rooms)',
    '- Decoration: plants, artwork, textures',
    '- Time of day mood',
    '',
    '## RENDER VIEW:',
    viewPrompt,
    '',
    '## STYLE:',
    stylePrompt,
    '',
    totalBounds,
    focusSpace ? `## FOCUS:\nZoom your camera into the "${focusSpace}" area, but the layout of surrounding rooms must still be recognizable in the background.` : '',
    extra ? `## CLIENT NOTES:\n${extra}` : '',
    '',
    '## OUTPUT:',
    '- 4K photorealistic',
    '- Architectural visualization quality (D5 Render / Kujiale / Lumion level)',
    '- NO text, NO watermarks, NO arrows, NO numbers in the rendered image',
    '- The viewer should immediately recognize "this is the same floor plan as the input, just rendered in 3D with materials"'
  ].filter(Boolean).join('\n')

  const match = planImageDataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) throw new Error('平面圖格式不對')
  const mimeType = match[1], imageBase64 = match[2]

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        // 圖放最前面 — Gemini 對開頭內容權重最高
        { inlineData: { data: imageBase64, mimeType } },
        { text: fullPrompt },
        // 再放一次圖 — 強化「這張圖是必看的 reference」
        { inlineData: { data: imageBase64, mimeType } },
        { text: '↑ 再次強調:你必須依照這張平面圖的形狀、房間數、房間位置去生圖。輸出的 3D 空間布局必須跟這張圖一模一樣,只是換成寫實材質與光照。' }
      ]
    })
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
      }
    }
    throw new Error('Gemini 沒回圖片 — 可能 prompt 被 safety 擋,試簡化描述')
  } catch (e) { throw friendlyError(e) }
}

/**
 * 基於既有圖片做編輯 (Nano Banana / Gemini 2.5 Flash Image 強項)
 * @param {string} imageUrl - 現有渲染圖 (data URL 或 https url)
 * @param {string} editPrompt - 想改什麼 (例:「把牆換成木質」)
 */
export async function editRender({ imageUrl, editPrompt, modelId = 'nano-banana-2' }) {
  if (!ai) throw new Error('Gemini API Key 未設定')
  // 把 image 轉成 base64
  let imageBase64, mimeType = 'image/png'
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.*)$/)
    mimeType = match[1]; imageBase64 = match[2]
  } else {
    const res = await fetch(imageUrl)
    if (!res.ok) throw new Error('下載原圖失敗')
    mimeType = res.headers.get('content-type') || 'image/png'
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    imageBase64 = btoa(bin)
  }

  const modelName = MODEL_PRESETS.find(m => m.id === modelId)?.model || 'gemini-2.5-flash-image'
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        { inlineData: { data: imageBase64, mimeType } },
        { text: editPrompt }
      ]
    })
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
      }
    }
    throw new Error('Gemini 沒回編輯後的圖片')
  } catch (e) { throw friendlyError(e) }
}
