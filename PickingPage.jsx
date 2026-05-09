import { useState, useEffect } from 'react'
import { checkAuth } from './lib/supabase'
import SalesPage from './pages/SalesPage'
import InventoryPage from './pages/InventoryPage'
import SchedulePage from './pages/SchedulePage'
import OrdersPage from './pages/OrdersPage'
import PickingPage from './pages/PickingPage'

const TABS = [
  { id: 'sales',  label: '銷售計畫' },
  { id: 'inv',    label: '庫存狀況' },
  { id: 'sch',    label: '排程引擎' },
  { id: 'orders', label: '客訂管理' },
  { id: 'pick',   label: '領料工具' },
]

export default function App() {
  const [authState, setAuthState] = useState({ loading: true, user: null, hasPermission: false })
  const [activeTab, setActiveTab] = useState('sales')

  useEffect(() => {
    checkAuth().then(result => {
      if (!result) return // redirected to portal
      setAuthState({ loading: false, user: result, hasPermission: result.hasPermission })
    })
  }, [])

  if (authState.loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div className="loader"></div>
        <p style={{ color: '#64748b', fontWeight: 700 }}>驗證登入中...</p>
      </div>
    )
  }

  if (!authState.hasPermission) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <div style={{ fontSize: 40 }}>🚫</div>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>您沒有使用此系統的權限</h2>
        <p style={{ color: '#64748b', fontSize: 13 }}>請聯繫管理員開通權限</p>
        <a href="https://company-portal-dusky.vercel.app/" style={{ marginTop: 8, color: '#2563eb', fontSize: 13 }}>返回入口網站</a>
      </div>
    )
  }

  const { profile, roles } = authState.user

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      {/* 頂部列 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 46, position: 'sticky', top: 0, zIndex: 50 }}>
        <span style={{ fontSize: 15, fontWeight: 900 }}>🥟 生產排程整合系統</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {profile?.name || profile?.email || '使用者'} · {roles[0] || ''}
          </span>
          <a href="https://company-portal-dusky.vercel.app/" style={{ fontSize: 11, color: '#94a3b8', textDecoration: 'none' }}>返回入口</a>
        </div>
      </div>

      {/* 頁簽 */}
      <div className="main-tabs">
        {TABS.map(t => (
          <div key={t.id} className={`main-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>

      {/* 頁面內容 */}
      <div className="page-wrap">
        {activeTab === 'sales'  && <SalesPage />}
        {activeTab === 'inv'    && <InventoryPage />}
        {activeTab === 'sch'    && <SchedulePage />}
        {activeTab === 'orders' && <OrdersPage user={authState.user} />}
        {activeTab === 'pick'   && <PickingPage />}
      </div>
    </div>
  )
}
