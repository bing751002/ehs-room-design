/**
 * 房間庫 CRUD — 使用者自訂房型模板存 Supabase。
 * 跟 constraints.js 的內建 roomTemplates 並存:畫面顯示時合併。
 * 表不存在會 graceful 跳過。
 */
import { supabase } from './supabase.js'

export async function listRoomTemplates() {
  const { data, error } = await supabase
    .from('room_templates')
    .select('*')
    .order('is_favorite', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error) {
    if (error.code === 'PGRST205' || /room_templates/i.test(error.message || '')) {
      console.warn('[roomTemplates] room_templates 表還沒建,請跑 supabase/room_templates_schema.sql')
      return []
    }
    throw error
  }
  return data || []
}

export async function createRoomTemplate(input) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登入')
  const { data, error } = await supabase.from('room_templates').insert({
    owner: user.id, ...input
  }).select().single()
  if (error) throw error
  return data
}

export async function updateRoomTemplate(id, patch) {
  const { data, error } = await supabase.from('room_templates')
    .update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function removeRoomTemplate(id) {
  const { error } = await supabase.from('room_templates').delete().eq('id', id)
  if (error) throw error
}

export async function toggleFavorite(id, currentValue) {
  return await updateRoomTemplate(id, { is_favorite: !currentValue })
}
