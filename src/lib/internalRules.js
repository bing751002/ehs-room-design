import { supabase } from './supabase.js'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const BUCKET = 'plan-assets'

export async function listRules({ activeOnly = true } = {}) {
  let q = supabase.from('internal_rules').select('*').order('priority', { ascending: false })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' || /internal_rules/i.test(error.message || '')) {
      console.warn('[internalRules] internal_rules 表還沒建,先跳過。請跑 supabase/rules_schema.sql')
      return []
    }
    throw error
  }
  return data || []
}
export async function createRule(input) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const { data, error } = await supabase.from('internal_rules').insert({
    owner: user.id, ...input
  }).select().single()
  if (error) throw error
  return data
}
export async function updateRule(id, patch) {
  const { data, error } = await supabase.from('internal_rules')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function removeRule(id) {
  const { error } = await supabase.from('internal_rules').delete().eq('id', id)
  if (error) throw error
}

/** 上傳規則附件並回傳 url */
export async function uploadRuleAttachment(file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const path = `${user.id}/rules/${ts}_${safeName}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365)
  return { path, url: signed.signedUrl }
}

/** 從 PDF 抽出純文字 (給 AI 讀);Word 暫不支援,請使用者複製貼上 */
export async function extractPdfText(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const parts = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    parts.push(tc.items.map(it => it.str).join(' '))
  }
  return parts.join('\n\n')
}

/** 把作用中的規則格式化進 AI 的 system prompt */
export function rulesToPromptText(rules) {
  if (!rules?.length) return ''
  const sorted = [...rules].sort((a, b) => b.priority - a.priority)
  const lines = [
    '\n\n# 🏢 東森空間規劃實驗室 — 團隊累積規則 (Team-shared,優先於台灣公規,規劃時必須遵守)',
    '> 這些是東森團隊成員陸續累積的內部規定,你應該把它們當成「東森設計部門的家規」',
    sorted.map(r => `## ${r.title}${r.category ? ` [${r.category}]` : ''} (優先度 ${r.priority})\n${r.content}`).join('\n\n---\n\n')
  ]
  return lines.join('\n')
}
