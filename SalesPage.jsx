import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: 'company-portal-auth',
    persistSession: true,
    autoRefreshToken: true,
  }
})

const PORTAL_URL = 'https://company-portal-dusky.vercel.app/'
const ALLOWED_ROLES = ['管理員', '主管', '生產', '銷貨', '倉儲', '採購']

export async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    window.location.href = PORTAL_URL
    return null
  }

  const userId = session.user.id

  // 取得 profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  // 取得角色
  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)

  const userRoles = roles?.map(r => r.role) || []
  const hasPermission = userRoles.some(r => ALLOWED_ROLES.includes(r))

  return { session, profile, roles: userRoles, hasPermission }
}
