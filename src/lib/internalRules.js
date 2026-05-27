import { supabase } from './supabase.js'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const BUCKET = 'plan-assets'

export async function listRules({ activeOnly = true } = {}) {
  // 排序:新加入的優先 (但 prompt 內仍按分類分組,不顯示順序)
  let q = supabase.from('internal_rules').select('*').order('created_at', { ascending: false })
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

/** 把作用中的規則格式化進 AI 的 system prompt
 *
 * 規則之間沒有「優先順序」(全部都是鐵則),改以「分類」分組呈現,
 * 並把 🚨 (AI 過往錯誤修正) 放最前面強調絕對不能再犯
 */
export function rulesToPromptText(rules) {
  if (!rules?.length) return ''

  // 分兩類:🚨 開頭 = AI 易誤點(過往糾正紀錄), 其餘按 category 分組
  const corrections = rules.filter(r => /^🚨/.test(r.title))
  const others = rules.filter(r => !/^🚨/.test(r.title))

  const lines = [
    '\n\n# 🏢 東森空間規劃實驗室 — 團隊累積規則 (規劃/審查時必須遵守)',
    '> 這些是東森團隊累積的鐵則,沒有先後高低之分,**任何一條都不能違反或寫錯文字內容**。',
    '> 法條文意或許有解釋空間,但條號、數值、用詞必須完全正確。'
  ]

  if (corrections.length) {
    lines.push('\n## 🚨 AI 過往錯誤糾正紀錄 (絕對不可再犯)')
    lines.push('> 以下每一條都是 AI 上次回答時寫錯、被使用者糾正的真實案例。引用相關法條時必須查這份再回答。')
    for (const r of corrections) {
      lines.push(`\n### ${r.title}${r.category ? ` [${r.category}]` : ''}\n${r.content}`)
    }
  }

  if (others.length) {
    // 依 category 分組
    const byCategory = {}
    for (const r of others) {
      const c = r.category || '其他'
      if (!byCategory[c]) byCategory[c] = []
      byCategory[c].push(r)
    }
    lines.push('\n## 📚 一般團隊規則')
    for (const [cat, list] of Object.entries(byCategory)) {
      lines.push(`\n### ${cat}`)
      for (const r of list) {
        lines.push(`\n**${r.title}**\n${r.content}`)
      }
    }
  }

  return lines.join('\n')
}
