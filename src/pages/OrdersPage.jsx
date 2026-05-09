import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'

const PORTAL = 'https://company-portal-dusky.vercel.app/'

export default function OrdersPage({ user }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [flavorConfigs, setFlavorConfigs] = useState({ '黃金滿福餃(營業用)': 40, '泡菜滿福餃(營業用)': 40, '素花滿福餃(營業用)': 40, '新鮮蔬滿福餃(營業用)': 30, '剝皮辣椒滿福餃(營業用)': 30, '酸白菜滿福餃(營業用)': 30, '自然齋香羹(營業用)': 1, '黃金滿福餃散裝': 40 })
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
  const submitActionRef = useRef('normal')
  const [formData, setFormData] = useState({
    customerName: '', itemName: '', quantity: '', unit: '袋', piecesPerUnit: 250,
    logistics: '', boxType: '', itemsPerBox: '', shippingMark: false,
    isMixedBox: false, targetDate: '', scheduledDate: '', notes: ''
  })

  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await supabase.from('adv_orders').select('*').order('created_at', { ascending: false })
      if (!error && data) setOrders(data)
      setLoading(false)
    }
    fetchOrders()
    const channel = supabase.channel('adv_orders').on('postgres_changes', { event: '*', schema: 'public', table: 'adv_orders' }, () => fetchOrders()).subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  useEffect(() => {
    const fetchConfig = async () => {
      const { data } = await supabase.from('adv_flavor_config').select('*').single()
      if (data) { setFlavorConfigs(data.configs || {}); setSavedItems(data.items || []) }
    }
    fetchConfig()
  }, [])

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const getNormalBasis = name => flavorConfigs[name] || (name.includes('香羹') ? 1 : 40)

  const handleInputChange = e => {
    const { name, value, type, checked } = e.target
    if (name === 'itemName') {
      setFormData(p => ({ ...p, [name]: value, piecesPerUnit: value.includes('香羹') ? 6 : 250 }))
    } else {
      setFormData(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }))
    }
  }

  const handleFormSubmit = e => {
    e.preventDefault()
    const finalData = {
      ...formData,
      quantity: Math.round(Number(formData.quantity)) || 0,
      piecesPerUnit: Number(formData.piecesPerUnit) || 0,
      itemsPerBox: Math.round(Number(formData.itemsPerBox)) || 0,
      customerName: formData.customerName.trim(),
      notes: formData.notes?.trim() || ''
    }
    setPendingOrderData(finalData)
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
      if (formData.isMixedBox && submitActionRef.current === 'continue' && !editingOrderId) {
        setFormData(p => ({ ...p, itemName: '', quantity: '', notes: '' }))
        setIsConfirmOpen(false); setPendingOrderData(null)
      } else { setIsConfirmOpen(false); setPendingOrderData(null); closeForm() }
    } catch { alert('儲存失敗，請重試。') }
  }

  const changeStatus = async (order, direction) => {
    const states = ['pending', 'scheduled', 'prepared', 'shipped']
    const idx = states.indexOf(order.status)
    const next = Math.max(0, Math.min(states.length-1, idx+direction))
    const { error } = await supabase.from('adv_orders').update({ status: states[next], updated_at: new Date().toISOString() }).eq('id', order.id)
    if (!error) showToast(`狀態更新：${['待安排','已排程','已備貨','已出貨'][next]}`)
  }

  const closeForm = () => {
    setIsFormOpen(false); setEditingOrderId(null); setIsAddingNewItem(false)
    setFormData({ customerName: '', itemName: '', quantity: '', unit: '袋', piecesPerUnit: 250, logistics: '', boxType: '', itemsPerBox: '', shippingMark: false, isMixedBox: false, targetDate: '', scheduledDate: '', notes: '' })
  }

  const openEditForm = order => { setFormData({ ...order }); setEditingOrderId(order.id); setIsFormOpen(true) }

  const deleteOrder = async id => {
    if (!confirm('確定要永久刪除這筆單嗎？')) return
    await supabase.from('adv_orders').delete().eq('id', id)
  }

  const saveNewFlavor = async () => {
    if (!newItemName.trim()) return
    const items = [...savedItems, newItemName.trim()]
    const configs = { ...flavorConfigs, [newItemName.trim()]: newItemName.includes('香羹') ? 1 : 40 }
    const { error } = await supabase.from('adv_flavor_config').upsert({ id: 'default', configs, items, updated_at: new Date().toISOString() })
    if (!error) { setFormData(p => ({ ...p, itemName: newItemName.trim(), piecesPerUnit: newItemName.includes('香羹') ? 6 : 250 })); setNewItemName(''); setIsAddingNewItem(false); showToast('規格新增成功 ✅') }
  }

  const openSettings = () => {
    setEditingConfigs(savedItems.map(name => ({ oldName: name, newName: name, basis: flavorConfigs[name] || 40 })))
    setIsSettingsOpen(true)
  }

  const syncSettings = async () => {
    const newItems = editingConfigs.map(c => c.newName.trim())
    const newConfigs = {}
    editingConfigs.forEach(c => { newConfigs[c.newName.trim()] = Number(c.basis) || 0 })
    const { error } = await supabase.from('adv_flavor_config').upsert({ id: 'default', configs: newConfigs, items: newItems, updated_at: new Date().toISOString() })
    if (!error) { setIsSettingsOpen(false); showToast('品名與基準已同步 ✅') }
  }

  const sortedOrders = useMemo(() => [...orders].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)), [orders])
  const filteredOrders = sortedOrders.filter(o => o.status === activeTab && (o.itemName||'').includes(filterFlavor))
  const groupedByCustomer = filteredOrders.reduce((acc, o) => { const k = o.customerName||'未知客戶'; if(!acc[k])acc[k]=[]; acc[k].push(o); return acc }, {})

  const formatDate = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''
  const getNextWeekRange = date => {
    const d = new Date(date), day = d.getDay()
    const nMon = new Date(d); nMon.setDate(d.getDate() + ((8-day)%7||7))
    const nFri = new Date(nMon); nFri.setDate(nMon.getDate()+4)
    return { start: nMon, end: nFri }
  }
  const nextWeek = getNextWeekRange(selectedDate)
  const nextWeekSummary = sortedOrders.filter(o => { if(!o.targetDate)return false; const d=new Date(o.targetDate); return d>=nextWeek.start&&d<=nextWeek.end }).reduce((acc,o) => { if(!acc[o.itemName])acc[o.itemName]={qty:0,pieces:0,unit:o.unit}; acc[o.itemName].qty+=Number(o.quantity); acc[o.itemName].pieces+=Number(o.quantity)*Number(o.piecesPerUnit||0); return acc }, {})
  const customerSummary = sortedOrders.filter(o => o.targetDate === formatDate(selectedDate)).reduce((acc,o) => { if(!acc[o.customerName])acc[o.customerName]={items:[],totalBags:0}; acc[o.customerName].items.push(o); acc[o.customerName].totalBags+=Number(o.quantity); return acc }, {})
  const calendarData = useMemo(() => {
    const year = currentMonth.getFullYear(), month = currentMonth.getMonth()
    const firstDay = new Date(year,month,1).getDay(), totalDays = new Date(year,month+1,0).getDate()
    const days = []
    for(let i=0;i<firstDay;i++) days.push(null)
    for(let i=1;i<=totalDays;i++) days.push(new Date(year,month,i))
    return days
  }, [currentMonth])

  const THEME = {
    pending:   { bg: '#fffbeb', header: '#f59e0b', accent: '#92400e', btn: '#d97706', border: '#fde68a' },
    scheduled: { bg: '#f0fdf4', header: '#10b981', accent: '#065f46', btn: '#059669', border: '#a7f3d0' },
    prepared:  { bg: '#eff6ff', header: '#3b82f6', accent: '#1e3a8a', btn: '#2563eb', border: '#bfdbfe' },
    shipped:   { bg: '#f8fafc', header: '#64748b', accent: '#1e293b', btn: '#475569', border: '#e2e8f0' },
    stats:     { bg: '#fff1f2', header: '#f43f5e', accent: '#881337', btn: '#e11d48', border: '#fecdd3' },
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

      {/* Header */}
      <div style={{ background: th.header, color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, fontWeight: 900 }}>🥟 客訂管理系統</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={openSettings} style={{ background: 'rgba(255,255,255,.2)', border: 'none', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>⚙️</button>
          <button onClick={() => { closeForm(); setIsFormOpen(true) }} style={{ background: '#fff', color: '#1e293b', border: 'none', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>新增客訂</button>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '12px 16px' }}>
        {/* 子頁簽 */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,.5)', borderRadius: 16, padding: 4, marginBottom: 12, gap: 2, overflowX: 'auto' }}>
          {[['pending','待安排'],['scheduled','已排程'],['prepared','已備貨'],['shipped','已出貨'],['stats','日曆統計']].map(([t,l]) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, minWidth: 60, padding: '8px 4px', borderRadius: 12, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: activeTab===t ? th.header : 'transparent', color: activeTab===t ? '#fff' : '#94a3b8', transition: 'all .15s' }}>{l}</button>
          ))}
        </div>

        {activeTab !== 'stats' && (
          <input type="text" placeholder="🔍 篩選口味..." value={filterFlavor} onChange={e => setFilterFlavor(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,.8)', border: 'none', borderRadius: 16, padding: '12px 16px', fontSize: 13, fontWeight: 700, marginBottom: 12, fontFamily: 'inherit' }} />
        )}

        {activeTab !== 'stats' ? (
          Object.keys(groupedByCustomer).length === 0
            ? <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontStyle: 'italic' }}>目前無資料</div>
            : Object.entries(groupedByCustomer).map(([name, list]) => (
              <div key={name} style={{ background: '#fff', borderRadius: 24, border: `1px solid ${th.border}`, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ background: 'rgba(255,255,255,.5)', padding: '12px 16px', borderBottom: `1px solid ${th.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 900, color: '#475569' }}>{name}</span>
                    {list[0]?.shippingMark && <span style={{ fontSize: 10, background: '#fef2f2', color: '#ef4444', padding: '1px 8px', borderRadius: 20, fontWeight: 700 }}>🏷️ 需麥頭</span>}
                  </div>
                  <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '3px 10px', borderRadius: 20, fontWeight: 700 }}>{list[0]?.logistics || '物流未定'}</span>
                </div>
                {list.map(o => {
                  const basis = getNormalBasis(o.itemName)
                  const packCount = Math.round((Number(o.quantity)*Number(o.piecesPerUnit))/basis)
                  const ipb = Math.round(Number(o.itemsPerBox))||0
                  let boxDisplay = ''
                  if (ipb > 0) { const boxes=Math.floor(Number(o.quantity)/ipb),rem=Number(o.quantity)%ipb; boxDisplay=`${boxes} 箱${rem>0?` + ${rem} 袋`:''}` }
                  return (
                    <div key={o.id} style={{ padding: '16px', borderBottom: `1px solid #f8fafc` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ flex: 1, paddingRight: 12 }}>
                          <div style={{ fontSize: 18, fontWeight: 900, color: th.accent, marginBottom: 4 }}>{o.itemName}</div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {o.isMixedBox && <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>併箱裝</span>}
                            <span style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>{o.piecesPerUnit}{o.itemName?.includes('香羹')?'kg':'顆'}/袋</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 28, fontWeight: 900, color: '#1e293b' }}>{o.quantity} <span style={{ fontSize: 12, color: '#94a3b8' }}>{o.unit}</span></div>
                          <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4, padding: '3px 8px', borderRadius: 6, display: 'inline-block', background: th.bg, color: th.accent }}>= {packCount} 包正常量</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        {ipb > 0 && <div style={{ background: '#f0fdf4', padding: '4px 10px', borderRadius: 8, color: '#166534', fontSize: 12, fontWeight: 700 }}>📦 {boxDisplay}</div>}
                        {o.boxType && <div style={{ background: '#eff6ff', padding: '4px 10px', borderRadius: 8, color: '#1d4ed8', fontSize: 12, fontWeight: 700 }}>外箱：{o.boxType}</div>}
                        {o.notes && <div style={{ background: '#f8fafc', padding: '4px 10px', borderRadius: 8, color: '#475569', fontSize: 12, fontWeight: 700, flex: 1 }}>📝 {o.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px dashed #f1f5f9' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>
                          <div>排程：{o.scheduledDate || '未定'}</div>
                          <div style={{ fontWeight: 700, color: th.accent }}>出貨：{o.targetDate || '未定'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => openEditForm(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 6px' }}>✏️</button>
                          <button onClick={() => deleteOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 6px' }}>🗑️</button>
                          <button onClick={() => changeStatus(o, -1)} disabled={o.status==='pending'} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', padding: '4px 8px', color: o.status==='pending'?'#e2e8f0':'#475569' }}>‹</button>
                          <button onClick={() => changeStatus(o, 1)} style={{ background: th.header, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', padding: '6px 14px', fontWeight: 700, fontSize: 12 }}>
                            {o.status==='pending'?'排入行程':o.status==='scheduled'?'完成備貨':o.status==='prepared'?'確認出貨':'維持現狀'} ›
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
        ) : (
          /* 日曆統計 */
          <div>
            <div style={{ background: '#fff', borderRadius: 24, padding: 20, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth()-1)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: th.header }}>‹</button>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{currentMonth.getFullYear()}年 {currentMonth.getMonth()+1}月</div>
                <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth()+1)))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: th.header }}>›</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
                {['日','一','二','三','四','五','六'].map(d => <div key={d} style={{ fontSize: 11, color: '#94a3b8', paddingBottom: 4 }}>{d}</div>)}
                {calendarData.map((d, i) => {
                  if (!d) return <div key={`e${i}`}></div>
                  const ds = formatDate(d), isSel = selectedDate && ds === formatDate(selectedDate)
                  const hasOrders = orders.filter(o => o.targetDate===ds).length > 0
                  return (
                    <button key={ds} onClick={() => setSelectedDate(d)} style={{ aspectRatio: '1', borderRadius: 12, border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: isSel ? th.header : 'transparent', color: isSel ? '#fff' : '#1e293b', fontWeight: isSel ? 900 : 400 }}>
                      <span style={{ fontSize: 12 }}>{d.getDate()}</span>
                      {hasOrders && <div style={{ width: 5, height: 5, borderRadius: '50%', background: isSel ? '#fff' : th.header, marginTop: 1 }}></div>}
                    </button>
                  )
                })}
              </div>
            </div>
            {selectedDate && (
              <>
                <div style={{ background: th.header, borderRadius: 20, padding: 20, marginBottom: 12, color: '#fff' }}>
                  <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 12, borderBottom: 'rgba(255,255,255,.3) solid 1px', paddingBottom: 8 }}>每週領料總計（{formatDate(nextWeek.start)} ~ {formatDate(nextWeek.end)}）</div>
                  {Object.entries(nextWeekSummary).map(([name, data]) => (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,.1)', padding: '10px 12px', borderRadius: 12, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700 }}>{name}</span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, fontSize: 18 }}>{data.qty} <span style={{ fontSize: 11 }}>{data.unit}</span></div>
                        <div style={{ fontSize: 10, background: '#fff', color: th.header, padding: '1px 6px', borderRadius: 4, display: 'inline-block', marginTop: 2 }}>= {Math.round(data.pieces/getNormalBasis(name))} 包量</div>
                      </div>
                    </div>
                  ))}
                  {Object.keys(nextWeekSummary).length === 0 && <p style={{ textAlign: 'center', opacity: .6, fontSize: 12 }}>無紀錄</p>}
                </div>
                <div style={{ background: '#fff', borderRadius: 20, padding: 20 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 12, borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>📦 理貨清單 — {formatDate(selectedDate)}</div>
                  {Object.entries(customerSummary).map(([name, data]) => (
                    <div key={name} style={{ border: '1px solid #f1f5f9', borderRadius: 16, overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ background: '#f8fafc', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
                        <div>{name} {data.items[0]?.shippingMark && <span style={{ fontSize: 9, background: '#fef2f2', color: '#ef4444', padding: '1px 5px', borderRadius: 4 }}>標</span>}</div>
                        <span>{data.totalBags} 袋</span>
                      </div>
                      {data.items.map(item => (
                        <div key={item.id} style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f8fafc', fontSize: 13 }}>
                          <span style={{ color: '#475569' }}>{item.itemName}</span>
                          <span style={{ color: th.header, fontWeight: 700 }}>{item.quantity} {item.unit}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {Object.keys(customerSummary).length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>當日無出貨紀錄</p>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 設定視窗 */}
      {isSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 420, borderRadius: 28, padding: 24, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 900 }}>口味品名與基準管理</h2>
              <button onClick={() => setIsSettingsOpen(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            {editingConfigs.map((item, i) => (
              <div key={i} style={{ background: '#f8fafc', padding: 12, borderRadius: 12, marginBottom: 8 }}>
                <input type="text" value={item.newName} onChange={e => { const n=[...editingConfigs]; n[i].newName=e.target.value; setEditingConfigs(n) }} style={{ width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontWeight: 700, color: '#4f46e5', marginBottom: 6, fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>零售基準：</span>
                  <input type="number" step="0.1" value={item.basis} onChange={e => { const n=[...editingConfigs]; n[i].basis=e.target.value; setEditingConfigs(n) }} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px', textAlign: 'center', fontWeight: 700, color: '#ef4444', fontFamily: 'inherit' }} />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.newName?.includes('香羹')?'kg/包':'顆/包'}</span>
                </div>
              </div>
            ))}
            <button onClick={syncSettings} style={{ width: '100%', padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 16, fontWeight: 900, fontSize: 15, cursor: 'pointer', marginTop: 8 }}>確認並同步選單</button>
          </div>
        </div>
      )}

      {/* 確認視窗 */}
      {isConfirmOpen && pendingOrderData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 360, borderRadius: 28, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#3730a3', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>🛡️ 請確認訂單內容</h2>
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>客戶：<strong style={{ color: '#1e293b' }}>{pendingOrderData.customerName}</strong></div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>品項：<strong style={{ color: '#4f46e5' }}>{pendingOrderData.itemName}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                <div><div style={{ fontSize: 11, color: '#94a3b8' }}>訂購數量</div><div style={{ fontSize: 28, fontWeight: 900 }}>{pendingOrderData.quantity} <span style={{ fontSize: 12, color: '#94a3b8' }}>{pendingOrderData.unit}</span></div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: '#94a3b8' }}>實裝量</div><div style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>{pendingOrderData.piecesPerUnit}{pendingOrderData.itemName?.includes('香羹')?'kg':'顆'}/袋</div></div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <div style={{ flex: 1, background: '#eff6ff', borderRadius: 10, padding: '8px', fontSize: 11, fontWeight: 700, color: '#1d4ed8' }}>📦 {pendingOrderData.boxType||'外箱未選'}</div>
              <div style={{ flex: 1, background: '#f0fdf4', borderRadius: 10, padding: '8px', fontSize: 11, fontWeight: 700, color: '#166534' }}>🔢 {pendingOrderData.itemsPerBox||'箱入未定'}</div>
            </div>
            <button onClick={executeSave} style={{ width: '100%', padding: '12px', background: '#059669', color: '#fff', border: 'none', borderRadius: 16, fontWeight: 900, fontSize: 15, cursor: 'pointer', marginBottom: 8 }}>確認無誤，正式存檔</button>
            <button onClick={() => setIsConfirmOpen(false)} style={{ width: '100%', padding: '10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 16, fontWeight: 700, cursor: 'pointer' }}>返回修改</button>
          </div>
        </div>
      )}

      {/* 表單 */}
      {isFormOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16, overflowY: 'auto' }}>
          <form onSubmit={handleFormSubmit} style={{ background: '#fff', width: '100%', maxWidth: 440, borderRadius: 28, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.2)', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 900 }}>{editingOrderId ? '修改訂單' : '新增排程訂單'}</h2>
              <button type="button" onClick={closeForm} style={{ background: '#f8fafc', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>客戶名稱 *</div>
              <input type="text" name="customerName" required value={formData.customerName} onChange={handleInputChange} style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px 14px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit' }} placeholder="例如：麗合-本院" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div><div style={{ fontSize: 11, color: '#059669', fontWeight: 700, marginBottom: 4 }}>排程生產日</div><input type="date" name="scheduledDate" value={formData.scheduledDate} onChange={handleInputChange} style={{ width: '100%', background: '#f0fdf4', border: 'none', borderRadius: 12, padding: '10px', fontFamily: 'inherit' }} /></div>
              <div><div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>指定出貨日</div><input type="date" name="targetDate" value={formData.targetDate} onChange={handleInputChange} style={{ width: '100%', background: '#fef2f2', border: 'none', borderRadius: 12, padding: '10px', fontFamily: 'inherit' }} /></div>
            </div>
            <div style={{ background: '#eef2ff', borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#4f46e5', marginBottom: 10 }}>🚛 理貨與裝箱資訊</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div><div style={{ fontSize: 10, color: '#6366f1', marginBottom: 3 }}>物流方式</div><select name="logistics" value={formData.logistics} onChange={handleInputChange} style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit', appearance: 'none' }}><option value="">請選擇</option><option>黑貓</option><option>新竹</option><option>大榮</option></select></div>
                <div><div style={{ fontSize: 10, color: '#6366f1', marginBottom: 3 }}>外箱規格</div><select name="boxType" value={formData.boxType} onChange={handleInputChange} style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit', appearance: 'none' }}><option value="">請選擇</option><option>大紙箱</option><option>中紙箱</option><option>大紙箱(空白)</option><option>中紙箱(空白)</option><option>中箱專用箱</option></select></div>
              </div>
              <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: '#6366f1', marginBottom: 3 }}>箱入數（每箱幾袋）</div><input type="number" name="itemsPerBox" value={formData.itemsPerBox} onChange={handleInputChange} style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }} placeholder="例如：5" /></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', padding: '8px 10px', borderRadius: 10, cursor: 'pointer' }}>
                <input type="checkbox" name="shippingMark" checked={formData.shippingMark} onChange={handleInputChange} style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>外箱需貼麥頭標誌</span>
              </label>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>口味品項規格 *</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select name="itemName" required value={formData.itemName} onChange={handleInputChange} style={{ flex: 1, background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px 14px', fontWeight: 700, fontFamily: 'inherit', appearance: 'none' }}>
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
                <button type="button" onClick={() => setIsAddingNewItem(false)} style={{ color: '#94a3b8', fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer', padding: '0 6px' }}>✕</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 2 }}><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>訂購數量 *</div><input type="number" name="quantity" required value={formData.quantity} onChange={handleInputChange} style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px', fontSize: 20, fontWeight: 900, textAlign: 'center', fontFamily: 'inherit' }} /></div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>單位</div><select name="unit" value={formData.unit} onChange={handleInputChange} style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px', fontWeight: 700, textAlign: 'center', fontFamily: 'inherit', appearance: 'none' }}><option>袋</option><option>包</option></select></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>{formData.itemName?.includes('香羹') ? '實裝重量(kg)/袋' : '實裝顆數/袋'} *</div>
              <input type="number" step="0.1" name="piecesPerUnit" required value={formData.piecesPerUnit} onChange={handleInputChange} style={{ width: '100%', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px', fontSize: 16, fontWeight: 900, color: '#ef4444', textAlign: 'center', fontFamily: 'inherit' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>特殊備註</div>
              <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '10px 12px', fontFamily: 'inherit', resize: 'none' }} />
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 12, cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" name="isMixedBox" checked={formData.isMixedBox} onChange={handleInputChange} style={{ width: 18, height: 18, marginTop: 1 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>併箱口味（儲存後保留客戶與日期，方便輸入下一項）</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={closeForm} style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: 14, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>取消</button>
              {!editingOrderId && formData.isMixedBox ? (
                <div style={{ flex: 2.5, display: 'flex', gap: 6 }}>
                  <button type="submit" onClick={() => submitActionRef.current='continue'} style={{ flex: 1, padding: '12px', background: '#fef3c7', border: 'none', borderRadius: 14, fontWeight: 700, color: '#92400e', cursor: 'pointer', fontSize: 12 }}>儲存續打</button>
                  <button type="submit" onClick={() => submitActionRef.current='finish'} style={{ flex: 1, padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 14, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>完成裝箱</button>
                </div>
              ) : (
                <button type="submit" onClick={() => submitActionRef.current='normal'} style={{ flex: 2.5, padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 14, fontWeight: 900, cursor: 'pointer' }}>確認儲存</button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
