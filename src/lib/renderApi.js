/**
 * 渲染圖 API — 用 Google Gemini Imagen 4
 * 申請:https://aistudio.google.com
 * 免費 tier 每天 50 張
 */
import { GoogleGenAI } from '@google/genai'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
export const renderReady = Boolean(API_KEY)

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null

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

  const response = await ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: fullPrompt,
    config: {
      numberOfImages: 1,
      aspectRatio: '16:9',  // 室內渲染橫向比較好看
      personGeneration: 'dont_allow'  // 不出現人,純空間
    }
  })

  const images = response.generatedImages
  if (!images?.length) throw new Error('Gemini 沒回圖片')
  const imgBytes = images[0].image.imageBytes
  // imgBytes 是 base64,組成 data URL
  return `data:image/png;base64,${imgBytes}`
}

/**
 * 從目前平面圖渲染 — 把使用者的 2D 平面 (SVG → PNG) 當參考送給 Gemini Nano Banana。
 * Gemini 會「看圖+依風格生擬真渲染」,結構大致跟著你的平面走。
 * @param {Object} args
 *   - planImageDataUrl: 你的平面圖 base64 (從 exportCanvasToPng 來)
 *   - plan: 目前方案 (用來抽空間資訊塞 prompt)
 *   - style: 風格 id
 *   - extra: 額外描述
 *   - viewType: 'plan' (從上俯瞰) | 'interior' (站在室內看) — 預設 interior
 */
export async function renderFromPlan({ planImageDataUrl, plan, style = 'modern', extra = '', viewType = 'interior' }) {
  if (!ai) throw new Error('Gemini API Key 未設定')
  const stylePrompt = STYLE_PRESETS.find(s => s.id === style)?.prompt || ''

  // 從 plan 抽空間清單,做為 prompt 上下文
  const spaceList = (plan.spaces || []).map(sp => {
    const w = sp.w || 0, h = sp.h || 0
    const area = (w * h / 10000).toFixed(1)
    return `${sp.name} (${area}m²)`
  }).join(', ')

  const viewInstr = viewType === 'plan'
    ? 'Render this as a high-quality top-down architectural floor plan visualization, photorealistic materials and lighting.'
    : 'Render this floor plan as a photorealistic interior space, viewed from inside at human eye level (about 1.6m height), wide-angle 24mm lens, natural composition.'

  const fullPrompt = [
    'I will show you a 2D floor plan image. Based on this layout, generate a photorealistic interior rendering.',
    viewInstr,
    spaceList ? `The spaces in this plan are: ${spaceList}.` : '',
    `Style: ${stylePrompt}.`,
    extra ? `Additional notes: ${extra}` : '',
    'Preserve the spatial relationships, room proportions, and overall layout from the floor plan. Do not include any text, watermarks, or numbers in the output.'
  ].filter(Boolean).join(' ')

  // 把平面圖 data URL 拆成 base64
  const match = planImageDataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) throw new Error('平面圖格式不對')
  const mimeType = match[1], imageBase64 = match[2]

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [
      { inlineData: { data: imageBase64, mimeType } },
      { text: fullPrompt }
    ]
  })

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
    }
  }
  throw new Error('Gemini 沒回圖片')
}

/**
 * 基於既有圖片做編輯 (Nano Banana / Gemini 2.5 Flash Image 強項)
 * @param {string} imageUrl - 現有渲染圖 (data URL 或 https url)
 * @param {string} editPrompt - 想改什麼 (例:「把牆換成木質」)
 */
export async function editRender({ imageUrl, editPrompt }) {
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

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [
      { inlineData: { data: imageBase64, mimeType } },
      { text: editPrompt }
    ]
  })

  // 找到回應裡的圖片
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
    }
  }
  throw new Error('Gemini 沒回編輯後的圖片')
}
