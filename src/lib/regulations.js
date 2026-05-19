/**
 * 法規庫 CRUD + RAG 檢索
 */
import { supabase } from './supabase.js'
import { extractForAI } from './fileExtract.js'

export const REG_CATEGORIES = [
  { value: '建築',     label: '🏗 建築 (建築技術規則...)' },
  { value: '消防',     label: '🚒 消防 (各類場所消防安全設備設置標準...)' },
  { value: '無障礙',   label: '♿ 無障礙設施' },
  { value: '室內裝修', label: '🪑 室內裝修管理辦法' },
  { value: '勞安',     label: '⛑ 勞工安全衛生' },
  { value: '環保',     label: '🌱 環保 / 廢棄物' },
  { value: 'SPA/三溫暖', label: '♨️ SPA / 三溫暖規範' },
  { value: '餐飲',     label: '🍽 餐飲業規範' },
  { value: '健身',     label: '💪 運動健身場館' },
  { value: '酒店',     label: '🏨 觀光旅館 / 民宿' },
  { value: '診所',     label: '🏥 醫療機構' },
  { value: '其他',     label: '其他' }
]

export async function listRegulations({ activeOnly = true } = {}) {
  let q = supabase.from('regulations').select('*')
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) {
    if (error.code === 'PGRST205' || /regulations/i.test(error.message || '')) {
      console.warn('[regulations] regulations 表還沒建,請跑 supabase/regulations_schema.sql')
      return []
    }
    throw error
  }
  return data || []
}

export async function createRegulation(input) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const { data, error } = await supabase.from('regulations').insert({
    owner: user.id, ...input
  }).select().single()
  if (error) throw error
  return data
}

export async function updateRegulation(id, patch) {
  const { data, error } = await supabase.from('regulations').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function removeRegulation(id) {
  const { error } = await supabase.from('regulations').delete().eq('id', id)
  if (error) throw error
}

/** 上傳附件 (PDF/Word) 並抽出文字 — 自動帶進 form */
const BUCKET = 'plan-assets'
export async function uploadRegulationFile(file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const path = `${user.id}/regulations/${ts}_${safeName}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5)  // 5 年有效
  // 同時抽文字
  let extracted = ''
  try {
    const data = await extractForAI(file)
    if (data.type === 'text') extracted = data.text
  } catch (e) { console.warn('抽文字失敗', e) }
  return { url: signed.signedUrl, extractedText: extracted }
}

/**
 * 把 active 法規格式化成 prompt — 用「摘要」優先,避免太長爆 token
 */
export function regsToPromptText(regs, applicableTypes = []) {
  if (!regs?.length) return ''
  // 只挑跟當前規劃相關的 (空間類型對得到)
  let filtered = regs
  if (applicableTypes.length) {
    filtered = regs.filter(r => {
      if (!r.applies_to_space_types?.length) return true  // 全用適用
      return r.applies_to_space_types.some(t => applicableTypes.includes(t))
    })
  }
  if (!filtered.length) return ''

  const lines = [
    '\n\n# 📖 適用法規 (從法規庫檢索,規劃必須遵守)',
    '> 這些是政府公告的強制性法規,違反會被罰或無法營業',
    filtered.slice(0, 15).map(r => {
      const head = `## ${r.title}${r.authority ? ` (${r.authority})` : ''}${r.version ? ` v${r.version}` : ''}`
      const body = r.summary || (r.content ? r.content.slice(0, 800) + '...' : '')
      return `${head}\n${body}`
    }).join('\n\n---\n\n')
  ]
  return lines.join('\n')
}
