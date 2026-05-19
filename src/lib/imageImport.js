/**
 * 批次匯入參考圖到案例庫 — 含 AI Vision 自動標籤
 *
 * 流程:
 *   1. 使用者批次拖一堆圖進來
 *   2. 每張上傳到 Supabase Storage (plan-assets bucket)
 *   3. 對每張呼叫 Claude Vision 產生:
 *      - 描述 (10-30 字)
 *      - 空間類型 (office/spa/...)
 *      - 風格標籤
 *      - 文件類型 (reference/construction/as_built/concept/...)
 *   4. 寫進 reference_cases 表
 */
import { supabase } from './supabase.js'
import Anthropic from '@anthropic-ai/sdk'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const apiKey = import.meta.env.VITE_CLAUDE_API_KEY
const client = apiKey ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : null

const BUCKET = 'plan-assets'

export const DOC_TYPES = [
  { value: 'reference',    label: '📌 純參考圖 (網路/雜誌靈感)', hint: '無實際施作,只是收藏的靈感圖' },
  { value: 'inspiration',  label: '✨ 設計參考',                 hint: '已開始發想中的方向' },
  { value: 'concept',      label: '💡 概念設計',                 hint: '正在草擬的方案,還沒定案' },
  { value: 'construction', label: '🏗 施工圖',                   hint: '工地實際在用的圖' },
  { value: 'as_built',     label: '✅ 完工竣工圖',               hint: '已完工的東森案場記錄' },
  { value: 'existing',     label: '📐 既有現況圖',               hint: '改建前的現況' },
  { value: 'demolition',   label: '🔨 拆除圖',                   hint: '改建時的拆除範圍' }
]
export const ERAS = [
  { value: 'current',    label: '📅 現行中 (使用中的案場)' },
  { value: 'historical', label: '📜 歷史 (已過時/已拆/已改建)' },
  { value: 'planned',    label: '🎯 規劃中 (未完工)' },
  { value: 'reference',  label: '🌐 純參考 (非東森案場)' }
]

/**
 * 把 File 上傳到 storage,回傳 { storagePath, signedUrl }
 */
async function uploadOne(file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const storagePath = `${user.id}/library/${ts}_${Math.random().toString(36).slice(2,8)}_${safeName}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(storagePath, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)
  return { storagePath, signedUrl: signed.signedUrl, mimeType: file.type || 'image/png' }
}

/**
 * PDF 轉成 PNG (取第一頁) 給 AI 看
 */
async function pdfToPng(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const page = await pdf.getPage(1)
  const vp = page.getViewport({ scale: 1.5 })
  const canvas = document.createElement('canvas')
  canvas.width = vp.width; canvas.height = vp.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
  return new Promise((res) => canvas.toBlob(b => res(b), 'image/png'))
}

/**
 * 用 Claude Vision 分析一張圖,回傳結構化標籤
 */
async function analyzeImageWithAI(blob) {
  if (!client) return null
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const base64 = btoa(bin)
  const mimeType = blob.type || 'image/png'

  const resp = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 800,
    system: `你是建築設計圖辨識引擎。看一張圖,輸出嚴格 JSON (無前後文字、無 markdown):

{
  "summary": "10-30字簡潔描述這張圖",
  "doc_type": "reference|inspiration|concept|construction|as_built|existing|demolition",
  "era": "current|historical|planned|reference",
  "space_types": ["office","meeting","spa",...],
  "style_tags": ["日式","現代","禪意",...],
  "extracted_text": "圖上能看到的關鍵文字 (例如 平面圖標題)",
  "confidence": 0.0~1.0
}

# 判斷規則
- **doc_type**:
  * "construction" (施工圖):有尺寸標註、軸線編號、剖面/節點、施工註記
  * "as_built" (竣工圖):類似施工圖但標註「竣工」「完工記錄」
  * "concept" (概念):3D 渲染、效果圖、SketchUp 風格
  * "inspiration" (靈感):雜誌風、Pinterest 風、純美感照片
  * "reference" (純參考):無法判斷或就是收藏圖
  * "existing" (現況):標註「現況」「改前」
  * "demolition" (拆除):標註「拆除範圍」「demolition」紅色斜線
- **era**:
  * "current": 看起來像現行使用中的場
  * "historical": 老舊圖、已過時設計
  * "planned": 正在規劃中
  * "reference": 純參考圖
- **space_types**: 從以下選: office, meeting, pantry, gym, sauna, shower, locker, lounge, restroom, corridor, lobby, bedroom, living, kitchen, restaurant, clinic, custom
- 寧可給空陣列也不要瞎猜`,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: '請辨識這張圖,輸出 JSON。' }
      ]
    }]
  })
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  } catch (e) {}
  return null
}

/**
 * 批次匯入主流程
 * @param {File[]} files
 * @param {Object} defaults — 使用者預先選的 doc_type/era/project 等套用所有檔
 * @param {Function} onProgress (idx, total, status) — 每張處理進度
 */
export async function batchImportImages(files, defaults = {}, onProgress = () => {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')

  const results = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress(i, files.length, `上傳 ${file.name}…`)
    try {
      // 1. 上傳原檔
      const { storagePath, signedUrl, mimeType } = await uploadOne(file)
      // 2. 取得「給 AI 看」的圖 (PDF 要轉 PNG)
      let imageBlob = file
      if (file.name.toLowerCase().endsWith('.pdf')) {
        onProgress(i, files.length, `${file.name}: 轉換 PDF…`)
        imageBlob = await pdfToPng(file)
      }
      // 3. AI 分析
      onProgress(i, files.length, `${file.name}: AI 分析中…`)
      let ai = null
      try { ai = await analyzeImageWithAI(imageBlob) }
      catch (e) { console.warn('AI 分析失敗', file.name, e) }

      // 4. 寫入 reference_cases
      const insertData = {
        owner: user.id,
        title: ai?.extracted_text || file.name.replace(/\.[^.]+$/, ''),
        description: defaults.description || ai?.summary || '',
        space_types: ai?.space_types || [],
        tags: defaults.tags || [],
        doc_type: defaults.doc_type || ai?.doc_type || 'reference',
        era: defaults.era || ai?.era || 'reference',
        project: defaults.project || '',
        year: defaults.year || null,
        style_tags: ai?.style_tags || defaults.style_tags || [],
        ai_summary: ai?.summary || '',
        ai_extracted_tags: ai ? Object.values(ai).filter(x => typeof x === 'string').slice(0, 3) : [],
        attachments: [signedUrl],
        thumbnail_url: signedUrl
      }
      const { data, error } = await supabase.from('reference_cases').insert(insertData).select().single()
      if (error) {
        console.error('插入失敗', file.name, error)
        results.push({ file: file.name, ok: false, error: error.message })
      } else {
        results.push({ file: file.name, ok: true, id: data.id, ai })
      }
    } catch (e) {
      console.error(e)
      results.push({ file: file.name, ok: false, error: e.message })
    }
  }
  onProgress(files.length, files.length, '完成')
  return results
}
