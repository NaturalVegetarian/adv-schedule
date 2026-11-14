import { useState, useEffect } from 'react'
import SalesPage from './pages/SalesPage'
import InventoryPage from './pages/InventoryPage'
import SchedulePage from './pages/SchedulePage'
import OrdersPage from './pages/OrdersPage'
import PickingPage from './pages/PickingPage'

// 頁籤順序與負責科別對照 Excel 生產預估表的工作表
const TABS = [
  { id: 'sales',  label: '銷售計畫', step: '①', dept: '銷貨科' },
  { id: 'inv',    label: '庫存狀況', step: '②', dept: '成品倉庫管理科' },
  { id: 'sch',    label: '生產排程', step: '③', dept: '生產排程科' },
  { id: 'orders', label: '客訂管理', dept: '各科' },
  { id: 'pick',   label: '領料工具' },
]

const PORTAL_URL = 'https://company-portal-dusky.vercel.app/'
const PORTAL_ORIGIN = 'https://company-portal-dusky.vercel.app'

// ── 登入：沿用公司入口的帳號，名字用入口「使用者管理」的姓名（profiles.display_name）──
// 1. 從入口點「生產排程」進來（入口開的新分頁）：向入口要「現在登入的是誰」，只收入口網址傳來的回覆
//    （憑證不放在網址，不會留在瀏覽紀錄）
// 2. 直接開網址：用入口同一組帳號密碼登入（跟入口一樣：帳號 → v_account_lookup 查登入信箱 → 密碼登入）
// 只用來知道「是誰」：驗證完不留憑證，資料讀寫照舊（supabase.js 不動，不會因為登入讀不到資料）
// 記住 12 小時；共用的電腦、平板用完按右上「登出」
const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const ME_KEY = 'adv-me', ME_HOURS = 12

async function sb(path, { token, method = 'GET', body } = {}) {
  try {
    const r = await fetch(`${SB_URL}${path}`, {
      method,
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token || SB_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) return null
    return r.status === 204 ? {} : await r.json().catch(() => ({}))
  } catch { return null }
}

// 用登入憑證問 Supabase「這是誰」，再讀入口的姓名、角色
async function whoIs(token) {
  const u = await sb('/auth/v1/user', { token })
  if (!u?.id) return null
  const [p, rr] = await Promise.all([
    sb(`/rest/v1/profiles?id=eq.${u.id}&select=*`, { token }),
    sb(`/rest/v1/user_roles?user_id=eq.${u.id}&select=roles(code,name)`, { token }),
  ])
  const pf = Array.isArray(p) ? p[0] : null
  if (pf?.is_active === false) return { inactive: true }
  return {
    id: u.id, name: pf?.display_name || pf?.account || u.email || '未命名', account: pf?.account || '',
    roles: (Array.isArray(rr) ? rr : []).map(x => x.roles?.name).filter(Boolean),
  }
}

const readMe = () => { try { const m = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); return m?.name && Date.now() - (m.at || 0) < ME_HOURS * 3600e3 ? m : null } catch { return null } }
const saveMe = m => { try { localStorage.setItem(ME_KEY, JSON.stringify({ ...m, at: Date.now() })) } catch { /* 無痕模式：只記在這一頁 */ } }
const clearMe = () => { try { localStorage.removeItem(ME_KEY) } catch { /* 無痕模式 */ } }

// 這個分頁是入口開的：問入口「現在登入的是誰」（等最多 2.5 秒；不是從入口開的就不用等）
function askPortal(ms = 2500) {
  let op = null
  try { op = window.opener } catch { op = null }
  if (!op) return Promise.resolve('')
  return new Promise(resolve => {
    let timer = null
    const done = at => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(at) }
    const onMsg = e => { if (e.origin === PORTAL_ORIGIN && e.data?.type === 'portal-sso') done(typeof e.data.at === 'string' ? e.data.at : '') }
    window.addEventListener('message', onMsg)
    timer = setTimeout(() => done(''), ms)
    try { op.postMessage({ type: 'portal-sso-request' }, PORTAL_ORIGIN) } catch { done('') }
  })
}

async function checkLogin() {
  const at = await askPortal()
  if (at) { // 從入口進來：換成這次點進來的人（共用電腦換人也會跟著換）
    const me = await whoIs(at)
    if (me?.inactive) { clearMe(); return { error: '這個帳號已停用，請聯絡管理員' } }
    if (me) { saveMe(me); return { me } }
  }
  const me = readMe()
  return me ? { me } : {}
}

async function loginWithAccount(account, password) {
  const look = await sb(`/rest/v1/v_account_lookup?account=eq.${encodeURIComponent(account.trim())}&select=login_email`)
  const email = Array.isArray(look) ? look[0]?.login_email : null
  if (!email) return { error: '帳號或密碼錯誤' }
  const t = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
  if (!t?.access_token) return { error: '帳號或密碼錯誤' }
  const me = await whoIs(t.access_token)
  sb('/auth/v1/logout?scope=local', { method: 'POST', token: t.access_token }) // 知道是誰就好，不留這次的登入
  if (me?.inactive) return { error: '這個帳號已停用，請聯絡管理員' }
  return me ? { me } : { error: '讀不到帳號資料，請稍後再試' }
}

export default function App() {
  const [auth, setAuth] = useState({ loading: true, me: null, error: '' })
  const [activeTab, setActiveTab] = useState('sales')
  const [acct, setAcct] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    checkLogin().then(r => setAuth({ loading: false, me: r.me || null, error: r.error || '' }))
  }, [])

  const doLogin = async e => {
    e.preventDefault()
    if (!acct.trim() || !pw) { setAuth(a => ({ ...a, error: '請輸入帳號和密碼' })); return }
    setBusy(true)
    const r = await loginWithAccount(acct, pw)
    setBusy(false)
    if (r.me) { saveMe(r.me); setPw(''); setAuth({ loading: false, me: r.me, error: '' }) }
    else setAuth(a => ({ ...a, error: r.error }))
  }
  const logout = () => { clearMe(); setPw(''); setAuth({ loading: false, me: null, error: '' }) }

  if (auth.loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div className="loader"></div>
        <p style={{ color: '#64748b', fontWeight: 700 }}>驗證登入中...</p>
      </div>
    )
  }

  // 還沒登入：請從入口進來，或直接用入口的帳號密碼登入
  if (!auth.me) {
    const inp = { width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', fontSize: 16, fontFamily: 'inherit' }
    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="login-card" style={{ background: '#fff', width: '100%', maxWidth: 380, borderRadius: 24, padding: 24, boxShadow: '0 10px 30px rgba(15,23,42,.08)' }}>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>🥟 生產排程整合系統</div>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 14 }}>請從「公司入口」點「生產排程」進來，會自動登入。</div>
          <a href={PORTAL_URL} style={{ display: 'block', textAlign: 'center', background: '#1e293b', color: '#fff', borderRadius: 12, padding: '11px', fontWeight: 800, textDecoration: 'none', marginBottom: 16 }}>前往公司入口</a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>
            <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />或直接用入口的帳號密碼登入<span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          </div>
          <form onSubmit={doLogin}>
            <input value={acct} onChange={e => setAcct(e.target.value)} placeholder="帳號" aria-label="帳號" autoComplete="username" autoCapitalize="none" style={{ ...inp, marginBottom: 8 }} />
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="密碼" aria-label="密碼" autoComplete="current-password" style={{ ...inp, marginBottom: 10 }} />
            {auth.error && <div role="alert" style={{ color: '#dc2626', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{auth.error}</div>}
            <button type="submit" disabled={busy} style={{ width: '100%', background: '#0e7490', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontWeight: 900, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>{busy ? '登入中…' : '登入'}</button>
          </form>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 12, lineHeight: 1.6 }}>登入後 12 小時內不用再登入。共用的電腦、平板用完，請按右上角「登出」。</div>
        </div>
      </div>
    )
  }

  const { me } = auth
  const user = { id: me.id, profile: { name: me.name, account: me.account }, roles: me.roles || [] } // 客訂管理記「是誰」用

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      {/* 頂部列 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 46, position: 'sticky', top: 0, zIndex: 50 }}>
        <span style={{ fontSize: 15, fontWeight: 900, whiteSpace: 'nowrap' }}>🥟 生產排程整合系統</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span className="app-me" style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            👤 {me.name}{user.roles[0] ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {user.roles[0]}</span> : null}
          </span>
          <button onClick={logout} style={{ fontSize: 11, color: '#cbd5e1', background: 'none', border: '1px solid #475569', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>登出</button>
          <a href={PORTAL_URL} style={{ fontSize: 11, color: '#94a3b8', textDecoration: 'none', whiteSpace: 'nowrap' }}>返回入口</a>
        </div>
      </div>

      {/* 頁簽 */}
      <div className="main-tabs">
        {TABS.map(t => (
          <div key={t.id} className={`main-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.25, paddingTop: 8, paddingBottom: 6 }}>
            <span>{t.step ? `${t.step} ` : ''}{t.label}</span>
            {t.dept && <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>{t.dept}</span>}
          </div>
        ))}
      </div>

      {/* 頁面內容 */}
      <div className="page-wrap">
        {activeTab === 'sales'  && <SalesPage />}
        {activeTab === 'inv'    && <InventoryPage />}
        {activeTab === 'sch'    && <SchedulePage />}
        {activeTab === 'orders' && <OrdersPage user={user} />}
        {activeTab === 'pick'   && <PickingPage />}
      </div>
    </div>
  )
}
