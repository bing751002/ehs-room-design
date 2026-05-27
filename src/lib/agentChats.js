import { supabase } from './supabase.js'

/**
 * Agent 對話歷史 — 給「審圖 Agent」與「設計評估 Agent」用
 * 不綁定 plan_id;以 thread_id 為單位
 * 對應 supabase/agent_chats_schema.sql
 */

const BUCKET = 'plan-assets'

/** 上傳審查附件到 Supabase Storage,回傳 {filename, signed_url, mime_type, size} */
export async function uploadAgentAttachment(file, threadId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const ts = Date.now()
  const safeName = file.name.replace(/[^\w.-]/g, '_')
  const path = `${user.id}/agent_chat/${threadId}/${ts}_${safeName}`
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data: signed } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 365)  // 1 年
  return {
    filename: file.name,
    storage_path: path,
    signed_url: signed.signedUrl,
    mime_type: file.type,
    size: file.size
  }
}

/** 列出某 agent 的所有 thread (列表頁用) */
export async function listThreads(agentType) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('agent_chat_threads')
    .select('*')
    .eq('agent_type', agentType)
    .eq('owner', user.id)
    .order('last_msg_at', { ascending: false })
  if (error) {
    if (error.code === 'PGRST205' || /agent_chat/i.test(error.message || '')) {
      console.warn('[agentChats] agent_chats 表還沒建,請跑 supabase/agent_chats_schema.sql')
      return []
    }
    throw error
  }
  return data || []
}

/** 載入單一 thread 完整對話 */
export async function loadThread(threadId) {
  if (!threadId) return []
  const { data, error } = await supabase
    .from('agent_chats')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) {
    if (error.code === 'PGRST205') return []
    throw error
  }
  return (data || []).map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    attachments: m.attachments || [],
    metadata: m.metadata || null,
    createdAt: m.created_at
  }))
}

/** 新增訊息到 thread。若 thread 不存在 (第一則訊息) 也會自動建立 */
export async function appendMessage(threadId, agentType, msg, threadTitle = null) {
  if (!threadId) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('agent_chats').insert({
    thread_id: threadId,
    agent_type: agentType,
    owner: user.id,
    role: msg.role,
    content: msg.content,
    attachments: msg.attachments || null,
    metadata: msg.metadata || null,
    thread_title: threadTitle
  }).select().single()
  if (error) {
    if (error.code !== 'PGRST205') console.error('[agentChats] insert 失敗', error)
    return null
  }
  return data
}

/** 建立新 thread (回傳 uuid)。Web Crypto API 產 uuid */
export function createThreadId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/** 刪除整個 thread */
export async function deleteThread(threadId) {
  if (!threadId) return
  const { error } = await supabase.from('agent_chats').delete().eq('thread_id', threadId)
  if (error && error.code !== 'PGRST205') console.error(error)
}

/** 更新 thread 標題 (用第一則 user 訊息的截斷做標題) */
export async function renameThread(threadId, title) {
  if (!threadId) return
  const { error } = await supabase.from('agent_chats')
    .update({ thread_title: title })
    .eq('thread_id', threadId)
  if (error && error.code !== 'PGRST205') console.error(error)
}
