import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function checkAuth() {
  // 暫時開放，不檢查登入
  return {
    profile: { name: '使用者', email: '' },
    roles: ['生產'],
    hasPermission: true
  }
}
