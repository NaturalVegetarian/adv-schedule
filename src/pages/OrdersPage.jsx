import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'

export default function OrdersPage({ user }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [savedItems, setSavedItems] = useState(['黃金滿福餃(營業用)', '泡菜滿福餃(營業用)', '素花滿福餃(營業用)', '新鮮蔬滿福餃(營業用)', '剝皮辣椒滿福餃(營業用)', '酸白菜滿福餃(營業用)', '自然齋香羹(營業用)', '黃金滿福餃散裝'])
  const [editingConfigs, setEditingConfigs] = useState([])
  const [activeTab, setActiveTab] = useState('pending')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [editingOrderId, setEditingOrderId] = useState(null)
  const [isAddingNewItem, setIsAddingNewItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [filterFlavor, setFilterFlavor] = useState('')
  const [toast, setToast] = useState(null)
  const [pendingOrderData, setPendingOrderData] = useState(null)
  const [formError, setFormError] = useState('')
  const [statusModal, setStatusModal] = useState(null) // {order, nextStatus, label}
  const [statusDate, setStatusDate] = useState('')
  const submitActionRef = useRef('normal')
  const [useBoxCalc, setUseBoxCalc] = useState(false)
  const [boxCountInput, setBoxCountInput] = useState('')
  const [boxQtyInput, setBoxQtyInput] = useState('')

  // 欄位名稱對照原始資料庫（camelCase 舊欄位 + snake_case 新欄位）
  const emptyForm = {
    // 全部用 snake_case 對應資料庫
    customer_name: '', item_name: '', quantity: '', unit: '袋',
    logistics: '', box_type: '', items_per_box: '',
    shipping_mark: false, is_mixed_box: false,
    target_date: '', scheduled_date: '', notes: '',
    weight_per_bag: 5250,
    color_mark: false, color_mark_note: '',
    box_count: 0, box_qty_each: 0,
  }
  const [formData, setFormData] = useState(emptyForm)

  const fetchOrders = async () => {
    const { data, error } = await supabase.from('adv_orders').select('*').order('created_at', { ascending: false })
    if (!error && data) setOrders(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
    const channel = supabase.channel('adv_orders').on('postgres_changes', { event: '*', schema: 'public', table: 'adv_orders' }, () => fetchOrders()).subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  useEffect(() => {
    const fetchConfig = async () => {
      const { data } = await supabase.from('adv_flavor_config').select('*').single()
      if (data?.items) setSavedItems(data.items)
    }
    fetchConfig()
  }, [])

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const handleInputChange = e => {
    const { name, value, type, checked } = e.target
    setFormData(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }))
    if (formError) setFormError('')
  }

  const calcedQty = useMemo(() => {
    const b = parseInt(boxCountInput) || 0
    const q = parseInt(boxQtyInput) || 0
    return b * q
  }, [boxCountInput, boxQtyInput])

  const handleFormSubmit = e => {
    e.preventDefault()
    setFormError('')
    if (!formData.customer_name.trim()) { setFormError('請填寫客戶名稱'); return }
    if (!formData.item_name) { setFormError('請選擇口味品項'); return }
    if (!formData.target_date) { setFormError('請選擇指定出貨日'); return }

    let finalQty = 0
    if (useBoxCalc) {
      if (!boxCountInput || !boxQtyInput) { setFormError('請填寫箱數與每箱袋數'); return }
      finalQty = calcedQty
    } else {
      finalQty = Math.round(Number(formData.quantity)) || 0
      if (finalQty <= 0) { setFormError('請填寫訂購數量'); return }
    }

    setPendingOrderData({
      ...formData,
      quantity: finalQty,
      items_per_box: Math.round(Number(formData.items_per_box)) || 0,
      customer_name: formData.customer_name.trim(),
      notes: formData.notes?.trim() || '',
      weight_per_bag: Number(formData.weight_per_bag) || 5250,
      box_count: useBoxCalc ? parseInt(boxCountInput) || 0 : 0,
      box_qty_each: useBoxCalc ? parseInt(boxQtyInput) || 0 : 0,
    })
    setIsConfirmOpen(true)
  }

  const executeSave = async () => {
    if (!pendingOrderData) return
    const id = editingOrderId || `order_${Date.now()}`
    const existingOrder = orders.find(o => o.id === editingOrderId)
    try {
      const { error } = await supabase.from('adv_orders').upsert({
        id, ...pendingOrderData,
        status: existingOrder?.status || 'pending',
        created_at: existingOrder?.created_at || new Date().toISOString(),
        created_by: user?.session?.user?.id,
        updated_at: new Date().toISOString()
      })
      if (error) throw error
      showToast(editingOrderId ? '訂單修改成功 ✅' : '訂單已儲存 ✅')
      fetchOrders()
      if (formData.is_mixed_box && submitActionRef.current === 'continue' && !editingOrderId) {
        setFormData(p => ({ ...p, item_name: '', quantity: '', notes: '' }))
        setBoxCountInput(''); setBoxQtyInput('')
        setIsConfirmOpen(false); setPendingOrderData(null)
      } else { setIsConfirmOpen(false); setPendingOrderData(null); closeForm() }
    } catch (err) { alert('儲存失敗：' + (err.message || JSON.stringify(err))) }
  }

  const changeStatus = async (order, direction) => {
    const states = ['pending', 'scheduled', 'prepared', 'shipped']
    const idx = states.indexOf(order.status)
    const next = Math.max(0, Math.min(states.length - 1, idx + direction))
    if (next === idx) return
    await supabase.from('adv_orders').update({ status: states[next], updated_at: new Date().toISOString() }).eq('id', order.id)
    fetchOrders()
    showToast(`已退回：${['待安排', '已排程', '已備貨', '已出貨'][next]} ✅`)
  }

  const closeForm = () => {
    setIsFormOpen(false); setEditingOrderId(null); setIsAddingNewItem(false)
    setFormError(''); setUseBoxCalc(false); setBoxCountInput(''); setBoxQtyInput('')
    setFormData(emptyForm)
  }

  const openEditForm = order => {
    setFormData({ ...emptyForm, ...order })
    if ((order.box_count||0) > 0) { setUseBoxCalc(true); setBoxCountInput(String(order.box_count)); setBoxQtyInput(String(order.box_qty_each)) }
    setEditingOrderId(order.id); setIsFormOpen(true)
  }

  const deleteOrder = async id => {
    if (!confirm('確定要永久刪除這筆單嗎？')) return
    await supabase.from('adv_orders').delete().eq('id', id)
    fetchOrders()
  }

  const saveNewFlavor = async () => {
    if (!newItemName.trim()) return
    const items = [...savedItems, newItemName.trim()]
    await supabase.from('adv_flavor_config').upsert({ id: 'default', items, updated_at: new Date().toISOString() })
    setSavedItems(items)
    setFormData(p => ({ ...p, item_name: newItemName.trim() }))
    setNewItemName(''); setIsAddingNewItem(false); showToast('規格新增成功 ✅')
  }

  const syncSettings = async () => {
    const newItems = editingConfigs.map(c => c.trim()).filter(Boolean)
    await supabase.from('adv_flavor_config').upsert({ id: 'default', items: newItems, updated_at: new Date().toISOString() })
    setSavedItems(newItems); setIsSettingsOpen(false); showToast('品名已同步 ✅')
  }


  // 計算單筆訂單的箱數
  const getBoxCount = o => {
    if (o.box_count > 0) return o.box_count  // 直接下箱數
    const ipb = o.items_per_box || o.itemsPerBox || 0
    if (ipb > 0) return Math.ceil(Number(o.quantity) / ipb)
    return 0
  }
  // 計算單筆訂單的包數
  const getPkgCount = o => {
    if (o.box_count > 0) {
      const ipb = o.items_per_box || o.itemsPerBox || o.box_qty_each || 0
      return ipb > 0 ? o.box_count * ipb : Number(o.quantity)
    }
    return Number(o.quantity)
  }
  const sortedOrders = useMemo(() => [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [orders])
  const filteredOrders = sortedOrders.filter(o => o.status === activeTab && (o.item_name || o.itemName || '').includes(filterFlavor))
  const groupedByCustomer = filteredOrders.reduce((acc, o) => {
    const fullName = o.customer_name || o.customerName || '未知客戶'
    const parentKey = fullName.includes('-') ? fullName.split('-')[0] : fullName
    if (!acc[parentKey]) acc[parentKey] = { subGroups: {}, all: [] }
    if (!acc[parentKey].subGroups[fullName]) acc[parentKey].subGroups[fullName] = []
    acc[parentKey].subGroups[fullName].push(o)
    acc[parentKey].all.push(o)
    return acc
  }, {})

  const formatDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
  const getNextWeekRange = date => {
    const d = new Date(date), day = d.getDay()
    const nMon = new Date(d); nMon.setDate(d.getDate() + ((8 - day) % 7 || 7))
    const nFri = new Date(nMon); nFri.setDate(nMon.getDate() + 4)
    return { start: nMon, end: nFri }
  }
  const nextWeek = getNextWeekRange(selectedDate)
  const nextWeekSummary = sortedOrders.filter(o => { const td = o.target_date||o.targetDate; if (!td) return false; const d = new Date(td); return d >= nextWeek.start && d <= nextWeek.end }).reduce((acc, o) => { const iName = o.item_name||o.itemName||''; if (!acc[iName]) acc[iName] = { qty: 0 }; acc[iName].qty += Number(o.quantity); return acc }, {})
  const customerSummary = sortedOrders.filter(o => (o.target_date||o.targetDate) === formatDate(selectedDate)).reduce((acc, o) => { const cName = o.customer_name||o.customerName||'未知客戶'; if (!acc[cName]) acc[cName] = { items: [], total: 0 }; acc[cName].items.push(o); acc[cName].total += Number(o.quantity); return acc }, {})
  const calendarData = useMemo(() => {
    const year = currentMonth.getFullYear(), month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1).getDay(), totalDays = new Date(year, month + 1, 0).getDate()
    const days = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let i = 1; i <= totalDays; i++) days.push(new Date(year, month, i))
    return days
  }, [currentMonth])

  const THEME = {
    pending:   { bg: '#fffbeb', header: '#f59e0b', accent: '#92400e', border: '#fde68a' },
    scheduled: { bg: '#f0fdf4', header: '#10b981', accent: '#065f46', border: '#a7f3d0' },
    prepared:  { bg: '#eff6ff', header: '#3b82f6', accent: '#1e3a8a', border: '#bfdbfe' },
    shipped:   { bg: '#f8fafc', header: '#64748b', accent: '#1e293b', border: '#e2e8f0' },
    stats:     { bg: '#fff1f2', header: '#f43f5e', accent: '#881337', border: '#fecdd3' },
  }
  const th = THEME[activeTab] || THEME.pending

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>載入中...</div>

  return (
    <div style={{ margin: -16, minHeight: '100vh', background: th.bg }}>
      {toast && (
        <div style={{ position: 'fixed', top: 80, left: 0, right: 0, zIndex: 100, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ background: '#059669', color: '#fff', padding: '10px 24px', borderRadius: 50, fontWeight: 700, fontSize: 14 }}>{toast}</div>
        </div>
      )}

      <div style={{ background: th.header, color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, fontWeight: 900 }}>🥟 客訂管理系統</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setEditingConfigs([...savedItems]); setIsSettingsOpen(true) }} style={{ background: 'rgba(255,255,255,.2)', border: 'none', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>⚙️</button>
          <button onClick={() => { closeForm(); setIsFormOpen(true) }} style={{ background: '#fff', color: '#1e293b', border: 'none', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>新增客訂</button>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '12px 16px' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,.5)', borderRadius: 16, padding: 4, marginBottom: 12, gap: 2, overflowX: 'auto' }}>
          {[['pending', '待安排'], ['scheduled', '已排程'], ['prepared', '已備貨'], ['shipped', '已出貨'], ['stats', '日曆統計']].map(([t, l]) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, minWidth: 60, padding: '8px 4px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer', background: activeTab === t ? th.header : 'transparent', color: activeTab === t ? '#fff' : '#94a3b8' }}>{l}</button>
          ))}
        </div>

        {activeTab !== 'stats' && (
          <input type="text" placeholder="🔍 篩選口味..." value={filterFlavor} onChange={e => setFilterFlavor(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,.8)', border: 'none', borderRadius: 16, padding: '12px 16px', fontSize: 15, fontWeight: 700, marginBottom: 12, fontFamily: 'inherit' }} />
        )}

        {activeTab !== 'stats' ? (
          Object.keys(groupedByCustomer).length === 0
            ? <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontStyle: 'italic' }}>目前無資料</div>
            : Object.entries(groupedByCustomer).map(([parentName, group]) => {
              const allOrders = group.all || []
              const subGroups = group.subGroups || { [parentName]: allOrders }
              const totalQty = allOrders.reduce((s, o) => s + Number(o.quantity), 0)
              const hasMultipleSub = Object.keys(subGroups).length > 1
              return (
              <div key={parentName} style={{ background: '#fff', borderRadius: 24, border: `1px solid ${th.border}`, overflow: 'hidden', marginBottom: 16 }}>
                {/* 母客戶標題列 */}
                <div style={{ background: th.header, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{parentName}</span>
<span style={{ fontSize: 13, color: 'rgba(255,255,255,.8)', fontWeight: 700 }}>{(() => {
                    const totalPkg2 = allOrders.reduce((s,o) => s + getPkgCount(o), 0)
                    const totalBox2 = allOrders.reduce((s,o) => s + getBoxCount(o), 0)
                    return `共${allOrders.length}筆・${totalPkg2}包${totalBox2 > 0 ? `・${totalBox2}箱` : ''}`
                  })()}</span>
                </div>
                {/* 各子客戶 */}
                {Object.entries(subGroups).map(([subName, list]) => (
                <div key={subName} style={{ borderBottom: `1px solid ${th.border}` }}>
                  {hasMultipleSub && (
                    <div style={{ background: 'rgba(255,255,255,.6)', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${th.border}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>{subName}</span>
                        {list[0]?.shipping_mark && <span style={{ fontSize: 11, background: '#fef2f2', color: '#ef4444', padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>🏷️ 一般麥頭</span>}
                        {list[0]?.color_mark && <span style={{ fontSize: 11, background: '#fdf4ff', color: '#7e22ce', padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>🎨 彩色{list[0]?.color_mark_note ? `(${list[0].color_mark_note})` : ''}</span>}
                      </div>
<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {(() => {
                          const subPkg = list.reduce((s,o) => s + getPkgCount(o), 0)
                          const subBox2 = list.reduce((s,o) => s + getBoxCount(o), 0)
                          return <span style={{ fontSize: 12, fontWeight: 700, color: th.accent }}>{subPkg}包{subBox2 > 0 ? `・${subBox2}箱` : ''}</span>
                        })()}
                        <span style={{ fontSize: 12, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>{list[0]?.logistics || '物流未定'}</span>
                      </div>
                    </div>
                  )}
                {list.map(o => {
                  const ipb = Math.round(Number(o.items_per_box||o.itemsPerBox)) || 0
                  let boxDisplay = ''
                  if (ipb > 0) { const boxes = Math.floor(Number(o.quantity) / ipb), rem = Number(o.quantity) % ipb; boxDisplay = `${boxes}箱${rem > 0 ? ` + ${rem}袋` : ''}` }
                  return (
                    <div key={o.id} style={{ padding: '16px', borderBottom: `1px solid #f8fafc` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1, paddingRight: 12 }}>
                          <div style={{ fontSize: 18, fontWeight: 900, color: th.accent, marginBottom: 4 }}>{o.item_name||o.itemName}</div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {(o.is_mixed_box||o.isMixedBox) && <span style={{ fontSize: 12, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>併箱</span>}
                            <span style={{ fontSize: 12, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 6 }}>{o.weight_per_bag || 5250}g/袋</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 26, fontWeight: 900, color: '#1e293b' }}>{o.quantity} <span style={{ fontSize: 14, color: '#94a3b8' }}>袋</span></div>
                          {getBoxCount(o) > 0 && <div style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}>📦 {getBoxCount(o)} 箱</div>}
                          {o.box_count > 0 && o.box_qty_each > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>{o.box_count}箱 × {o.box_qty_each}袋/箱</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {(o.box_type||o.boxType) && <span style={{ fontSize: 12, background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>{o.box_type||o.boxType}</span>}
                        {o.notes && <span style={{ fontSize: 12, background: '#f8fafc', color: '#475569', padding: '2px 8px', borderRadius: 6 }}>📝 {o.notes}</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px dashed #f1f5f9' }}>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {(o.scheduled_date||o.scheduledDate) && <div>排程：{o.scheduled_date||o.scheduledDate}</div>}
                          <div style={{ fontWeight: 700, color: th.accent }}>出貨：{o.target_date||o.targetDate || '未定'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => openEditForm(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 6px' }}>✏️</button>
                          <button onClick={() => deleteOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 6px' }}>🗑️</button>
                          <button onClick={() => changeStatus(o, -1)} disabled={o.status === 'pending'} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', padding: '4px 8px', fontSize: 11, color: o.status === 'pending' ? '#e2e8f0' : '#475569' }}>退回上一狀態</button>
                          <button onClick={() => {
                            if (o.status === 'shipped') return
                            const labels = { pending: '排入行程', scheduled: '完成備貨', prepared: '確認出貨' }
                            const nextStatuses = { pending: 'scheduled', scheduled: 'prepared', prepared: 'shipped' }
                            setStatusDate(new Date().toISOString().slice(0,10))
                            setStatusModal({ order: o, nextStatus: nextStatuses[o.status], label: labels[o.status] })
                          }} style={{ background: th.header, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', padding: '6px 14px', fontWeight: 700, fontSize: 14 }}>
                            {o.status === 'pending' ? '排入行程' : o.status === 'scheduled' ? '完成備貨' : o.status === 'prepared' ? '確認出貨' : '維持現狀'} ›
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
                </div>
                ))}
                {/* 總計列 */}
                {hasMultipleSub && (
                  <div style={{ background: '#f8fafc', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>合計</span>
  <span style={{ fontSize: 15, fontWeight: 900, color: th.accent }}>{(() => {
                      const fPkg = allOrders.reduce((s,o) => s + getPkgCount(o), 0)
                      const fBox = allOrders.reduce((s,o) => s + getBoxCount(o), 0)
                      return `${fPkg} 包${fBox > 0 ? `・${fBox} 箱` : ''}`
                    })()}</span>
                  </div>
                )}
              </div>
            )})
        ) : (
          <div>
            <div style={{ background: '#fff', borderRadius: 24, padding: 20, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: th.header }}>‹</button>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月</div>
                <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: th.header }}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
                {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} style={{ fontSize: 13, color: '#94a3b8', paddingBottom: 4 }}>{d}</div>)}
                {calendarData.map((d, i) => {
                  if (!d) return <div key={`e${i}`}></div>
                  const ds = formatDate(d), isSel = selectedDate && ds === formatDate(selectedDate)
                  const cnt = orders.filter(o => (o.target_date||o.targetDate) === ds).length
                  return (
                    <button key={ds} onClick={() => setSelectedDate(d)} style={{ aspectRatio: '1', borderRadius: 12, border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: isSel ? th.header : 'transparent', color: isSel ? '#fff' : '#1e293b', fontWeight: isSel ? 900 : 400 }}>
                      <span style={{ fontSize: 14 }}>{d.getDate()}</span>
                      {cnt > 0 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: isSel ? '#fff' : th.header, marginTop: 1 }}></div>}
                    </button>
                  )
                })}
              </div>
            </div>
            {selectedDate && (
              <>
                <div style={{ background: th.header, borderRadius: 20, padding: 20, marginBottom: 12, color: '#fff' }}>
                  <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 12, borderBottom: 'rgba(255,255,255,.3) solid 1px', paddingBottom: 8 }}>本週出貨總計（{formatDate(nextWeek.start)} ~ {formatDate(nextWeek.end)}）</div>
                  {Object.entries(nextWeekSummary).map(([name, data]) => (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,.1)', padding: '10px 12px', borderRadius: 12, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700 }}>{name}</span>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>{data.qty} <span style={{ fontSize: 13 }}>袋</span></div>
                    </div>
                  ))}
                  {Object.keys(nextWeekSummary).length === 0 && <p style={{ textAlign: 'center', opacity: .6 }}>無紀錄</p>}
                </div>
                <div style={{ background: '#fff', borderRadius: 20, padding: 20 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 12, borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>📦 理貨清單 — {formatDate(selectedDate)}</div>
                  {Object.entries(customerSummary).map(([name, data]) => (
                    <div key={name} style={{ border: '1px solid #f1f5f9', borderRadius: 16, overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ background: '#f8fafc', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {name}
                          {(data.items[0]?.shipping_mark||data.items[0]?.shippingMark) && <span style={{ fontSize: 11, background: '#fef2f2', color: '#ef4444', padding: '1px 5px', borderRadius: 4 }}>麥頭</span>}
                          {data.items[0]?.color_mark && <span style={{ fontSize: 11, background: '#fdf4ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 4 }}>彩色{data.items[0]?.color_mark_note ? `(${data.items[0].color_mark_note})` : ''}</span>}
                        </div>
                        <span>{data.total} 袋</span>
                      </div>
                      {data.items.map(item => (
                        <div key={item.id} style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f8fafc', fontSize: 14 }}>
                          <span style={{ color: '#475569' }}>{item.item_name||item.itemName}</span>
                          <span style={{ color: th.header, fontWeight: 700 }}>{item.quantity} 袋</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {Object.keys(customerSummary).length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8' }}>當日無出貨紀錄</p>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 設定 */}
      {isSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 400, borderRadius: 28, padding: 24, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 900 }}>口味品名管理</h2>
              <button onClick={() => setIsSettingsOpen(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer' }}>✕</button>
            </div>
            {editingConfigs.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input type="text" value={item} onChange={e => { const n = [...editingConfigs]; n[i] = e.target.value; setEditingConfigs(n) }} style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', fontWeight: 700, color: '#4f46e5', fontFamily: 'inherit' }} />
                <button type="button" onClick={() => setEditingConfigs(editingConfigs.filter((_, j) => j !== i))} style={{ background: '#fef2f2', border: 'none', borderRadius: 8, padding: '0 10px', color: '#ef4444', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setEditingConfigs([...editingConfigs, ''])} style={{ width: '100%', padding: '8px', background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 10, color: '#6366f1', fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>+ 新增品名</button>
            <button onClick={syncSettings} style={{ width: '100%', padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 16, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>確認並同步</button>
          </div>
        </div>
      )}

      {/* 狀態日期 Modal */}
      {statusModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 320, borderRadius: 24, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>{statusModal.label}</h2>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              {statusModal.order.customer_name || statusModal.order.customerName} ・ {statusModal.order.item_name || statusModal.order.itemName}
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>
                {statusModal.nextStatus === 'scheduled' ? '排程生產日' : statusModal.nextStatus === 'prepared' ? '完成備貨日期' : '確認出貨日期'}
              </div>
              <input type="date" value={statusDate} onChange={e => setStatusDate(e.target.value)}
                style={{ width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px', fontFamily: 'inherit', fontSize: 15 }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStatusModal(null)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>取消</button>
              <button onClick={async () => {
                const states = ['pending', 'scheduled', 'prepared', 'shipped']
                const updateData = { status: statusModal.nextStatus, updated_at: new Date().toISOString() }
                if (statusModal.nextStatus === 'scheduled') updateData.scheduled_date = statusDate
                await supabase.from('adv_orders').update(updateData).eq('id', statusModal.order.id)
                fetchOrders()
                showToast(`${statusModal.label} ✅`)
                setStatusModal(null)
              }} style={{ flex: 2, padding: '11px', background: th.header, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 900, cursor: 'pointer' }}>確認 {statusModal.label}</button>
            </div>
          </div>
        </div>
      )}

      {/* 確認視窗 */}
      {isConfirmOpen && pendingOrderData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 360, borderRadius: 28, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#3730a3', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>🛡️ 請確認訂單內容</h2>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 3 }}>客戶：<strong style={{ color: '#1e293b' }}>{pendingOrderData.customer_name}</strong></div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 3 }}>品項：<strong style={{ color: '#4f46e5' }}>{pendingOrderData.item_name}</strong></div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 10 }}>出貨日：<strong style={{ color: '#dc2626' }}>{pendingOrderData.target_date}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>訂購數量</div>
                  <div style={{ fontSize: 26, fontWeight: 900 }}>{pendingOrderData.quantity} <span style={{ fontSize: 13, color: '#94a3b8' }}>袋</span></div>
                  {pendingOrderData.box_count > 0 && <div style={{ fontSize: 12, color: '#64748b' }}>{pendingOrderData.box_count}箱 × {pendingOrderData.box_qty_each}袋</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>每袋重量</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>{pendingOrderData.weight_per_bag}g</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {(pendingOrderData.box_type||pendingOrderData.boxType) && <div style={{ background: '#eff6ff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>📦 {pendingOrderData.box_type||pendingOrderData.boxType}</div>}
              {(pendingOrderData.items_per_box||pendingOrderData.itemsPerBox||0) > 0 && <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#166534' }}>每箱{pendingOrderData.items_per_box||pendingOrderData.itemsPerBox}袋</div>}
              {(pendingOrderData.shipping_mark||pendingOrderData.shippingMark) && <div style={{ background: '#fef2f2', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>🏷️ 一般麥頭</div>}
              {pendingOrderData.color_mark && <div style={{ background: '#fdf4ff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#7e22ce' }}>🎨 彩色麥頭{pendingOrderData.color_mark_note ? `(${pendingOrderData.color_mark_note})` : ''}</div>}
            </div>
            <button onClick={executeSave} style={{ width: '100%', padding: '12px', background: '#059669', color: '#fff', border: 'none', borderRadius: 16, fontWeight: 900, fontSize: 15, cursor: 'pointer', marginBottom: 8 }}>確認無誤，正式存檔</button>
            <button onClick={() => setIsConfirmOpen(false)} style={{ width: '100%', padding: '10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 16, fontWeight: 700, cursor: 'pointer' }}>返回修改</button>
          </div>
        </div>
      )}

      {/* 新增/編輯表單 */}
      {isFormOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 50, overflowY: 'auto', padding: '16px 16px 60px' }}>
          <form onSubmit={handleFormSubmit} style={{ background: '#fff', width: '100%', maxWidth: 440, borderRadius: 28, padding: 24, margin: '0 auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 900 }}>{editingOrderId ? '修改訂單' : '新增客訂訂單'}</h2>
              <button type="button" onClick={closeForm} style={{ background: '#f8fafc', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer' }}>✕</button>
            </div>

            {formError && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 12, color: '#dc2626', fontWeight: 700, fontSize: 14 }}>⚠️ {formError}</div>}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>客戶名稱 *</div>
              <input type="text" name="customer_name" value={formData.customer_name} onChange={handleInputChange} style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px 14px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit' }} placeholder="例如：麗合-本院" inputMode="text" lang="zh-TW" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: '#059669', fontWeight: 700, marginBottom: 4 }}>排程生產日</div>
                <input type="date" name="scheduled_date" value={formData.scheduled_date} onChange={handleInputChange} style={{ width: '100%', background: '#f0fdf4', border: 'none', borderRadius: 12, padding: '10px', fontFamily: 'inherit' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>指定出貨日 *</div>
                <input type="date" name="target_date" value={formData.target_date} onChange={handleInputChange} style={{ width: '100%', background: '#fef2f2', border: 'none', borderRadius: 12, padding: '10px', fontFamily: 'inherit' }} />
              </div>
            </div>

            <div style={{ background: '#eef2ff', borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5', marginBottom: 10 }}>🚛 理貨與裝箱資訊</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 3 }}>物流方式</div>
                  <select name="logistics" value={formData.logistics} onChange={handleInputChange} style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }}>
                    <option value="">請選擇</option>
                    <option>黑貓</option><option>新竹</option><option>大榮</option><option>自取</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 3 }}>外箱規格</div>
                  <select name="box_type" value={formData.box_type} onChange={handleInputChange} style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }}>
                    <option value="">請選擇</option>
                    <option>大紙箱</option><option>中紙箱</option><option>大紙箱(空白)</option><option>中紙箱(空白)</option><option>中箱專用箱</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 3 }}>箱入數（每箱幾袋）</div>
                <input type="number" name="items_per_box" value={formData.items_per_box} onChange={e => {
                    handleInputChange(e)
                    const v = e.target.value
                    if (v && parseInt(v) > 0) { setUseBoxCalc(true); setBoxQtyInput(v) }
                    else { setUseBoxCalc(false); setBoxQtyInput('') }
                  }} style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }} placeholder="例如：5（填了自動換算）" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', padding: '7px 10px', borderRadius: 10, cursor: 'pointer', flex: 1 }}>
                  <input type="checkbox" name="shipping_mark" checked={formData.shipping_mark} onChange={handleInputChange} style={{ width: 15, height: 15 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>🏷️ 一般麥頭</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', padding: '7px 10px', borderRadius: 10, cursor: 'pointer', flex: 1 }}>
                  <input type="checkbox" name="color_mark" checked={formData.color_mark} onChange={handleInputChange} style={{ width: 15, height: 15 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#7e22ce' }}>🎨 彩色麥頭</span>
                </label>
              </div>
              {formData.color_mark && (
                <input type="text" name="color_mark_note" value={formData.color_mark_note} onChange={handleInputChange} placeholder="顏色說明（例：紅色）" style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', marginTop: 6, fontSize: 13 }} />
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>口味品項規格 *</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select name="item_name" value={formData.item_name} onChange={handleInputChange} style={{ flex: 1, background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px 14px', fontWeight: 700, fontFamily: 'inherit' }}>
                  <option value="">請選擇規格</option>
                  {savedItems.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <button type="button" onClick={() => setIsAddingNewItem(true)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 12, padding: '0 14px', fontWeight: 700, color: '#4f46e5', cursor: 'pointer' }}>+</button>
              </div>
            </div>

            {isAddingNewItem && (
              <div style={{ display: 'flex', gap: 6, background: '#fffbeb', padding: 10, borderRadius: 12, marginBottom: 12 }}>
                <input type="text" value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="新規格名稱..." style={{ flex: 1, border: 'none', background: '#fff', borderRadius: 8, padding: '6px 10px', fontFamily: 'inherit' }} />
                <button type="button" onClick={saveNewFlavor} style={{ background: '#d97706', color: '#fff', border: 'none', borderRadius: 8, padding: '0 12px', fontWeight: 700, cursor: 'pointer' }}>存</button>
                <button type="button" onClick={() => setIsAddingNewItem(false)} style={{ color: '#94a3b8', border: 'none', background: 'none', cursor: 'pointer', padding: '0 6px' }}>✕</button>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>訂購數量 *</div>
  <span style={{ fontSize: 12, color: '#6366f1' }}>{useBoxCalc ? '箱數換算模式' : '直接填袋數'}</span>
              </div>
              {useBoxCalc ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 6, alignItems: 'center' }}>
                  <input type="number" value={boxCountInput} onChange={e => setBoxCountInput(e.target.value)} placeholder="箱數" style={{ background: '#f8fafc', border: 'none', borderRadius: 10, padding: '10px', fontSize: 16, fontWeight: 700, textAlign: 'center', fontFamily: 'inherit' }} />
                  <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>箱×</span>
                  <input type="number" value={boxQtyInput} onChange={e => setBoxQtyInput(e.target.value)} placeholder="每箱袋數" style={{ background: '#f8fafc', border: 'none', borderRadius: 10, padding: '10px', fontSize: 16, fontWeight: 700, textAlign: 'center', fontFamily: 'inherit' }} />
                  <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>袋=</span>
                  <div style={{ background: '#ecfdf5', borderRadius: 10, padding: '10px', fontSize: 18, fontWeight: 900, textAlign: 'center', color: '#059669' }}>{calcedQty || '?'}</div>
                </div>
              ) : (
                <input type="number" name="quantity" value={formData.quantity} onChange={handleInputChange} placeholder="袋數" style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px', fontSize: 20, fontWeight: 900, textAlign: 'center', fontFamily: 'inherit' }} />
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>每袋重量(g)</div>
              <input type="number" name="weight_per_bag" value={formData.weight_per_bag} onChange={handleInputChange} style={{ width: '100%', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px', fontSize: 16, fontWeight: 900, color: '#ef4444', textAlign: 'center', fontFamily: 'inherit' }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>特殊備註</div>
              <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '10px 12px', fontFamily: 'inherit', resize: 'none' }} />
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 12, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" name="is_mixed_box" checked={formData.is_mixed_box} onChange={handleInputChange} style={{ width: 17, height: 17, marginTop: 1 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>併箱口味（儲存後保留客戶與日期，方便輸入下一項）</span>
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={closeForm} style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: 14, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>取消</button>
              {!editingOrderId && formData.isMixedBox ? (
                <div style={{ flex: 2.5, display: 'flex', gap: 6 }}>
                  <button type="submit" onClick={() => { submitActionRef.current = 'continue' }} style={{ flex: 1, padding: '12px', background: '#fef3c7', border: 'none', borderRadius: 14, fontWeight: 700, color: '#92400e', cursor: 'pointer' }}>儲存續打</button>
                  <button type="submit" onClick={() => { submitActionRef.current = 'finish' }} style={{ flex: 1, padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 14, fontWeight: 700, cursor: 'pointer' }}>完成裝箱</button>
                </div>
              ) : (
                <button type="submit" onClick={() => { submitActionRef.current = 'normal' }} style={{ flex: 2.5, padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 14, fontWeight: 900, cursor: 'pointer' }}>確認儲存</button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
