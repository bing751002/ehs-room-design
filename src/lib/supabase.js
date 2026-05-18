import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY 未設定,請複製 .env.example 為 .env.local 並填入 Supabase 專案資訊。')
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'placeholder')
