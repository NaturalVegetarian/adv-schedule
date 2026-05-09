import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// 不設 storageKey，和入口網站共用同一個 Supabase Auth session
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const PORTAL_URL = 'https://company-portal-dusky.vercel.app/'
const ALLOWED_ROLES = ['管理員', '主管', '生產', '銷貨', '倉儲', '採購']

export async function checkAuth() {
  // 用 Supabase Auth 取得 session（和入口網站共用）
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    window.location.href = PORTAL_URL
    return null
  }

  const userId = session.user.id

  // 從 profiles 取得個人資料
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // 從 user_roles 取得角色
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)

  const roles = rolesData?.map(r => r.role) || []
  const hasPermission = roles.some(r => ALLOWED_ROLES.includes(r))

  return { session, profile, roles, hasPermission }
}
