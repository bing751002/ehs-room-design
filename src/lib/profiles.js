/**
 * Profile 快取 — 給前端顯示「Xxx 加的」標籤用
 * 一次抓全部 profiles 進 cache,之後 lookup 都從 memory
 */
import { supabase } from './supabase.js'

let cache = null
let loading = null

export async function getProfileMap() {
  if (cache) return cache
  if (loading) return loading
  loading = supabase.from('profiles').select('id, email, display_name').then(({ data, error }) => {
    if (error || !data) {
      console.warn('[profiles] load failed', error)
      cache = {}
      return cache
    }
    cache = {}
    for (const p of data) cache[p.id] = p
    loading = null
    return cache
  })
  return loading
}

export function ownerLabel(profileMap, ownerId, currentUserId) {
  if (!ownerId) return '?'
  if (ownerId === currentUserId) return '我'
  const p = profileMap?.[ownerId]
  if (!p) return '同事'
  return p.display_name || (p.email ? p.email.split('@')[0] : '同事')
}
