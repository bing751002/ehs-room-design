import { supabase } from './supabase.js'

const BUCKET = 'plan-assets'  // 共用既有 bucket

export async function listCases({ types = [], tags = [] } = {}) {
  let q = supabase.from('reference_cases').select('*').order('updated_at', { ascending: false })
  if (types.length) q = q.overlaps('space_types', types)
  if (tags.length)  q = q.overlaps('tags', tags)
  const { data, error } = await q
  if (error) {
    // 表不存在或無權限 → graceful 回空,不擋流程
    if (error.code === 'PGRST205' || error.code === '42P01' || /reference_cases/i.test(error.message || '')) {
      console.warn('[caseLibrary] reference_cases 表還沒建,先跳過。請跑 supabase/cases_schema.sql')
      return []
    }
    throw error
  }
  return data || []
}

export async function createCase(input) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const { data, error } = await supabase.from('reference_cases').insert({
    owner: user.id, ...input
  }).select().single()
  if (error) throw error
  return data
}

export async function updateCase(id, patch) {
  const { data, error } = await supabase.from('reference_cases')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function removeCase(id) {
  const { error } = await supabase.from('reference_cases').delete().eq('id', id)
  if (error) throw error
}

/** 上傳一張案例圖片到 storage,回傳 signedUrl 與 path */
export async function uploadCaseImage(file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const path = `${user.id}/cases/${ts}_${safeName}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data: signed, error: urlErr } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365)
  if (urlErr) throw urlErr
  return { path, url: signed.signedUrl }
}

/**
 * RAG 簡版檢索:依照 query (使用者目前需求) 從案例庫挑相近的幾筆。
 * MVP 用標籤/類型重疊度當 score,之後可改向量檢索。
 */
export async function searchSimilarCases({ spaceTypes = [], tags = [], topK = 3 }) {
  let all = []
  try { all = await listCases({}) } catch (e) { return [] }
  const scored = all.map(c => {
    let s = 0
    for (const t of spaceTypes) if ((c.space_types || []).includes(t)) s += 3
    for (const t of tags)       if ((c.tags || []).includes(t))       s += 1
    return { case: c, score: s }
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
  return scored
}

/** 把案例壓縮成 prompt 用文字 — 含圖紙類型/時期供 AI 判斷分量 */
export function caseToPromptText(c) {
  const docTypeLabel = {
    'reference': '純參考圖 (網路/雜誌靈感)',
    'inspiration': '設計參考',
    'concept': '概念設計',
    'construction': '施工圖 (實際施作)',
    'as_built': '已完工圖 (東森案場記錄)',
    'existing': '既有現況圖',
    'demolition': '拆除圖'
  }[c.doc_type]
  const eraLabel = {
    'current': '🟢 現行使用中',
    'historical': '⚪ 歷史 (已過時/已改建,僅供回憶)',
    'planned': '🟡 規劃中',
    'reference': '🔵 純參考 (非東森案場)'
  }[c.era]
  const header = [c.title, docTypeLabel && `[${docTypeLabel}]`, eraLabel].filter(Boolean).join(' ')
  const lines = [`▼ ${header}`]
  if (c.project)             lines.push(`  📍 案場: ${c.project}${c.year ? ' ('+c.year+')' : ''}`)
  if (c.space_types?.length) lines.push(`  類型: ${c.space_types.join(', ')}`)
  if (c.style_tags?.length)  lines.push(`  風格: ${c.style_tags.join(', ')}`)
  if (c.tags?.length)        lines.push(`  標籤: ${c.tags.join(', ')}`)
  if (c.area_ping || c.size_m2) lines.push(`  坪數: ${c.area_ping || ((c.size_m2||0)/3.305785).toFixed(1)} 坪`)
  if (c.description)         lines.push(`  描述: ${c.description}`)
  if (c.ai_summary)          lines.push(`  AI 摘要: ${c.ai_summary}`)
  if (c.boss_notes)          lines.push(`  老闆偏好/評論: ${c.boss_notes}`)
  if (c.what_worked)         lines.push(`  ✅ 成功點: ${c.what_worked}`)
  if (c.what_failed)         lines.push(`  ❌ 失敗點: ${c.what_failed}`)
  return lines.join('\n')
}
