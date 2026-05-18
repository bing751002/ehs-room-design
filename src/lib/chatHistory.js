import { supabase } from './supabase.js'

/**
 * AI 對話歷史 — 跟 plan_id 綁定,每次切方案載入該方案歷史。
 * 表不存在會 graceful 跳過。
 */

export async function loadChatHistory(planId) {
  if (!planId) return []
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })
  if (error) {
    if (error.code === 'PGRST205' || /chat_messages/i.test(error.message || '')) {
      console.warn('[chatHistory] chat_messages 表還沒建,請跑 supabase/chat_schema.sql')
      return []
    }
    throw error
  }
  return (data || []).map(m => ({
    role: m.role,
    content: m.content,
    actions: m.actions,
    verbose: m.verbose,
    id: m.id,
    createdAt: m.created_at
  }))
}

export async function appendChatMessage(planId, msg) {
  if (!planId) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('chat_messages').insert({
    plan_id: planId,
    owner: user.id,
    role: msg.role,
    content: msg.content,
    actions: msg.actions || null,
    verbose: !!msg.verbose
  }).select().single()
  if (error) {
    if (error.code !== 'PGRST205' && !/chat_messages/i.test(error.message || '')) {
      console.error('[chatHistory] insert 失敗', error)
    }
    return null
  }
  return data
}

export async function clearChatHistory(planId) {
  if (!planId) return
  const { error } = await supabase.from('chat_messages').delete().eq('plan_id', planId)
  if (error && error.code !== 'PGRST205') console.error(error)
}
