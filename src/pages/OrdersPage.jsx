import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { toIso, todayIso, addDays, isoOf, parseIso, mdOf, wdOf } from '../lib/flavors'
import { loadPage, savePageData } from '../lib/pageSave'

// 訂單流程（資料庫狀態值不變，只改顯示名稱）：
// 預排客訂(客戶服務科) → 等待排程(生產排程科) → 包材準備(原物料倉庫管理科) → 完成備貨(包裝科) → 確認出貨(出貨交運科) → 完成出貨
const STATES = ['preorder', 'pending', 'packaging', 'scheduled', 'prepared', 'shipped']
const STAGE = {
  preorder:  { tab: '預排客訂', dept: '客戶服務科',       action: '確認訂單', note: '客戶已確認品項與數量，轉給生產排程科排程。出貨日還不知道可以先空著，排好生產後再到卡片按「🚚 定出貨日」。' },
  pending:   { tab: '等待排程', dept: '生產排程科',       action: '排入行程', dateLabel: '排程生產日' },
  packaging: { tab: '包材準備', dept: '原物料倉庫管理科', action: '包材備妥', note: '確認外箱、麥頭等包材已備妥，交給包裝科備貨。' },
  scheduled: { tab: '完成備貨', dept: '包裝科',           action: '完成備貨', dateLabel: '完成備貨日期' },
  prepared:  { tab: '確認出貨', dept: '出貨交運科',       action: '確認出貨', dateLabel: '確認出貨日期' },
  shipped:   { tab: '完成出貨', dept: '' },
}
// 異常狀態（生產部）：不是流程中的一關，而是系統自動整理「出貨有問題」的客訂，給生產部長做異常通知
const ANOMALY = 'anomaly'
const SOON_DAYS = 2 // 幾天內要出貨、卻還沒完成備貨，算「即將到期」
const ACTIVE = ['pending', 'packaging', 'scheduled', 'prepared'] // 已確認、還沒出貨（生產部要處理的）
const LOST = 'cancelled' // 預排客訂沒成交
const STATUS_LABEL = Object.fromEntries(STATES.map(s => [s, STAGE[s].tab]))
const NEXT_ACTION = Object.fromEntries(STATES.filter(s => STAGE[s].action).map(s => [s, STAGE[s].action]))

// ── 包材：內包裝（彩袋／空白真空袋＋尺寸）＋貼紙（尺寸、送印／自印、內容）＋倉管勾選 ──
// 存在 adv_orders.pack（jsonb），第一次使用要先在 Supabase SQL Editor 執行 PACK_SQL
// carton／cartonNote：外箱貼（跟麥頭分開）；oem：代工品（不進生產排程、不扣庫存）
const EMPTY_PACK = { inner: '', bagSize: '', sticker: false, stickerSize: '', stickerPrint: '', stickerNote: '', carton: false, cartonNote: '', oem: false, checks: {} }
// 尺寸單位：真空袋 cm、貼紙 mm（100×150mm＝10×15 公分）
const DEFAULT_SIZES = { bag: [], sticker: ['100×150'] }
// 內包裝：資料庫存的值不變（原包裝／真空袋），畫面顯示的名稱
const INNER_LABEL = { 原包裝: '彩袋', 真空袋: '空白真空袋' }
const withUnit = (s, u) => (!s ? '' : /[a-zA-Z公毫]/.test(s) ? s : `${s}${u}`) // 舊資料若已含單位就不再加
const bagSizeTxt = s => withUnit(s, 'cm')
const stickerSizeTxt = s => withUnit(s, 'mm')
const innerTxt = pk => (pk.inner === '真空袋' ? `${INNER_LABEL.真空袋} ${bagSizeTxt(pk.bagSize)}` : INNER_LABEL[pk.inner] || pk.inner)
const stickerTxt = pk => [stickerSizeTxt(pk.stickerSize), pk.stickerPrint, pk.stickerNote].filter(Boolean).join('·')
const PACK_SQL = "alter table adv_orders add column if not exists pack jsonb default '{}'::jsonb;"
const CS_SQL = "alter table adv_orders add column if not exists cs jsonb default '{}'::jsonb;"
// 資料庫還沒建立的 jsonb 欄位：先存其他資料，再提醒執行 SQL
const COL_SQL = { pack: PACK_SQL, cs: CS_SQL }
const COL_NAME = { pack: '「包材」', cs: '「客服追蹤」' }
const missingCol = e => (String(e?.message || '').match(/'(\w+)' column/) || [])[1] || ''
const colMsg = cols => `${cols.map(c => COL_NAME[c]).join('、')}欄位還沒建立，這部分資料沒存到。\n請到 Supabase 的 SQL Editor 貼上下面${cols.length > 1 ? '這幾行' : '這一行'}按 Run（只要做一次）：\n\n${cols.map(c => COL_SQL[c]).join('\n')}`
// 尺寸統一寫法：拿掉空白和單位，乘號統一（15cm*25cm → 15×25）
const normSize = s => String(s || '').trim().replace(/\s+/g, '').replace(/(cm|mm|公分|毫米|厘米)/gi, '').replace(/[*xX＊✕]/g, '×')
const uniq = a => [...new Set(a.filter(Boolean))]
const fmtMDHM = iso => {
  const d = new Date(iso)
  return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 這張訂單要準備的包材（包材準備關卡給倉管勾）。勾的時候記下規格（v），之後訂單規格改了就要重新勾
// v 只用資料本身組成，以後改畫面上的名稱不會讓已勾的失效
function packItems(o, boxes) {
  const pk = { ...EMPTY_PACK, ...(o.pack || {}) }
  const ck = pk.checks || {}
  const bags = Number(o.quantity) || 0
  const list = []
  const bt = o.box_type || o.boxType
  if (bt) list.push({ key: 'box', name: '外箱', spec: `${bt}${boxes ? ` × ${boxes} 箱` : ''}`, v: `box|${bt}|${boxes}` })
  if (o.shipping_mark || o.shippingMark) list.push({ key: 'mark', name: '一般麥頭', spec: boxes ? `${boxes} 箱用` : '', v: `mark|${boxes}` })
  if (o.color_mark) list.push({ key: 'color', name: '彩色麥頭', spec: [o.color_mark_note, boxes ? `${boxes} 箱用` : ''].filter(Boolean).join(' · '), v: `color|${o.color_mark_note || ''}|${boxes}` })
  if (pk.carton) list.push({ key: 'carton', name: '外箱貼', spec: [pk.cartonNote, boxes ? `${boxes} 箱用` : ''].filter(Boolean).join(' · '), v: `carton|${pk.cartonNote || ''}|${boxes}` })
  if (pk.inner === '真空袋') list.push({ key: 'inner', name: INNER_LABEL.真空袋, spec: `${bagSizeTxt(pk.bagSize) || '尺寸未填'} × ${bags} 個`, v: `inner|真空袋|${pk.bagSize}|${bags}` })
  if (pk.inner === '原包裝') list.push({ key: 'inner', name: INNER_LABEL.原包裝, spec: `× ${bags} 個`, v: `inner|原包裝|${bags}` })
  if (pk.sticker) list.push({
    key: 'sticker', name: '貼紙',
    spec: [`${stickerSizeTxt(pk.stickerSize) || '尺寸未填'} × ${bags} 張`, pk.stickerPrint, pk.stickerNote].filter(Boolean).join(' · '),
    v: `sticker|${pk.stickerSize}|${pk.stickerPrint}|${pk.stickerNote}|${bags}`,
  })
  return list.map(it => { const c = ck[it.key]; return { ...it, done: !!c && c.v === it.v, at: c?.at } })
}

// 出貨日統一成 YYYY-MM-DD（舊資料可能是 2026/11/4 或 11/4）
export const shipDateOf = o => toIso(o.target_date || o.targetDate)

// 同一個客戶（"-" 前面的母客戶）同一天出貨＝同一批；不管單子走到哪一關都一起算
const parentOf = o => { const n = o.customer_name || o.customerName || '未知客戶'; return n.includes('-') ? n.split('-')[0] : n }
const batchKey = o => `${parentOf(o)}|${shipDateOf(o)}`

// ── 併櫃：出貨日＝併櫃日前 2 個工作天（避開週末、國定假日）。例：11/10（二）併櫃 → 11/6（五）出貨 ──
// 國定假日＝政府行政機關辦公日曆表上，週一～週五放假的日子（每年要補下一年）
const TW_HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27', '2026-04-03', '2026-04-06',
  '2026-05-01', '2026-06-19', '2026-09-25', '2026-09-28', '2026-10-09', '2026-10-26', '2026-12-25',
  '2027-01-01', '2027-02-04', '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10', '2027-03-01', '2027-04-05', '2027-04-06',
  '2027-04-30', '2027-06-09', '2027-09-15', '2027-09-28', '2027-10-11', '2027-10-25', '2027-12-24', '2027-12-31',
])
const MERGE_LEAD = 2 // 併櫃日前幾個工作天出貨
const MERGE_TIMES = ['早上10點', '下午']
// 存在 adv_orders.cs.merge：{ on 要併櫃, date 併櫃日, time 時間, place 地點 }
const EMPTY_MERGE = { on: false, date: '', time: '', place: '' }
const isWorkday = iso => { const d = parseIso(iso); return !!d && d.getDay() !== 0 && d.getDay() !== 6 && !TW_HOLIDAYS.has(iso) }
export const workdaysBefore = (iso, n) => {
  let d = iso, k = 0
  while (d && k < n) { d = addDays(d, -1); if (isWorkday(d)) k++ }
  return d || ''
}
const mergeShipDate = m => (m?.on && m.date ? workdaysBefore(m.date, MERGE_LEAD) : '')
const mergeOf = o => ({ ...EMPTY_MERGE, ...(o?.cs?.merge || {}) })
const mdw = iso => (iso ? `${mdOf(iso)}（${wdOf(iso).slice(1)}）` : '')
const mergeTxt = m => (m?.on && m.date ? `${mdw(m.date)}${m.time ? ` ${m.time}` : ''}併櫃${m.place ? ` · ${m.place}` : ''}` : '')

// ── 品項清單：adv_page_config 'orders' → { itemSpecs: { 品名: { g 每袋重量, big 大箱袋數, mid 中箱袋數, box 預設外箱, pack 固定包材, oem 代工品 } }, places: [{ name, detail }] } ──
// 代工品（例：里仁剝皮辣椒）只在客訂管理跑流程，不進生產排程的客訂出貨、不扣庫存
export const isOemOrder = (o, specs) => !!(o?.pack?.oem || specs?.[o?.item_name || o?.itemName]?.oem)

// ── 箱型：大箱／中箱各放幾袋（品項清單設定；舊資料的 perBox 當大箱）──
const BOX_TYPES = ['大紙箱', '中紙箱', '大紙箱(空白)', '中紙箱(空白)', '中箱專用箱']
const boxKind = t => (String(t || '').startsWith('大') ? 'big' : String(t || '').startsWith('中') ? 'mid' : '')
const perBoxOf = (sp, type) => { const k = boxKind(type); return Number(k === 'big' ? (sp?.big ?? sp?.perBox) : k === 'mid' ? sp?.mid : 0) || 0 }
const specBoxTxt = sp => [perBoxOf(sp, '大紙箱') ? `大箱 ${perBoxOf(sp, '大紙箱')} 袋` : '', perBoxOf(sp, '中紙箱') ? `中箱 ${perBoxOf(sp, '中紙箱')} 袋` : ''].filter(Boolean).join('、')

// ── 交期：付款日＋20 個工作天（要先付款才排生產的單；付款日當天不算）──
const LEAD_DAYS = 20
export const workdaysAfter = (iso, n) => {
  let d = iso, k = 0
  while (d && k < n) { d = addDays(d, 1); if (isWorkday(d)) k++ }
  return d || ''
}
// 出貨安排（確認訂單、定出貨日共用）：付款日、交期天數、出貨日、併櫃
const EMPTY_SHIP = { payDate: '', leadDays: LEAD_DAYS, ship: '', merge: EMPTY_MERGE }
const dueOf = st => (st?.payDate ? workdaysAfter(st.payDate, Number(st.leadDays) || LEAD_DAYS) : '')
const applyShip = (cs, st) => {
  const n = { ...(cs || {}) }
  if (st.payDate) { n.payDate = st.payDate; n.leadDays = Number(st.leadDays) || LEAD_DAYS; n.due = dueOf(st) }
  else { delete n.payDate; delete n.leadDays; delete n.due }
  if (st.merge?.on) n.merge = { on: true, date: st.merge.date, time: (st.merge.time || '').trim(), place: st.merge.place || '' }
  else delete n.merge
  return n
}
// 包材一行字（品項固定規格、卡片用）
const packTxt = pk => [
  pk?.inner ? `${INNER_LABEL[pk.inner] || pk.inner}${pk.inner === '真空袋' && pk.bagSize ? ` ${withUnit(pk.bagSize, 'cm')}` : ''}` : '',
  pk?.sticker ? `貼紙 ${stickerTxt(pk)}` : '',
].filter(Boolean).join('、')
const PACK_KEYS = ['inner', 'bagSize', 'sticker', 'stickerSize', 'stickerPrint', 'stickerNote']
const samePack = (a, b) => PACK_KEYS.every(k => (a?.[k] || '') === (b?.[k] || ''))

// Google 日曆（整天的活動，按下去會開 Google 日曆的新增活動頁，可以選要放哪一個日曆）
const gcalUrl = (title, date, details) =>
  `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent(title)}&dates=${date.replace(/-/g, '')}/${addDays(date, 1).replace(/-/g, '')}&details=${encodeURIComponent(details)}`

// ── 預排客訂：客服追蹤（存在 adv_orders.cs，jsonb）──
// cs = { receivedAt 接單時間, owner 負責人, next 下次追蹤日, logs: [{ at, by, note, next, kind }],
//        confirmedAt/confirmedBy 確認訂單, lostAt/lostBy/lostReason 未成交 }
const LOST_REASONS = ['價格', '交期', '數量', '客戶取消', '其他']
const SHIP_WARN_DAYS = 3 // 出貨日幾天內還沒確認要警示
const dayDiff = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000) // b − a（天）
const localDay = iso => (iso ? isoOf(new Date(iso)) : '')
// 一張預排單的追蹤狀況：overdue 追蹤逾期／today 今天要追蹤／later 之後再追／none 還沒排追蹤日
function csState(o, today) {
  const cs = o.cs || {}
  const next = cs.next || ''
  const td = shipDateOf(o)
  const st = !next ? 'none' : next < today ? 'overdue' : next === today ? 'today' : 'later'
  return {
    st, next, td, logs: cs.logs || [], owner: cs.owner || '',
    received: localDay(cs.receivedAt || o.created_at),
    overdueDays: next && next < today ? dayDiff(next, today) : 0,
    shipSoon: !!td && td <= addDays(today, SHIP_WARN_DAYS),
  }
}
const CS_RANK = { overdue: 0, today: 1, none: 2, later: 3 }
const needsAttention = s => s.st !== 'later' || s.shipSoon // 逾期、今天要追、沒排追蹤日、出貨日快到

// 客服成效（本月）：確認件數、平均確認天數、確認率、準時追蹤率，以及每個人的表現
function csStats(orders, today) {
  const ym = today.slice(0, 7)
  const inMonth = iso => localDay(iso).slice(0, 7) === ym
  const open = orders.filter(o => o.status === 'preorder').map(o => ({ o, s: csState(o, today) }))
  const people = {}
  const P = n => (people[n || '未填'] = people[n || '未填'] || { name: n || '未填', open: 0, logs: 0, onTime: 0, due: 0, confirmed: 0, lost: 0 })
  open.forEach(({ s }) => { const p = P(s.owner); p.open++; if (s.st === 'overdue') p.due++ }) // 逾期未追蹤也算一次該追蹤
  let logs = 0, onTime = 0, due = open.filter(x => x.s.st === 'overdue').length
  const lead = []
  let confirmed = 0, lost = 0
  orders.forEach(o => {
    const cs = o.cs || {}
    const L = cs.logs || []
    L.forEach((l, i) => {
      if (l.kind === 'new' || !inMonth(l.at)) return
      const planned = i > 0 ? L[i - 1].next : ''
      const p = P(l.by)
      logs++; p.logs++
      if (planned) { due++; p.due++; if (localDay(l.at) <= planned) { onTime++; p.onTime++ } }
    })
    if (cs.confirmedAt && inMonth(cs.confirmedAt)) {
      confirmed++; P(cs.owner || cs.confirmedBy).confirmed++ // 成果算在負責人身上
      const d = (new Date(cs.confirmedAt) - new Date(cs.receivedAt || o.created_at)) / 86400000
      if (d >= 0) lead.push(d)
    }
    if (o.status === LOST && cs.lostAt && inMonth(cs.lostAt)) { lost++; P(cs.owner || cs.lostBy).lost++ }
  })
  return {
    ym, open: open.length,
    overdue: open.filter(x => x.s.st === 'overdue').length,
    today: open.filter(x => x.s.st === 'today').length,
    noNext: open.filter(x => x.s.st === 'none').length,
    shipSoon: open.filter(x => x.s.shipSoon).length,
    attention: open.filter(x => needsAttention(x.s)).length,
    confirmed, lost, logs, onTime, due,
    avgLead: lead.length ? lead.reduce((a, b) => a + b, 0) / lead.length : null,
    people: Object.values(people).filter(p => p.open || p.logs || p.confirmed || p.lost).sort((a, b) => (b.confirmed + b.logs) - (a.confirmed + a.logs)),
  }
}
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')

// 異常規則（生產排程頁上方的提示也用這個，兩邊數字才會一致）：
//   只看已確認、還沒出貨的客訂（預排客訂、未成交不算）
//   逾期未出貨＝出貨日已過、還沒完成出貨
//   即將到期＝SOON_DAYS 天內要出貨，但還在等待排程／包材準備／完成備貨（還沒備好貨）
//   出貨日還沒定＝已排入生產（過了等待排程）還沒有出貨日；等待排程還沒定出貨日是正常的（排好生產客服再定）
export function orderAnomalies(orders, today = todayIso()) {
  const soon = addDays(today, SOON_DAYS)
  const res = { late: [], soon: [], noDate: [] }
  orders.forEach(o => {
    if (!ACTIVE.includes(o.status)) return
    const td = shipDateOf(o)
    if (!td) { if (o.status !== 'pending') res.noDate.push(o) } // 等待排程還沒定出貨日是正常的（排程後客服再定）
    else if (td < today) res.late.push(o)
    else if (td <= soon && ['pending', 'packaging', 'scheduled'].includes(o.status)) res.soon.push(o)
  })
  const byDate = (a, b) => shipDateOf(a).localeCompare(shipDateOf(b))
  res.late.sort(byDate); res.soon.sort(byDate)
  res.total = res.late.length + res.soon.length + res.noDate.length
  return res
}

export default function OrdersPage({ user }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [savedItems, setSavedItems] = useState(['黃金滿福餃(營業用)', '泡菜滿福餃(營業用)', '素花滿福餃(營業用)', '新鮮蔬滿福餃(營業用)', '剝皮辣椒滿福餃(營業用)', '酸白菜滿福餃(營業用)', '自然齋香羹(營業用)', '黃金滿福餃散裝'])
  const [editingConfigs, setEditingConfigs] = useState([])
  const TAB_KEYS = [...STATES, ANOMALY]
  const [activeTab, setActiveTabRaw] = useState(() => {
    try { const t = localStorage.getItem('op-tab'); return TAB_KEYS.includes(t) ? t : 'pending' } catch { return 'pending' }
  })
  const setActiveTab = t => { setActiveTabRaw(t); try { localStorage.setItem('op-tab', t) } catch { /* 無痕模式等 */ } }
  const me = user?.profile?.name || user?.profile?.email || '未登入' // 追蹤紀錄記錄是誰
  const [logFor, setLogFor] = useState(null) // 正在記追蹤的訂單 id
  const [logDraft, setLogDraft] = useState({ note: '', next: '' })
  const [histOpen, setHistOpen] = useState({}) // 展開追蹤紀錄
  const [lostModal, setLostModal] = useState(null) // 未成交視窗 { order, reason, note }
  const [showLost, setShowLost] = useState(false)
  const [statusErr, setStatusErr] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [editingOrderId, setEditingOrderId] = useState(null)
  const [specOem, setSpecOem] = useState(false) // 存成固定規格：清單沒有的新品項是不是代工品
  const [itemSpecs, setItemSpecs] = useState({}) // 品名 → { g 每袋重量, big 大箱袋數, mid 中箱袋數, box 預設箱型, pack 固定包材, oem 代工品 }
  const [places, setPlaces] = useState([]) // 併櫃／送貨地點 [{ name, detail }]
  const [placeOpen, setPlaceOpen] = useState(false) // 地點清單管理展開
  const [placeDraft, setPlaceDraft] = useState({ name: '', detail: '' })
  const [shipSt, setShipSt] = useState(EMPTY_SHIP) // 出貨安排（確認訂單、定出貨日共用）
  const [shipFor, setShipFor] = useState(null) // 定出貨日：{ id, withOthers 同客戶待定的一起定 }
  const [packOpen, setPackOpen] = useState(false) // 品項有固定包材時，包材區預設收起
  const [calFor, setCalFor] = useState(null) // 出貨的 Google 日曆（預排客訂確認訂單後）：{ key 哪一批, confirmed }
  const [prodCalFor, setProdCalFor] = useState(null) // 生產排程的 Google 日曆（等待排程）：{ id 訂單, confirmed 剛排入行程 }
  const [filterFlavor, setFilterFlavor] = useState('')
  const [shipMonth, setShipMonth] = useState('') // 完成出貨（歷史）目前選的月份 'YYYY-MM'
  const [toast, setToast] = useState(null)
  const [pendingOrderData, setPendingOrderData] = useState(null)
  const [formError, setFormError] = useState('')
  const [statusModal, setStatusModal] = useState(null) // {order, nextStatus, label}
  const [statusDate, setStatusDate] = useState('')
  const submitActionRef = useRef('normal')
  const [useBoxCalc, setUseBoxCalc] = useState(false)
  const [boxCountInput, setBoxCountInput] = useState('')
  // 真空袋／貼紙尺寸清單。src：configs＝已存在口味設定；legacy＝舊版存的位置；default＝還沒存過
  const [packSizes, setPackSizes] = useState({ ...DEFAULT_SIZES, src: 'default' })
  const [addingSize, setAddingSize] = useState(null) // 'bag' | 'sticker'：正在新增哪一種尺寸
  const [newSize, setNewSize] = useState('')

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
    pack: EMPTY_PACK,
    merge: EMPTY_MERGE, // 存檔時放進 cs.merge（資料庫沒有 merge 欄位）
    payDate: '', leadDays: LEAD_DAYS, // 付款日、交期天數：存檔時放進 cs
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
      const ps = data?.configs?.packSizes
      if (ps) { setPackSizes({ bag: ps.bag || [], sticker: ps.sticker || [], src: 'configs' }); return }
      const { data: old } = await loadPage('pack') // 舊版存的位置
      if (old?.data) setPackSizes({ bag: old.data.bag || [], sticker: old.data.sticker || [], src: 'legacy' })
    }
    fetchConfig()
  }, [])

  // 品項清單（規格、代工品）與併櫃地點
  useEffect(() => {
    loadPage('orders').then(({ data }) => {
      if (data?.data) { setItemSpecs(data.data.itemSpecs || {}); setPlaces(data.data.places || []) }
    })
  }, [])
  const saveOrderConfig = async patch => {
    const next = { itemSpecs, places, ...patch }
    if (patch.itemSpecs) setItemSpecs(patch.itemSpecs)
    if (patch.places) setPlaces(patch.places)
    const { error } = await savePageData('orders', next)
    if (error) showToast('⚠ 沒存到：' + error.message)
    return !error
  }

  // 尺寸選單：還沒存過清單時＝預設＋訂單用過的尺寸；存過之後就照清單（刪掉的不會再跑回來）
  const allSizes = useMemo(() => (packSizes.src === 'default'
    ? { bag: uniq([...packSizes.bag, ...orders.map(o => o.pack?.bagSize)]), sticker: uniq([...packSizes.sticker, ...orders.map(o => o.pack?.stickerSize)]) }
    : { bag: uniq(packSizes.bag), sticker: uniq(packSizes.sticker) }), [packSizes, orders])
  const defSticker = () => (allSizes.sticker.includes('100×150') ? '100×150' : allSizes.sticker[0] || '')

  // 提示 3 秒後消失（新的提示會重新計時，不會被上一個提示的計時提早關掉）
  const toastTimer = useRef(null)
  const showToast = msg => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3000) }

  const handleInputChange = e => {
    const { name, value, type, checked } = e.target
    setFormData(p => {
      const n = { ...p, [name]: type === 'checkbox' ? checked : value }
      // 營業用：預設 空白真空袋＋貼紙（100×150mm）（還沒選過內包裝才帶入，可再改）
      if (name === 'item_name' && String(value).includes('營業用') && !p.pack?.inner) {
        n.pack = { ...EMPTY_PACK, ...(p.pack || {}), inner: '真空袋', sticker: true, stickerSize: p.pack?.stickerSize || defSticker() }
      }
      return n
    })
    if (formError) setFormError('')
  }

  // 選品項（打字或從清單選）：清單有設定的話帶入每袋重量、每箱袋數
  // 固定品（清單有設定規格）：帶入每袋重量、箱型與每箱袋數、固定包材；客製品照手動填
  const pickItem = (value, spec) => {
    const sp = spec || itemSpecs[value]
    const box = sp ? (formData.box_type && perBoxOf(sp, formData.box_type) ? formData.box_type : sp.box || (perBoxOf(sp, '大紙箱') ? '大紙箱' : perBoxOf(sp, '中紙箱') ? '中紙箱' : formData.box_type)) : formData.box_type
    const per = sp ? perBoxOf(sp, box) : 0
    setFormData(p => {
      const n = { ...p, item_name: value }
      if (sp?.pack) n.pack = { ...EMPTY_PACK, ...(p.pack || {}), ...sp.pack } // 固定包材（外箱貼、勾選紀錄不動）
      // 營業用：預設 空白真空袋＋貼紙（100×150mm）（還沒選過內包裝才帶入，可再改）
      else if (String(value).includes('營業用') && !p.pack?.inner) {
        n.pack = { ...EMPTY_PACK, ...(p.pack || {}), inner: '真空袋', sticker: true, stickerSize: p.pack?.stickerSize || defSticker() }
      }
      if (sp && Number(sp.g) > 0) n.weight_per_bag = Number(sp.g)
      if (sp) n.box_type = box
      if (per > 0) n.items_per_box = String(per)
      return n
    })
    if (per > 0) setUseBoxCalc(true)
    setPackOpen(false); setSpecOem(false) // 有固定包材就收起來
    if (formError) setFormError('')
  }
  // 換箱型：清單有設定這種箱子放幾袋就帶入
  const pickBox = type => {
    const per = perBoxOf(itemSpecs[formData.item_name.trim()], type)
    setFormData(p => ({ ...p, box_type: type, ...(per > 0 ? { items_per_box: String(per) } : {}) }))
    if (per > 0 && !(parseInt(formData.items_per_box) > 0)) setUseBoxCalc(true)
  }
  // 每箱袋數（箱入數）：從空白填上數字就切到「填箱數」，清掉就只能填袋數
  const setPerBox = v => {
    setFormData(p => ({ ...p, items_per_box: v }))
    if (!(parseInt(v) > 0)) setUseBoxCalc(false)
    else if (!(parseInt(formData.items_per_box) > 0)) setUseBoxCalc(true)
  }
  // 存成這個品項的固定規格（每袋重量、這種箱子放幾袋、預設箱型、包材）
  const saveFixedSpec = async () => {
    const name = formData.item_name.trim()
    if (!name) { setFormError('先填品項，再存成固定規格'); return }
    const pk = { ...EMPTY_PACK, ...(formData.pack || {}) }
    if (pk.inner === '真空袋' && !pk.bagSize) { setFormError('請先選空白真空袋尺寸，再存成固定規格'); return }
    if (pk.sticker && (!pk.stickerSize || !pk.stickerPrint)) { setFormError('請先選貼紙尺寸和「送印／自印」，再存成固定規格'); return }
    setFormError('')
    const k = boxKind(formData.box_type), per = Number(formData.items_per_box) || 0
    const sp = { ...(itemSpecs[name] || {}) }
    if (!savedItems.includes(name) && specOem) sp.oem = true
    if (Number(formData.weight_per_bag) > 0) sp.g = Number(formData.weight_per_bag)
    if (k && per > 0) { sp[k] = per; if (k === 'big') delete sp.perBox }
    if (formData.box_type) sp.box = formData.box_type
    sp.pack = Object.fromEntries(PACK_KEYS.map(key => [key, key === 'sticker' ? !!pk.sticker : (pk[key] || '').toString().trim()]))
    if (sp.pack.inner !== '真空袋') sp.pack.bagSize = ''
    if (!sp.pack.sticker) Object.assign(sp.pack, { stickerSize: '', stickerPrint: '', stickerNote: '' })
    if (!savedItems.includes(name)) {
      const items = [...savedItems, name]
      await supabase.from('adv_flavor_config').upsert({ id: 'default', items, updated_at: new Date().toISOString() })
      setSavedItems(items)
    }
    if (await saveOrderConfig({ itemSpecs: { ...itemSpecs, [name]: sp } })) { setPackOpen(false); setSpecOem(false); showToast(`已存成「${name}」的固定規格 ✅ 下次選這個品項會自動帶入`) }
  }
  // 併櫃：改併櫃日（或打開併櫃）就自動算出貨日（還是可以再改）
  const setMerge = patch => {
    setFormData(p => {
      const m = { ...EMPTY_MERGE, ...(p.merge || {}), ...patch }
      const n = { ...p, merge: m }
      if ('date' in patch || 'on' in patch) { const sd = mergeShipDate(m); if (sd) n.target_date = sd }
      return n
    })
    if (formError) setFormError('')
  }
  // 地點清單：同名就更新
  const savePlace = async () => {
    const name = placeDraft.name.trim(), detail = placeDraft.detail.trim()
    if (!name) { showToast('請填地點名稱'); return }
    const exists = places.some(x => x.name === name)
    const ok = await saveOrderConfig({ places: exists ? places.map(x => (x.name === name ? { name, detail } : x)) : [...places, { name, detail }] })
    if (ok) { setMerge({ place: name }); setPlaceDraft({ name: '', detail: '' }); showToast(exists ? `已更新地點「${name}」✅` : `已新增地點「${name}」✅`) }
  }
  const deletePlace = async name => {
    if (!confirm(`確定從清單刪除地點「${name}」？\n（已經下的訂單不受影響）`)) return
    await saveOrderConfig({ places: places.filter(x => x.name !== name) })
    if (formData.merge?.place === name) setMerge({ place: '' })
  }

  // 包材欄位
  const setPack = patch => {
    setFormData(p => ({ ...p, pack: { ...EMPTY_PACK, ...(p.pack || {}), ...patch } }))
    if (formError) setFormError('')
  }
  // 尺寸清單存在 adv_flavor_config（口味設定那一列）的 configs.packSizes；不行的話存舊位置
  const saveSizes = async next => {
    const list = { bag: next.bag, sticker: next.sticker }
    setPackSizes({ ...list, src: 'configs' })
    try {
      const { data: cur, error: e1 } = await supabase.from('adv_flavor_config').select('*').eq('id', 'default').maybeSingle()
      if (e1) throw e1
      const configs = { ...(cur?.configs || {}), packSizes: list }
      const { error } = cur
        ? await supabase.from('adv_flavor_config').update({ configs, updated_at: new Date().toISOString() }).eq('id', 'default')
        : await supabase.from('adv_flavor_config').upsert({ id: 'default', items: savedItems, configs, updated_at: new Date().toISOString() })
      if (error) throw error
    } catch (e) {
      const r = await savePageData('pack', list)
      if (r?.error) showToast('⚠ 尺寸清單沒存到：' + (e?.message || r.error.message))
    }
  }
  const addSize = kind => {
    const s = normSize(newSize)
    if (!s) return
    setPack(kind === 'bag' ? { bagSize: s } : { stickerSize: s })
    setNewSize('')
    if (allSizes[kind].includes(s)) { showToast(`尺寸 ${s} 已經有了，已幫你選好`); return }
    saveSizes({ ...allSizes, [kind]: [...allSizes[kind], s] })
    showToast(`已新增尺寸 ${s} ✅`)
  }
  const deleteSize = (kind, s) => {
    if (!confirm(`確定從清單刪除尺寸「${s}」？\n（已經下的訂單不受影響）`)) return
    saveSizes({ ...allSizes, [kind]: allSizes[kind].filter(x => x !== s) })
    const cur = kind === 'bag' ? formData.pack?.bagSize : formData.pack?.stickerSize
    if (cur === s) setPack(kind === 'bag' ? { bagSize: '' } : { stickerSize: '' })
    showToast(`已刪除尺寸 ${s}`)
  }

  // 包材準備：倉管勾選（勾的時候記時間＋當下規格）
  const toggleCheck = async (o, it) => {
    const pk = { ...EMPTY_PACK, ...(o.pack || {}) }
    const checks = { ...(pk.checks || {}) }
    if (it.done) delete checks[it.key]
    else checks[it.key] = { at: new Date().toISOString(), v: it.v }
    const pack = { ...pk, checks }
    setOrders(list => list.map(x => (x.id === o.id ? { ...x, pack } : x)))
    const { error, missing } = await updateOrder(o.id, { pack, updated_at: new Date().toISOString() }, '勾選沒存到：')
    if (error || missing.length) { if (error) alert('勾選沒存到：' + error.message); fetchOrders() }
  }

  // 更新訂單；資料庫還沒有 pack／cs 欄位時，先存其他欄位再提醒執行 SQL
  const updateOrder = async (id, data, prefix = '') => {
    const d = { ...data }, missing = []
    let { error } = await supabase.from('adv_orders').update(d).eq('id', id)
    while (error && COL_SQL[missingCol(error)] && !missing.includes(missingCol(error))) {
      const col = missingCol(error)
      missing.push(col); delete d[col]
      ;({ error } = await supabase.from('adv_orders').update(d).eq('id', id))
    }
    if (missing.length) alert(prefix + colMsg(missing))
    return { error, missing }
  }

  // ── 預排客訂：記一筆追蹤／確認／未成交 ──
  const openLog = o => { setLogFor(logFor === o.id ? null : o.id); setLogDraft({ note: '', next: addDays(todayIso(), 2) }) }
  const saveLog = async o => {
    const note = logDraft.note.trim()
    if (!note) { showToast('請寫這次聯絡的結果'); return }
    const now = new Date().toISOString()
    const prev = o.cs || {}
    const cs = { ...prev, receivedAt: prev.receivedAt || o.created_at, owner: prev.owner || me, next: logDraft.next || '', logs: [...(prev.logs || []), { at: now, by: me, note, next: logDraft.next || '' }] }
    setOrders(list => list.map(x => (x.id === o.id ? { ...x, cs } : x)))
    setLogFor(null)
    const { error, missing } = await updateOrder(o.id, { cs, updated_at: now }, '追蹤紀錄沒存到：')
    if (error) { alert('追蹤紀錄沒存到：' + error.message); fetchOrders() }
    else if (!missing.length) showToast('已記錄追蹤 ✅')
    else fetchOrders()
  }
  const confirmLost = async () => {
    const { order: o, reason, note } = lostModal
    if (!reason) { showToast('請選未成交原因'); return }
    const now = new Date().toISOString()
    const cs = { ...(o.cs || {}), receivedAt: o.cs?.receivedAt || o.created_at, lostAt: now, lostBy: me, lostReason: note.trim() ? `${reason}：${note.trim()}` : reason }
    const { error } = await updateOrder(o.id, { status: LOST, cs, updated_at: now }, '未成交原因沒存到：')
    if (error) { alert('更新失敗：' + error.message); return }
    setLostModal(null); fetchOrders(); showToast('已標記未成交')
  }
  const restoreLost = async o => {
    const cs = { ...(o.cs || {}) }
    delete cs.lostAt; delete cs.lostBy; delete cs.lostReason
    const { error } = await updateOrder(o.id, { status: 'preorder', cs, updated_at: new Date().toISOString() })
    if (error) { alert('更新失敗：' + error.message); return }
    fetchOrders(); showToast('已恢復成預排客訂')
  }

  // 填箱數：箱數 × 每箱袋數（每箱袋數＝外箱旁邊那一格）
  const perBoxNow = parseInt(formData.items_per_box) || 0
  const boxMode = useBoxCalc && perBoxNow > 0
  const calcedQty = (parseInt(boxCountInput) || 0) * perBoxNow

  const formIsPre = !editingOrderId || orders.find(o => o.id === editingOrderId)?.status === 'preorder' // 新單或預排中的單
  const handleFormSubmit = e => {
    e.preventDefault()
    setFormError('')
    if (!formData.customer_name.trim()) { setFormError('請填寫客戶名稱'); return }
    if (!formData.item_name.trim()) { setFormError('請選擇或輸入品項'); return }
    // 出貨日可以先空著（排好生產後，客服再到卡片按「🚚 定出貨日」）
    const pk = { ...EMPTY_PACK, ...(formData.pack || {}) }
    if (pk.inner === '真空袋' && !pk.bagSize) { setFormError('請選空白真空袋尺寸（沒有的話按「＋ 新增／刪除尺寸」）'); return }
    if (pk.sticker && !pk.stickerSize) { setFormError('請選貼紙尺寸'); return }
    if (pk.sticker && !pk.stickerPrint) { setFormError('請選貼紙是「送印」還是「自印」'); return }
    const m = { ...EMPTY_MERGE, ...(formData.merge || {}) }
    if (m.on && !m.date) { setFormError('請填併櫃日期（不併櫃的話把「這批要併櫃」取消）'); return }

    let finalQty = 0
    if (boxMode) {
      if (!(parseInt(boxCountInput) > 0)) { setFormError('請填箱數（或切到「填袋數」）'); return }
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
      box_count: boxMode ? parseInt(boxCountInput) || 0 : 0,
      box_qty_each: boxMode ? perBoxNow : 0,
      pack: {
        ...pk, stickerNote: (pk.stickerNote || '').trim(),
        bagSize: pk.inner === '真空袋' ? pk.bagSize : '',
        ...(pk.sticker ? {} : { stickerSize: '', stickerPrint: '', stickerNote: '' }),
        carton: !!pk.carton, cartonNote: pk.carton ? (pk.cartonNote || '').trim() : '',
        oem: !!itemSpecs[formData.item_name.trim()]?.oem,
      },
      item_name: formData.item_name.trim(),
      merge: m.on ? { on: true, date: m.date, time: (m.time || '').trim(), place: m.place || '' } : EMPTY_MERGE,
    })
    setIsConfirmOpen(true)
  }

  const executeSave = async () => {
    if (!pendingOrderData) return
    const id = editingOrderId || `order_${Date.now()}`
    const existingOrder = orders.find(o => o.id === editingOrderId)
    try {
      const now = new Date().toISOString()
      const { merge, payDate, leadDays, ...data } = pendingOrderData // 併櫃、付款日不是資料庫欄位，放進 cs
      const row = {
        id, ...data,
        status: existingOrder?.status || 'preorder', // 新接的單先放「預排客訂」，客服確認後才到等待排程
        created_at: existingOrder?.created_at || now,
        created_by: user?.session?.user?.id,
        updated_at: now
      }
      if (!existingOrder) { // 新單：負責人＝接單的人，明天追蹤（之後在卡片「＋ 記一筆追蹤」改）
        const next = addDays(todayIso(), 1)
        row.cs = { receivedAt: now, owner: me, next, logs: [{ at: now, by: me, note: '接單', next, kind: 'new' }] }
      } else row.cs = { ...(existingOrder.cs || {}) }
      row.cs = applyShip(row.cs, { payDate, leadDays, merge })
      let { error } = await supabase.from('adv_orders').upsert(row)
      const missing = []
      while (error && COL_SQL[missingCol(error)] && !missing.includes(missingCol(error))) { // 資料庫還沒有 pack／cs 欄位
        const col = missingCol(error)
        missing.push(col); delete row[col]
        ;({ error } = await supabase.from('adv_orders').upsert(row))
      }
      if (error) throw error
      if (missing.length) alert('訂單已存，但' + colMsg(missing))
      showToast(editingOrderId ? '訂單修改成功 ✅' : '訂單已放進「預排客訂」✅')
      fetchOrders()
      if (formData.is_mixed_box && submitActionRef.current === 'continue' && !editingOrderId) {
        setFormData(p => ({ ...p, item_name: '', quantity: '', notes: '', pack: { ...EMPTY_PACK, ...(p.pack || {}), checks: {} } }))
        setBoxCountInput(''); setPackOpen(false)
        setIsConfirmOpen(false); setPendingOrderData(null)
      } else { setIsConfirmOpen(false); setPendingOrderData(null); closeForm() }
    } catch (err) { alert('儲存失敗：' + (err.message || JSON.stringify(err))) }
  }

  const changeStatus = async (order, direction) => {
    const idx = STATES.indexOf(order.status)
    const next = Math.max(0, Math.min(STATES.length - 1, idx + direction))
    if (next === idx) return
    const data = { status: STATES[next], updated_at: new Date().toISOString() }
    if (STATES[next] === 'preorder') { // 退回預排：拿掉確認紀錄，明天再追蹤
      const { confirmedAt, confirmedBy, ...cs } = order.cs || {}
      data.cs = { ...cs, receivedAt: cs.receivedAt || order.created_at, next: addDays(todayIso(), 1) }
    }
    const { error } = await updateOrder(order.id, data, '狀態已更新，但')
    if (error) { alert('狀態更新失敗：' + error.message); return }
    fetchOrders()
    showToast(`已退回：${STATUS_LABEL[STATES[next]]} ✅`)
  }

  const closeForm = () => {
    setIsFormOpen(false); setEditingOrderId(null); setSpecOem(false); setPackOpen(false)
    setFormError(''); setUseBoxCalc(false); setBoxCountInput('')
    setAddingSize(null); setNewSize('')
    setPlaceOpen(false); setPlaceDraft({ name: '', detail: '' })
    setFormData(emptyForm)
  }

  const openEditForm = order => {
    setFormData({
      ...emptyForm, ...order, pack: { ...EMPTY_PACK, ...(order.pack || {}) }, merge: mergeOf(order),
      items_per_box: order.items_per_box || order.box_qty_each || '',
      payDate: order.cs?.payDate || '', leadDays: order.cs?.leadDays || LEAD_DAYS,
    })
    if ((order.box_count||0) > 0) { setUseBoxCalc(true); setBoxCountInput(String(order.box_count)) }
    setEditingOrderId(order.id); setIsFormOpen(true)
  }

  const deleteOrder = async id => {
    if (!confirm('確定要永久刪除這筆單嗎？')) return
    await supabase.from('adv_orders').delete().eq('id', id)
    fetchOrders()
  }

  // 規格只存有填的欄位
  const specOf = c => {
    const g = Number(c.g) || 0, big = Number(c.big) || 0, mid = Number(c.mid) || 0
    const sp = { ...(g ? { g } : {}), ...(big ? { big } : {}), ...(mid ? { mid } : {}), ...(c.box ? { box: c.box } : {}), ...(c.pack ? { pack: c.pack } : {}), ...(c.oem ? { oem: true } : {}) }
    return Object.keys(sp).length ? sp : null
  }
  // ⚙️ 品項管理：品名＋每袋重量、大箱／中箱每箱袋數、代工品、固定包材（看、清除）
  const openSettings = () => {
    setEditingConfigs(savedItems.map(name => {
      const sp = itemSpecs[name] || {}
      return { name, g: sp.g || '', big: perBoxOf(sp, '大紙箱') || '', mid: perBoxOf(sp, '中紙箱') || '', box: sp.box || '', pack: sp.pack || null, oem: !!sp.oem }
    }))
    setIsSettingsOpen(true)
  }
  const syncSettings = async () => {
    const rows = editingConfigs.map(c => ({ ...c, name: String(c.name || '').trim() })).filter(c => c.name)
    const names = uniq(rows.map(c => c.name))
    // 只動視窗裡列出來的品項；不在清單上的規格（例：別人剛加的）保留
    const shown = new Set(savedItems)
    const specs = Object.fromEntries(Object.entries(itemSpecs).filter(([k]) => !shown.has(k)))
    rows.forEach(c => { const sp = specOf(c); if (sp) specs[c.name] = sp; else delete specs[c.name] })
    await supabase.from('adv_flavor_config').upsert({ id: 'default', items: names, updated_at: new Date().toISOString() })
    setSavedItems(names)
    const ok = await saveOrderConfig({ itemSpecs: specs })
    setIsSettingsOpen(false); if (ok) showToast('品項已同步 ✅')
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

  // 完成出貨＝歷史出貨：依出貨日的月份分類（沒填出貨日就用最後更新日）
  const monthOf = o => {
    const td = String(o.target_date || o.targetDate || '')
    if (/^\d{4}-\d{2}/.test(td)) return td.slice(0, 7)
    const u = String(o.updated_at || o.created_at || '')
    return /^\d{4}-\d{2}/.test(u) ? u.slice(0, 7) : '未知'
  }
  const shipMonths = useMemo(() => {
    const m = {}
    orders.filter(o => o.status === 'shipped').forEach(o => { const k = monthOf(o); m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => (a[0] === '未知') - (b[0] === '未知') || b[0].localeCompare(a[0])) // 新→舊
  }, [orders])
  const curShipMonth = shipMonths.some(([k]) => k === shipMonth) ? shipMonth : (shipMonths[0]?.[0] || '')

  // 搜尋口味或客戶；在完成出貨分頁有輸入搜尋時，查全部月份
  const kw = filterFlavor.trim()
  const todayStr = todayIso()
  const csRankOf = o => { const st = csState(o, todayStr); return [st.shipSoon ? 0 : 1, CS_RANK[st.st], st.next || '9999'] }
  const filteredOrders = sortedOrders
    .filter(o => o.status === activeTab)
    .filter(o => !kw || (o.item_name || o.itemName || '').includes(kw) || (o.customer_name || o.customerName || '').includes(kw))
    .filter(o => activeTab !== 'shipped' || kw || monthOf(o) === curShipMonth)
    .sort((a, b) => {
      if (activeTab === 'shipped') return String(b.target_date || '').localeCompare(String(a.target_date || ''))
      if (activeTab === 'preorder') { // 預排客訂：最急的在前（出貨日快到 → 追蹤逾期 → 今天要追 → 沒排 → 之後）
        const x = csRankOf(a), y = csRankOf(b)
        return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2])
      }
      return 0
    })
  const cst = useMemo(() => csStats(orders, todayStr), [orders, todayStr])
  const lostOrders = useMemo(() => orders.filter(o => o.status === LOST).sort((a, b) => String(b.cs?.lostAt || '').localeCompare(String(a.cs?.lostAt || ''))), [orders])
  // 整批：同客戶同出貨日的所有單（不分關卡；未成交不算）
  const batches = useMemo(() => {
    const m = {}
    orders.forEach(o => { if (o.status === LOST) return; const k = batchKey(o); (m[k] = m[k] || []).push(o) })
    return m
  }, [orders])
  // 卡片依「客戶（母客戶）＋出貨日」分組；同一張卡裡再依完整客戶名分子客戶
  const groupedByBatch = filteredOrders.reduce((acc, o) => {
    const fullName = o.customer_name || o.customerName || '未知客戶'
    const key = batchKey(o)
    if (!acc[key]) acc[key] = { parent: parentOf(o), td: shipDateOf(o), subGroups: {}, all: [], first: Object.keys(acc).length }
    if (!acc[key].subGroups[fullName]) acc[key].subGroups[fullName] = []
    acc[key].subGroups[fullName].push(o)
    acc[key].all.push(o)
    return acc
  }, {})
  // 生產部的關卡：出貨日近的在前（沒填出貨日的放最後）；預排、完成出貨照原本的順序
  const groupList = Object.entries(groupedByBatch).sort(([, a], [, b]) => (ACTIVE.includes(activeTab)
    ? (a.td || '9999').localeCompare(b.td || '9999') || a.first - b.first
    : a.first - b.first))

  const formatDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
  const tdOf = shipDateOf
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

  // ── 異常狀態：逾期未出貨／即將到期還沒備貨／未填出貨日（已完成出貨的不算） ──
  const anomalies = useMemo(() => orderAnomalies(orders, todayStr), [orders, todayStr])

  // 推進到下一關（各分頁卡片與異常狀態共用）
  const openNext = o => {
    setStatusErr('')
    const idx = STATES.indexOf(o.status)
    if (idx < 0 || o.status === 'shipped') return
    if (o.status === 'preorder') setShipSt(shipStOf(o)) // 確認訂單：帶入付款日、併櫃、預計出貨日
    else if (o.status === 'pending') setStatusDate(toIso(o.scheduled_date || o.scheduledDate) || formatDate(new Date())) // 排入行程：已經填過排程生產日就帶入
    else setStatusDate(formatDate(new Date()))
    setStatusModal({ order: o, nextStatus: STATES[idx + 1], label: NEXT_ACTION[o.status] })
  }
  // ── 出貨安排（確認訂單、🚚 定出貨日共用）：付款日 → 交期、併櫃、出貨日 ──
  // 初始值：這張單的付款日、併櫃、出貨日（沒併櫃的話用同客戶同出貨日的單的併櫃）
  const shipStOf = o => {
    let m = mergeOf(o)
    if (!m.on && shipDateOf(o)) { const sib = orders.find(x => x.id !== o.id && x.status !== LOST && batchKey(x) === batchKey(o) && x.cs?.merge?.on); if (sib) m = mergeOf(sib) }
    return { payDate: o.cs?.payDate || '', leadDays: o.cs?.leadDays || LEAD_DAYS, ship: shipDateOf(o) || mergeShipDate(m), merge: m }
  }
  // 改併櫃日（或打開併櫃）就自動算出貨日（還是可以再改）
  const patchShip = (st, patch) => {
    const n = { ...st, ...patch }
    if (patch.merge) {
      n.merge = { ...EMPTY_MERGE, ...st.merge, ...patch.merge }
      if ('date' in patch.merge || 'on' in patch.merge) { const sd = mergeShipDate(n.merge); if (sd) n.ship = sd }
    }
    return n
  }
  const setShipP = patch => { setShipSt(st => patchShip(st, patch)); setStatusErr('') }

  // ── 🚚 定出貨日：排好生產後，客服再定出貨日（同客戶出貨日待定的可以一起定）──
  const shipOthers = o => orders.filter(x => x.id !== o.id && ACTIVE.includes(x.status) && !shipDateOf(x) && parentOf(x) === parentOf(o))
  const openShip = o => { setStatusErr(''); setShipSt(shipStOf(o)); setShipFor({ id: o.id, withOthers: true }) }
  const saveShip = async () => {
    const o = orders.find(x => x.id === shipFor?.id)
    if (!o) { setShipFor(null); return }
    const st = shipSt
    if (st.merge.on && !st.merge.date) { setStatusErr('請填併櫃日期（不併櫃的話把勾勾取消）'); return }
    if (!st.ship) { setStatusErr('請填出貨日'); return }
    const now = new Date().toISOString()
    const list = [o, ...(shipFor.withOthers ? shipOthers(o) : [])]
    // 一起定的：出貨日、併櫃一樣；付款日各自的不動
    const ups = list.map(x => {
      const own = x.id === o.id ? st : { ...st, payDate: x.cs?.payDate || '', leadDays: x.cs?.leadDays || LEAD_DAYS }
      return { id: x.id, data: { target_date: st.ship, cs: { ...applyShip(x.cs, own), shipSetAt: now, shipSetBy: me }, updated_at: now } }
    })
    setOrders(l => l.map(x => { const u = ups.find(y => y.id === x.id); return u ? { ...x, ...u.data } : x }))
    setShipFor(null)
    for (const u of ups) {
      const { error } = await updateOrder(u.id, u.data, '出貨日已存，但')
      if (error) { alert('出貨日沒存到：' + error.message); fetchOrders(); return }
    }
    // 定好之後，問要不要加出貨的 Google 日曆
    setCalFor({ key: batchKey({ ...o, target_date: st.ship }), confirmed: false, done: `✅ 出貨日已定：${mdw(st.ship)}${list.length > 1 ? `（${list.length} 筆一起定）` : ''}` })
    fetchOrders()
  }
  // 排好生產、等客服定出貨日的單（預排客訂分頁上方提醒）；還在等待排程、沒有排程生產日的不算
  const sdOf = o => toIso(o.scheduled_date || o.scheduledDate)
  const shipTodo = useMemo(() => orders
    .filter(o => ACTIVE.includes(o.status) && !shipDateOf(o) && (o.status !== 'pending' || sdOf(o)))
    .sort((a, b) => (sdOf(a) || '9999').localeCompare(sdOf(b) || '9999')), [orders])

  // ── Google 日曆：一批出貨（同客戶同出貨日、已確認的單）──
  // 標題：達頓出貨12/2併（沒併櫃：達頓出貨）；內容：併櫃、地點、出貨內容
  const batchCal = key => {
    const all = batches[key] || []
    const list = all.filter(o => o.status !== 'preorder')
    const pre = all.filter(o => o.status === 'preorder')
    if (!list.length) return { list, pre }
    const o0 = list[0], td = shipDateOf(o0)
    const m = list.map(mergeOf).find(x => x.on && x.date) || null
    const place = m?.place ? places.find(x => x.name === m.place) : null
    const title = `${parentOf(o0)}出貨${m ? `${mdOf(m.date)}併` : ''}`
    const names = uniq(list.map(o => o.customer_name || o.customerName))
    const bags = list.reduce((s, o) => s + (Number(o.quantity) || 0), 0)
    const boxes = list.reduce((s, o) => s + getBoxCount(o), 0)
    const lines = []
    if (m) lines.push(`併櫃：${mdw(m.date)}${m.time ? ` ${m.time}` : ''}`)
    if (m?.place) { lines.push(m.place); if (place?.detail) lines.push(place.detail) }
    if (lines.length) lines.push('')
    lines.push('出貨內容：')
    list.forEach(o => { const b = getBoxCount(o); lines.push(`• ${o.item_name || o.itemName} ${o.quantity}袋${b ? `（${b}箱）` : ''}${names.length > 1 ? ` — ${o.customer_name || o.customerName}` : ''}`) })
    lines.push(`合計：${bags}袋${boxes ? `・${boxes}箱` : ''}`)
    lines.push('', `詳情依「生產排程整合系統」為主：${window.location.origin}`)
    const details = lines.join('\n')
    const cal = list.map(o => o.cs || {}).find(c => c.calAt && c.calDate === td) || null
    return { list, pre, td, title, details, url: td ? gcalUrl(title, td, details) : '', cal, m }
  }
  // ── 生產排程的 Google 日曆（等待排程）：格式跟生產排程頁一樣（標題 品項*數量；內容 品項、數量、日期、詳情）──
  const prodCalInfo = o => {
    const date = toIso(o.scheduled_date || o.scheduledDate)
    const item = o.item_name || o.itemName || ''
    const bags = Number(o.quantity) || 0
    const boxes = getBoxCount(o)
    const ipb = Number(o.box_qty_each || o.items_per_box || o.itemsPerBox) || 0
    const td = shipDateOf(o)
    const title = `${item}*${boxes ? `${boxes}箱` : `${bags}袋`}`
    const lines = [
      `品項：${item}`,
      `客戶：${o.customer_name || o.customerName || ''}`,
      `數量：${bags}袋${boxes ? `（${boxes}箱${ipb ? ` × ${ipb}袋` : ''}）` : ''}`,
      `每袋重量：${o.weight_per_bag || 5250}g`,
      date && `生產日：${mdw(date)}`,
      td && `出貨日：${mdw(td)}`,
      o.cs?.due && `交期：${mdw(o.cs.due)}（${mdOf(o.cs.payDate)} 付款後 ${o.cs.leadDays || LEAD_DAYS} 個工作天）`,
      o.notes && `備註：${o.notes}`,
    ].filter(Boolean)
    const details = [...lines, '', `詳情依「生產排程整合系統」為主：${window.location.origin}`].join('\n')
    const cs = o.cs || {}
    return { date, title, details, url: date ? gcalUrl(title, date, details) : '', added: cs.prodCalAt && cs.prodCalDate === date ? cs : null }
  }
  const markProdCal = async (o, info) => {
    const now = new Date().toISOString()
    const cs = { ...(o.cs || {}), prodCalAt: now, prodCalBy: me, prodCalDate: info.date }
    setOrders(l => l.map(x => (x.id === o.id ? { ...x, cs } : x)))
    setProdCalFor(null)
    showToast('已開 Google 日曆，在那邊按「儲存」✅')
    await updateOrder(o.id, { cs, updated_at: now }, '日曆紀錄沒存到：')
  }

  // 按下「加入 Google 日曆」：整批記下已加（之後再按會提醒已經加過）
  const markCal = async info => {
    const now = new Date().toISOString()
    const ids = new Set(info.list.map(o => o.id))
    const upd = o => ({ ...(o.cs || {}), calAt: now, calBy: me, calDate: info.td })
    setOrders(l => l.map(o => (ids.has(o.id) ? { ...o, cs: upd(o) } : o)))
    setCalFor(null)
    showToast('已開 Google 日曆，在那邊按「儲存」✅')
    for (const o of info.list) await updateOrder(o.id, { cs: upd(o), updated_at: now }, '日曆紀錄沒存到：')
  }

  const THEME = {
    pending:   { bg: '#fffbeb', header: '#f59e0b', accent: '#92400e', border: '#fde68a' },
    packaging: { bg: '#f5f3ff', header: '#8b5cf6', accent: '#5b21b6', border: '#ddd6fe' },
    scheduled: { bg: '#f0fdf4', header: '#10b981', accent: '#065f46', border: '#a7f3d0' },
    prepared:  { bg: '#eff6ff', header: '#3b82f6', accent: '#1e3a8a', border: '#bfdbfe' },
    shipped:   { bg: '#f8fafc', header: '#64748b', accent: '#1e293b', border: '#e2e8f0' },
    anomaly:   { bg: '#fff1f2', header: '#e11d48', accent: '#881337', border: '#fecdd3' },
    preorder:  { bg: '#ecfeff', header: '#0e7490', accent: '#164e63', border: '#a5f3fc' },
  }
  const th = THEME[activeTab] || THEME.pending
  // 推進狀態的視窗用「該筆訂單所在關卡」的顏色（從異常狀態按也一樣）
  const mth = (statusModal && THEME[statusModal.order.status]) || th
  // 按「包材備妥」時：包材清單還有哪些沒勾（用最新的訂單資料）
  const modalLeft = statusModal?.order.status === 'packaging' ? (() => {
    const mo = orders.find(x => x.id === statusModal.order.id) || statusModal.order
    const its = packItems(mo, getBoxCount(mo))
    return { total: its.length, left: its.filter(it => !it.done) }
  })() : null

  // 併櫃欄位（新增客訂表單、確認訂單視窗共用；用函式呼叫，不寫成元件，打字才不會跳掉）
  const renderMerge = (m, set, shipIso, manage) => {
    const sd = mergeShipDate(m)
    const pl = places.find(x => x.name === m.place)
    const box = { width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }
    return (
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 16, padding: 12, marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#0369a1' }}>
          <input type="checkbox" checked={!!m.on} onChange={e => set({ on: e.target.checked })} style={{ width: 16, height: 16 }} aria-label="這批要併櫃" />
          🚢 這批要併櫃<span style={{ fontWeight: 500, color: '#64748b', fontSize: 12 }}>（出貨日＝併櫃前 {MERGE_LEAD} 個工作天）</span>
        </label>
        {m.on && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 3 }}>併櫃日期 *</div>
                <input type="date" value={m.date} onChange={e => set({ date: e.target.value })} aria-label="併櫃日期" style={{ ...box, border: m.date ? 'none' : '1px solid #f59e0b' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#0369a1', marginBottom: 3 }}>併櫃時間</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {MERGE_TIMES.map(t => (
                    <button type="button" key={t} onClick={() => set({ time: m.time === t ? '' : t })} aria-pressed={m.time === t}
                      style={{ flex: 1, padding: '8px 2px', borderRadius: 10, border: `1px solid ${m.time === t ? '#0369a1' : '#bae6fd'}`, background: m.time === t ? '#0369a1' : '#fff', color: m.time === t ? '#fff' : '#0369a1', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{t}</button>
                  ))}
                </div>
              </div>
            </div>
            <input value={MERGE_TIMES.includes(m.time) ? '' : m.time} onChange={e => set({ time: e.target.value })} placeholder="其他時間（例：下午2點）" aria-label="其他併櫃時間"
              style={{ ...box, marginTop: 6, fontSize: 13, padding: '6px 8px' }} />
            {sd && (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#0369a1' }}>
                → 出貨日 {mdw(sd)}（已避開週末、國定假日）
                {shipIso && shipIso !== sd && <span style={{ color: '#c2410c' }}>；目前出貨日是 {mdw(shipIso)}</span>}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#0369a1', margin: '8px 0 3px' }}>併櫃地點</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={m.place} onChange={e => set({ place: e.target.value })} aria-label="併櫃地點" style={{ ...box, flex: 1, width: 'auto', minWidth: 0 }}>
                <option value="">請選擇（日曆上會寫地址）</option>
                {places.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                {m.place && !pl && <option value={m.place}>{m.place}（已從清單刪除）</option>}
              </select>
              {manage && (
                <button type="button" onClick={() => { setPlaceOpen(!placeOpen); setPlaceDraft({ name: '', detail: '' }) }} aria-expanded={placeOpen}
                  style={{ background: placeOpen ? '#e0f2fe' : '#fff', border: '1px dashed #7dd3fc', borderRadius: 10, padding: '0 10px', color: '#0369a1', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>＋ 新增／管理地點</button>
              )}
            </div>
            {pl?.detail && <div style={{ marginTop: 6, fontSize: 12, color: '#334155', background: '#fff', borderRadius: 8, padding: '6px 8px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{pl.detail}</div>}
            {manage && placeOpen && (
              <div style={{ background: '#fff', border: '1px solid #bae6fd', borderRadius: 10, padding: 8, marginTop: 6 }}>
                <input value={placeDraft.name} onChange={e => setPlaceDraft(d => ({ ...d, name: e.target.value }))} placeholder="地點名稱（例：逢泰低溫物流中心）" aria-label="地點名稱"
                  style={{ ...box, border: '1px solid #bae6fd', fontSize: 14, marginBottom: 6 }} />
                <textarea value={placeDraft.detail} onChange={e => setPlaceDraft(d => ({ ...d, detail: e.target.value }))} rows={4} aria-label="地點說明"
                  placeholder={'地址、聯絡人、電話、注意事項（會寫進日曆）\n例：桃園蘆竹區海湖北路282號 (海湖倉)\n倉庫電話：…\n**中午休息時間，請勿送貨!!**'}
                  style={{ ...box, border: '1px solid #bae6fd', fontSize: 13, resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button type="button" onClick={savePlace} style={{ flex: 1, background: '#0369a1', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 0', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>儲存地點</button>
                  <button type="button" onClick={() => setPlaceOpen(false)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>收起</button>
                </div>
                {places.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: '#0369a1', margin: '8px 0 4px' }}>清單（按名稱可以修改，按 × 刪除）：</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {places.map(x => (
                        <span key={x.name} style={{ display: 'inline-flex', alignItems: 'center', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 20, fontSize: 13, fontWeight: 700, color: '#075985' }}>
                          <button type="button" onClick={() => setPlaceDraft({ name: x.name, detail: x.detail || '' })} title="修改這個地點" style={{ border: 'none', background: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer', padding: '2px 4px 2px 10px', fontFamily: 'inherit', fontSize: 13 }}>{x.name}</button>
                          <button type="button" onClick={() => deletePlace(x.name)} aria-label={`刪除地點 ${x.name}`} title="從清單刪除" style={{ border: 'none', background: 'none', color: '#7dd3fc', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 8px 0 2px' }}>×</button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // 💰 付款日 → 交期（付款日＋N 個工作天；新增客訂表單、確認訂單、定出貨日共用）
  const renderPay = (st, set) => {
    const due = dueOf(st)
    return (
      <div className="op-pay" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 16, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>
          💰 付款日 <span style={{ fontWeight: 500, color: '#a16207', fontSize: 12 }}>（選填：要先付款才排生產的單，填了自動算交期）</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="date" value={st.payDate || ''} onChange={e => set({ payDate: e.target.value })} aria-label="付款日"
            style={{ flex: 1, minWidth: 0, background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }} />
          {st.payDate && <button type="button" onClick={() => set({ payDate: '' })} aria-label="清除付款日" title="清除付款日"
            style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 10, padding: '0 10px', color: '#a16207', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>}
        </div>
        {due && (
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            付款後
            <input type="number" min="1" value={st.leadDays} onChange={e => set({ leadDays: e.target.value })} aria-label="交期工作天數"
              style={{ width: 52, background: '#fff', border: '1px solid #fde68a', borderRadius: 8, padding: '3px 4px', fontFamily: 'inherit', fontSize: 13, textAlign: 'center' }} />
            個工作天 → <span className="op-due" style={{ color: '#b45309', fontWeight: 900 }}>⏰ 交期 {mdw(due)}</span>
            <span style={{ fontWeight: 500, color: '#a16207', fontSize: 12 }}>（避開週末、國定假日）</span>
          </div>
        )}
        {due && st.ship && st.ship > due && <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, color: '#dc2626' }}>⚠ 出貨日 {mdw(st.ship)} 比交期晚</div>}
      </div>
    )
  }
  // 出貨日（確認訂單：可以先空著；定出貨日：必填）
  const renderShipDate = (st, set, required) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: required ? '#dc2626' : '#475569', fontWeight: 700, marginBottom: 6 }}>
        {required ? '出貨日 *' : '出貨日'}
        {!required && <span style={{ fontWeight: 500, color: '#94a3b8', marginLeft: 6, fontSize: 12 }}>（知道就填；還不知道先空著，排好生產再定）</span>}
      </div>
      <input type="date" value={st.ship || ''} onChange={e => set({ ship: e.target.value })} aria-label="出貨日"
        style={{ width: '100%', background: '#f8fafc', border: `1px solid ${statusErr ? '#f87171' : '#e2e8f0'}`, borderRadius: 12, padding: '10px', fontFamily: 'inherit', fontSize: 15 }} />
    </div>
  )
  // 排入行程：提醒出貨日、交期（生產日不要比這兩個晚）
  const renderDueInfo = (o, prod) => {
    const td = shipDateOf(o), due = o.cs?.due || ''
    const limit = [td, due].filter(Boolean).sort()[0] || ''
    return (
      <div className="op-due-info" style={{ fontSize: 13, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '8px 12px', marginBottom: 12, lineHeight: 1.7, color: '#92400e' }}>
        <div>出貨日：<b>{td ? mdw(td) : '還沒定（排好生產後客服再定）'}</b></div>
        {due && <div>⏰ 交期：<b>{mdw(due)}</b>（{mdOf(o.cs.payDate)} 付款後 {o.cs.leadDays || LEAD_DAYS} 個工作天）</div>}
        {prod && limit && prod > limit && <div style={{ color: '#dc2626', fontWeight: 800 }}>⚠ 生產日比{limit === td ? '出貨日' : '交期'}晚</div>}
      </div>
    )
  }

  // 異常狀態分頁內容（用函式呼叫，不寫成元件，避免重建）
  // ── 預排客訂（客戶服務科）──
  // 每張單的客服追蹤框：接單日、負責人、下次追蹤（逾期／今天）、最近紀錄、記一筆追蹤、全部紀錄
  const renderCsBox = o => {
    const s = csState(o, todayStr)
    const last = s.logs[s.logs.length - 1]
    const ago = s.received ? dayDiff(s.received, todayStr) : null
    const pill = {
      overdue: { t: `⚠ 追蹤逾期 ${s.overdueDays} 天（原定 ${mdOf(s.next)}）`, bg: '#fee2e2', c: '#b91c1c' },
      today:   { t: '🔔 今天要追蹤', bg: '#ffedd5', c: '#c2410c' },
      later:   { t: `下次追蹤 ${mdOf(s.next)}（${wdOf(s.next).slice(1)}）`, bg: '#cffafe', c: '#0e7490' },
      none:    { t: '還沒排下次追蹤日', bg: '#f1f5f9', c: '#64748b' },
    }[s.st]
    const shipLeft = s.td ? dayDiff(todayStr, s.td) : null
    const open = logFor === o.id
    const hist = !!histOpen[o.id]
    const nextMon = addDays(todayStr, ((8 - parseIso(todayStr).getDay()) % 7) || 7)
    const chip = (label, iso) => (
      <button type="button" key={label} onClick={() => setLogDraft(d => ({ ...d, next: iso }))}
        style={{ border: `1px solid ${logDraft.next === iso ? '#0e7490' : '#a5f3fc'}`, background: logDraft.next === iso ? '#0e7490' : '#fff', color: logDraft.next === iso ? '#fff' : '#0e7490', borderRadius: 14, padding: '2px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
    )
    return (
      <div style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 12, padding: '8px 10px', marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#0e7490' }}>
            📞 客服追蹤
            <span style={{ fontWeight: 500, color: '#64748b', marginLeft: 6 }}>
              接單 {mdOf(s.received)}{ago != null ? `（${ago <= 0 ? '今天' : `${ago} 天前`}）` : ''}{s.owner ? ` · 負責 ${s.owner}` : ''}
            </span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, background: pill.bg, color: pill.c, borderRadius: 20, padding: '2px 9px' }}>{pill.t}</span>
        </div>
        {s.shipSoon && (
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 800, color: '#be123c' }}>
            ⚠ 預計出貨日 {mdOf(s.td)}{shipLeft < 0 ? ` 已過 ${-shipLeft} 天` : shipLeft === 0 ? ' 就是今天' : ` 只剩 ${shipLeft} 天`}，還沒確認訂單
          </div>
        )}
        <div style={{ marginTop: 4, fontSize: 13, color: '#334155' }}>
          {last ? <>最近：<span style={{ color: '#64748b' }}>{fmtMDHM(last.at)} {last.by}</span>　{last.note}</> : '還沒有追蹤紀錄'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <button onClick={() => openLog(o)} style={{ background: open ? '#0e7490' : '#fff', color: open ? '#fff' : '#0e7490', border: '1px solid #67e8f9', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>＋ 記一筆追蹤</button>
          {s.logs.length > 0 && (
            <button onClick={() => setHistOpen(h => ({ ...h, [o.id]: !h[o.id] }))} style={{ background: 'none', color: '#0e7490', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              紀錄（{s.logs.length}）{hist ? '▲' : '▼'}
            </button>
          )}
        </div>
        {open && (
          <div style={{ marginTop: 8, background: '#fff', border: '1px solid #a5f3fc', borderRadius: 10, padding: 8 }}>
            <textarea value={logDraft.note} onChange={e => setLogDraft(d => ({ ...d, note: e.target.value }))} rows={2} autoFocus aria-label="追蹤內容"
              placeholder="這次聯絡的結果（例：已報價，等客戶回覆；客戶要改 11/30 出貨）"
              style={{ width: '100%', border: '1px solid #cffafe', borderRadius: 8, padding: '6px 8px', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 13, color: '#164e63' }}>
              下次追蹤：
              <input type="date" value={logDraft.next} onChange={e => setLogDraft(d => ({ ...d, next: e.target.value }))} aria-label="下次追蹤日"
                style={{ border: '1px solid #a5f3fc', borderRadius: 8, padding: '3px 6px', fontFamily: 'inherit', fontSize: 13 }} />
              {chip('明天', addDays(todayStr, 1))}{chip('後天', addDays(todayStr, 2))}{chip('3 天後', addDays(todayStr, 3))}{chip('下週一', nextMon)}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => saveLog(o)} style={{ flex: 1, background: '#0e7490', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 0', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>存追蹤紀錄</button>
              <button onClick={() => setLogFor(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
            </div>
          </div>
        )}
        {hist && (
          <div style={{ marginTop: 8, borderTop: '1px dashed #a5f3fc', paddingTop: 6 }}>
            {s.logs.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => {
              const planned = i > 0 ? s.logs[i - 1].next : ''
              const late = planned && l.kind !== 'new' ? dayDiff(planned, localDay(l.at)) : null
              return (
                <div key={i} style={{ fontSize: 12, color: '#334155', padding: '3px 0', lineHeight: 1.5 }}>
                  <span style={{ color: '#64748b' }}>{fmtMDHM(l.at)} {l.by}</span>　{l.note}
                  {late != null && <span style={{ marginLeft: 6, fontWeight: 700, color: late > 0 ? '#b91c1c' : '#047857' }}>{late > 0 ? `晚 ${late} 天` : '準時'}</span>}
                  {l.next && <span style={{ color: '#0e7490' }}>　→ 下次 {mdOf(l.next)}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // 預排客訂分頁上方：今日提醒＋本月成效（給客戶服務科與主管看）
  const renderCsPanel = () => {
    const c = cst
    const month = `${Number(c.ym.slice(5))} 月`
    const tile = (label, value, sub, color) => (
      <div style={{ background: '#fff', border: '1px solid #cffafe', borderRadius: 12, padding: '8px 10px' }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: color || '#164e63', lineHeight: 1.25 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>}
      </div>
    )
    const th2 = { padding: '6px 8px', fontWeight: 800 }
    return (
      <div className="cs-panel" style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 16, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <strong style={{ color: '#0e7490', fontSize: 15 }}>👩‍💼 客戶服務科：今日提醒與{month}成效</strong>
          <span style={{ fontSize: 12, color: '#64748b' }}>新接的單先放這裡，追蹤到客戶確認後按「確認訂單」轉給生產排程科</span>
        </div>
        {shipTodo.length > 0 && (
          <div className="cs-ship-todo" style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 12, padding: '8px 10px', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#c2410c', marginBottom: 2 }}>🚚 已排好生產、等客服定出貨日（{shipTodo.length}）</div>
            {shipTodo.map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px dashed #fed7aa', flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ minWidth: 0 }}>
                  <b>{o.customer_name || o.customerName}</b>　{o.item_name || o.itemName} {o.quantity} 袋
                  <span style={{ color: '#64748b' }}>　生產 {mdw(sdOf(o)) || '—'}{o.cs?.due ? `・交期 ${mdw(o.cs.due)}` : ''}</span>
                </span>
                <button onClick={() => openShip(o)} style={{ background: '#c2410c', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>🚚 定出貨日</button>
              </div>
            ))}
          </div>
        )}
        <div className="cs-tiles">
          {tile('待確認', `${c.open} 件`, c.shipSoon ? `${c.shipSoon} 件出貨日 ${SHIP_WARN_DAYS} 天內` : '', c.shipSoon ? '#be123c' : undefined)}
          {tile('今天要追蹤', `${c.today} 件`, c.noNext ? `另有 ${c.noNext} 件沒排追蹤日` : '', c.today ? '#c2410c' : undefined)}
          {tile('追蹤逾期', `${c.overdue} 件`, '過了追蹤日還沒記錄', c.overdue ? '#b91c1c' : undefined)}
          {tile(`${month}確認`, `${c.confirmed} 件`, `未成交 ${c.lost} 件 · 確認率 ${pct(c.confirmed, c.confirmed + c.lost)}`, '#047857')}
          {tile('平均確認天數', c.avgLead == null ? '—' : `${c.avgLead.toFixed(1)} 天`, '接單 → 確認訂單')}
          {tile('準時追蹤率', pct(c.onTime, c.due), `${c.onTime}/${c.due} 次在排定日當天或之前`)}
        </div>
        {c.people.length > 0 && (
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 10, minWidth: 420 }}>
              <thead><tr style={{ color: '#0e7490', textAlign: 'right' }}>
                <th style={{ ...th2, textAlign: 'left' }}>人員（{month}）</th><th style={th2}>負責中</th><th style={th2}>追蹤次數</th><th style={th2}>準時追蹤</th><th style={th2}>確認</th><th style={th2}>未成交</th>
              </tr></thead>
              <tbody>{c.people.map(p => (
                <tr key={p.name} style={{ borderTop: '1px solid #ecfeff', textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>{p.name}</td>
                  <td style={{ padding: '6px 8px' }}>{p.open}</td>
                  <td style={{ padding: '6px 8px' }}>{p.logs}</td>
                  <td style={{ padding: '6px 8px' }}>{pct(p.onTime, p.due)}</td>
                  <td style={{ padding: '6px 8px', color: '#047857', fontWeight: 700 }}>{p.confirmed}</td>
                  <td style={{ padding: '6px 8px', color: '#64748b' }}>{p.lost}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
          準時追蹤＝在上次排定的追蹤日當天或之前記一筆追蹤（逾期還沒追的也算一次沒準時）；確認率＝確認 ÷（確認＋未成交）。
        </div>
      </div>
    )
  }

  // 預排客訂分頁下方：未成交紀錄（可恢復）
  const renderLostList = () => lostOrders.length > 0 && (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setShowLost(v => !v)} style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
        未成交紀錄（{lostOrders.length}）{showLost ? '▲' : '▼'}
      </button>
      {showLost && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginTop: 6 }}>
          {lostOrders.map(o => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <strong>{o.customer_name || o.customerName}</strong>　{o.item_name || o.itemName} · {o.quantity} 袋
                <div style={{ color: '#64748b', fontSize: 12 }}>{fmtMDHM(o.cs?.lostAt)} {o.cs?.lostBy || ''}　原因：{o.cs?.lostReason || '—'}</div>
              </div>
              <button onClick={() => restoreLost(o)} style={{ background: '#fff', border: '1px solid #a5f3fc', color: '#0e7490', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>恢復成預排</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderAnomaly = () => {
    const match = o => !kw || (o.item_name || o.itemName || '').includes(kw) || (o.customer_name || o.customerName || '').includes(kw)
    const sections = [
      { key: 'late', icon: '🔴', title: '逾期未出貨', desc: '出貨日已過，還沒按「完成出貨」', color: '#be123c', list: anomalies.late.filter(match),
        tag: o => `逾期 ${daysBetween(tdOf(o), todayStr)} 天` },
      { key: 'soon', icon: '🟠', title: '即將到期、還沒備貨', desc: `${SOON_DAYS} 天內要出貨，但還在等待排程／包材準備／完成備貨`, color: '#c2410c', list: anomalies.soon.filter(match),
        tag: o => { const d = daysBetween(todayStr, tdOf(o)); return d === 0 ? '今天要出貨' : `${d} 天後出貨` } },
      { key: 'nodate', icon: '⚪', title: '出貨日還沒定', desc: '已排好生產，客服還沒定出貨日（按「🚚 定出貨日」）', color: '#64748b', list: anomalies.noDate.filter(match),
        tag: () => '出貨日待定' },
    ]
    if (anomalies.total === 0) return <div style={{ textAlign: 'center', padding: '60px 0', color: '#16a34a', fontWeight: 700, fontSize: 16 }}>✅ 目前沒有異常</div>
    const btn = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', padding: '5px 10px', fontSize: 13, color: '#475569', fontFamily: 'inherit' }
    return (
      <div>
        <div style={{ background: '#fff', border: '1px solid #fecdd3', borderRadius: 16, padding: '10px 14px', marginBottom: 14, fontSize: 14, color: '#881337', lineHeight: 1.7 }}>
          <strong>生產部長異常通知：</strong>系統自動整理出貨有問題的客訂，「卡在」標示目前在哪一關、由哪一科負責。
          已經出貨的按「確認出貨」完成；延期的按「✏️ 改出貨日」。處理好就會自動從這裡消失。
        </div>
        {sections.map(sec => sec.list.length > 0 && (
          <div key={sec.key} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', margin: '0 4px 8px' }}>
              <span style={{ fontSize: 16, fontWeight: 900, color: sec.color }}>{sec.icon} {sec.title}（{sec.list.length}）</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{sec.desc}</span>
            </div>
            <div className="op-cards">
              {sec.list.map(o => {
                const st = THEME[o.status] || THEME.pending
                const box = getBoxCount(o)
                return (
                  <div key={o.id} style={{ background: '#fff', borderRadius: 16, border: '1px solid #fecdd3', borderLeft: `5px solid ${sec.color}`, padding: '12px 14px', marginBottom: 10, breakInside: 'avoid' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, color: '#1e293b', minWidth: 0 }}>{o.customer_name || o.customerName || '未知客戶'}</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: sec.color, flexShrink: 0 }}>{sec.tag(o)}</div>
                    </div>
                    <div style={{ fontSize: 14, color: '#475569', marginTop: 2 }}>{o.item_name || o.itemName} · <strong>{o.quantity}</strong> 袋{box > 0 ? ` · ${box} 箱` : ''}</div>
                    <span style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 700, background: st.bg, color: st.accent, border: `1px solid ${st.border}`, borderRadius: 20, padding: '1px 8px' }}>
                      卡在：{STAGE[o.status]?.tab || o.status}{STAGE[o.status]?.dept ? `（${STAGE[o.status].dept}）` : ''}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px dashed #f1f5f9', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#64748b' }}>出貨日：{tdOf(o) || '未定'}{(o.scheduled_date || o.scheduledDate) ? ` · 排程：${o.scheduled_date || o.scheduledDate}` : ''}</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {sec.key === 'nodate'
                          ? <button onClick={() => openShip(o)} style={btn}>🚚 定出貨日</button>
                          : <button onClick={() => openEditForm(o)} style={btn}>✏️ 改出貨日</button>}
                        <button onClick={() => setActiveTab(o.status)} style={btn}>前往「{STAGE[o.status]?.tab}」</button>
                        {NEXT_ACTION[o.status] && (
                          <button onClick={() => openNext(o)} style={{ ...btn, background: st.header, color: '#fff', border: 'none', fontWeight: 700 }}>{NEXT_ACTION[o.status]} ›</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {sections.every(s => s.list.length === 0) && <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>搜尋「{kw}」沒有符合的異常</div>}
      </div>
    )
  }

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
          <button onClick={openSettings} title="品項管理（每袋重量、大箱／中箱袋數、代工品、固定包材）" aria-label="品項管理" style={{ background: 'rgba(255,255,255,.2)', border: 'none', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', fontSize: 16 }}>⚙️</button>
          <button onClick={() => { closeForm(); setIsFormOpen(true) }} style={{ background: '#fff', color: '#1e293b', border: 'none', padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>新增客訂</button>
        </div>
      </div>

      {/* 版面：手機 分頁3+2、卡片1欄；電腦 分頁1列、卡片2欄 */}
      <style>{`
        .op-wrap { max-width: 1200px; margin: 0 auto; padding: 12px 16px; }
        .op-tabs { display: grid; grid-template-columns: repeat(4, 1fr); }
        .op-cards { column-gap: 16px; }
        @media (min-width: 760px) { .op-tabs { grid-template-columns: repeat(7, 1fr); } }
        @media (min-width: 900px) { .op-cards { columns: 2; } }
        .cs-tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        @media (min-width: 760px) { .cs-tiles { grid-template-columns: repeat(6, 1fr); } }
      `}</style>
      <div className="op-wrap">
        <div className="op-tabs" style={{ background: 'rgba(255,255,255,.5)', borderRadius: 16, padding: 4, marginBottom: 12, gap: 4 }}>
          {[...STATES.map(s => [s, STAGE[s].tab, STAGE[s].dept]), [ANOMALY, '異常狀態', '生產部']].map(([t, l, dept]) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '8px 4px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 700, lineHeight: 1.35, cursor: 'pointer', fontFamily: 'inherit', background: activeTab === t ? th.header : 'transparent', color: activeTab === t ? '#fff' : (t === ANOMALY && anomalies.total > 0 ? '#e11d48' : t === 'preorder' && cst.attention + shipTodo.length > 0 ? '#c2410c' : '#94a3b8') }}>
              <div>
                {l}
                {t === ANOMALY && anomalies.total > 0 && (
                  <span style={{ marginLeft: 4, background: activeTab === t ? '#fff' : '#e11d48', color: activeTab === t ? '#e11d48' : '#fff', borderRadius: 10, padding: '0 6px', fontSize: 11, fontWeight: 900 }}>{anomalies.total}</span>
                )}
                {t === 'preorder' && cst.attention + shipTodo.length > 0 && ( // 客服要處理的：追蹤逾期／今天要追／沒排追蹤日／出貨日快到＋排好生產等定出貨日
                  <span title="客服要處理的：預排客訂追蹤＋等定出貨日" style={{ marginLeft: 4, background: activeTab === t ? '#fff' : '#ea580c', color: activeTab === t ? '#ea580c' : '#fff', borderRadius: 10, padding: '0 6px', fontSize: 11, fontWeight: 900 }}>{cst.attention + shipTodo.length}</span>
                )}
              </div>
              {dept && <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>({dept})</div>}
            </button>
          ))}
        </div>

        <input type="text" placeholder={activeTab === 'shipped' ? '🔍 搜尋口味或客戶（查全部月份）...' : '🔍 篩選口味或客戶...'} value={filterFlavor} onChange={e => setFilterFlavor(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,.8)', border: 'none', borderRadius: 16, padding: '12px 16px', fontSize: 15, fontWeight: 700, marginBottom: 12, fontFamily: 'inherit' }} />

        {/* 完成出貨：月份分類（歷史出貨） */}
        {activeTab === 'shipped' && shipMonths.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
              {shipMonths.map(([k, n]) => {
                const on = !kw && k === curShipMonth
                return (
                  <button key={k} onClick={() => { setShipMonth(k); setFilterFlavor('') }} style={{ flex: '0 0 auto', padding: '6px 12px', borderRadius: 20, border: `1px solid ${on ? th.header : '#e2e8f0'}`, background: on ? th.header : '#fff', color: on ? '#fff' : '#475569', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    {k === '未知' ? '未填日期' : k.replace('-', '/')} · {n}筆
                  </button>
                )
              })}
            </div>
            {filteredOrders.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 14, color: '#475569', fontWeight: 700 }}>
                {kw ? `搜尋「${kw}」（全部月份）` : `${curShipMonth === '未知' ? '未填日期' : curShipMonth.replace('-', '/')} 出貨合計`}：{filteredOrders.length} 筆 · {filteredOrders.reduce((s, o) => s + (Number(o.quantity) || 0), 0)} 袋 · {filteredOrders.reduce((s, o) => s + getBoxCount(o), 0)} 箱
              </div>
            )}
          </div>
        )}

        {activeTab === 'preorder' && renderCsPanel()}
        {activeTab === ANOMALY ? renderAnomaly() : groupList.length === 0
            ? <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontStyle: 'italic' }}>{activeTab === 'preorder' ? '目前沒有預排客訂。新接的單按右上「新增客訂」放進來。' : '目前無資料'}</div>
            : <div className="op-cards">{groupList.map(([gKey, group]) => {
              const allOrders = group.all || []
              const parentName = group.parent
              const subGroups = group.subGroups || { [parentName]: allOrders }
              const hasMultipleSub = Object.keys(subGroups).length > 1
              // 整批（同客戶同出貨日，含已經到其他關卡的單）
              const batch = batches[gKey] || allOrders
              const others = batch.filter(o => o.status !== activeTab)
              const otherBy = others.reduce((m, o) => ({ ...m, [o.status]: (m[o.status] || 0) + 1 }), {})
              const bPkg = batch.reduce((s, o) => s + getPkgCount(o), 0)
              const bBox = batch.reduce((s, o) => s + getBoxCount(o), 0)
              const bm = batch.map(mergeOf).find(x => x.on && x.date)
              return (
              <div key={gKey} style={{ background: '#fff', borderRadius: 24, border: `1px solid ${th.border}`, overflow: 'hidden', marginBottom: 16, breakInside: 'avoid' }}>
                {/* 母客戶＋出貨日標題列：筆數、包數、箱數算整批 */}
                <div style={{ background: th.header, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="op-batch-name" style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>{hasMultipleSub ? parentName : Object.keys(subGroups)[0]}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.22)', borderRadius: 10, padding: '1px 8px' }}>{group.td ? `${mdw(group.td)} 出貨` : '出貨日未定'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="op-batch-total" style={{ fontSize: 13, color: 'rgba(255,255,255,.92)', fontWeight: 700 }}>共{batch.length}筆・{bPkg}包{bBox > 0 ? `・${bBox}箱` : ''}</span>
                  </div>
                </div>
                {(others.length > 0 || bm) && (
                  <div className="op-batch-strip" style={{ background: th.bg, borderBottom: `1px solid ${th.border}`, padding: '6px 16px', fontSize: 13, color: th.accent, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
                    {bm && <span style={{ fontWeight: 800 }}>🚢 {mergeTxt(bm)}</span>}
                    {others.length > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        本區 {allOrders.length} 筆，同批另有
                        {Object.entries(otherBy).map(([st, n]) => (
                          <button key={st} onClick={() => setActiveTab(st)} title={`切到「${STATUS_LABEL[st]}」`}
                            style={{ background: '#fff', border: `1px solid ${th.border}`, borderRadius: 10, padding: '0 8px', fontSize: 12, fontWeight: 800, color: th.accent, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {n} 筆在「{STATUS_LABEL[st]}」
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                )}
                {/* 各子客戶 */}
                {Object.entries(subGroups).map(([subName, list]) => (
                <div key={subName} style={{ borderBottom: `1px solid ${th.border}` }}>
                  {hasMultipleSub && (
                    <div style={{ background: 'rgba(255,255,255,.6)', padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${th.border}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>{subName}</span>
                        {list[0]?.shipping_mark && <span style={{ fontSize: 11, background: '#fef2f2', color: '#ef4444', padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>🏷️ 一般麥頭</span>}
                        {list[0]?.color_mark && <span style={{ fontSize: 11, background: '#fdf4ff', color: '#7e22ce', padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>🎨 彩色{list[0]?.color_mark_note ? `(${list[0].color_mark_note})` : ''}</span>}
                        {list[0]?.pack?.carton && <span style={{ fontSize: 11, background: '#ecfeff', color: '#0e7490', padding: '1px 7px', borderRadius: 20, fontWeight: 700 }}>📌 外箱貼</span>}
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
                  const pk = { ...EMPTY_PACK, ...(o.pack || {}) }
                  const pItems = packItems(o, getBoxCount(o))
                  const showChecklist = o.status === 'packaging' && pItems.length > 0 // 包材準備：外箱、麥頭、內包裝、貼紙改成勾選清單
                  const pDone = pItems.filter(it => it.done).length
                  return (
                    <div key={o.id} style={{ padding: '16px', borderBottom: `1px solid #f8fafc` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1, paddingRight: 12 }}>
                          <div style={{ fontSize: 18, fontWeight: 900, color: th.accent, marginBottom: 4 }}>{o.item_name||o.itemName}</div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {(o.is_mixed_box||o.isMixedBox) && <span style={{ fontSize: 12, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>併箱</span>}
                            <span style={{ fontSize: 12, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 6 }}>{o.weight_per_bag || 5250}g/袋</span>
                            {pk.oem && <span title="代工品：不進生產排程、不扣庫存" style={{ fontSize: 12, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>🏭 代工品</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 26, fontWeight: 900, color: '#1e293b' }}>{o.quantity} <span style={{ fontSize: 14, color: '#94a3b8' }}>袋</span></div>
                          {getBoxCount(o) > 0 && <div style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}>📦 {getBoxCount(o)} 箱</div>}
                          {o.box_count > 0 && o.box_qty_each > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>{o.box_count}箱 × {o.box_qty_each}袋/箱</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {!showChecklist && <>
                          {(o.box_type||o.boxType) && <span style={{ fontSize: 12, background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>{o.box_type||o.boxType}</span>}
                          {!hasMultipleSub && (o.shipping_mark||o.shippingMark) && <span style={{ fontSize: 12, background: '#fef2f2', color: '#ef4444', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>🏷️ 一般麥頭</span>}
                          {!hasMultipleSub && o.color_mark && <span style={{ fontSize: 12, background: '#fdf4ff', color: '#7e22ce', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>🎨 彩色麥頭{o.color_mark_note ? `(${o.color_mark_note})` : ''}</span>}
                          {pk.carton && <span style={{ fontSize: 12, background: '#ecfeff', color: '#0e7490', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>📌 外箱貼{pk.cartonNote ? `(${pk.cartonNote})` : ''}</span>}
                          {pk.inner && <span style={{ fontSize: 12, background: '#f5f3ff', color: '#6d28d9', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>🛍 {innerTxt(pk)}</span>}
                          {pk.sticker && <span style={{ fontSize: 12, background: '#fffbeb', color: '#b45309', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>🏷 貼紙 {stickerTxt(pk)}</span>}
                        </>}
                        {o.cs?.payDate && o.status !== 'shipped' && (() => { // 付款日・交期（出貨日比交期晚、或還沒定出貨日卻已過交期 → 紅色）
                          const due = o.cs.due || dueOf(o.cs), td = shipDateOf(o)
                          const bad = td ? td > due : due < todayStr
                          return (
                            <span className="op-due-chip" title={`${mdOf(o.cs.payDate)} 付款後 ${o.cs.leadDays || LEAD_DAYS} 個工作天`}
                              style={{ fontSize: 12, background: bad ? '#fef2f2' : '#fffbeb', color: bad ? '#dc2626' : '#92400e', border: `1px solid ${bad ? '#fecaca' : '#fde68a'}`, padding: '1px 8px', borderRadius: 6, fontWeight: 800 }}>
                              💰 {mdOf(o.cs.payDate)} 付款・⏰ 交期 {mdw(due)}{bad ? (td ? '（出貨日比交期晚）' : '（已過交期）') : ''}
                            </span>
                          )
                        })()}
                        {o.notes && <span style={{ fontSize: 12, background: '#f8fafc', color: '#475569', padding: '2px 8px', borderRadius: 6 }}>📝 {o.notes}</span>}
                      </div>
                      {showChecklist && (
                        <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12, padding: '8px 10px', marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 800, color: '#6d28d9', marginBottom: 2 }}>
                            <span>📋 包材清單（倉管勾選）</span>
                            <span style={{ color: pDone === pItems.length ? '#059669' : '#b45309' }}>{pDone}/{pItems.length} 已備妥</span>
                          </div>
                          {pItems.map(it => (
                            <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', cursor: 'pointer', borderTop: '1px dashed #ede9fe' }}>
                              <input type="checkbox" checked={it.done} onChange={() => toggleCheck(o, it)} style={{ width: 19, height: 19, accentColor: '#7c3aed', flexShrink: 0 }} aria-label={`包材 ${it.name}`} />
                              <span style={{ fontWeight: 800, fontSize: 14, minWidth: 64, color: it.done ? '#94a3b8' : '#1e293b', textDecoration: it.done ? 'line-through' : 'none' }}>{it.name}</span>
                              <span style={{ fontSize: 13, flex: 1, color: it.done ? '#94a3b8' : '#475569' }}>{it.spec}</span>
                              {it.done && <span style={{ fontSize: 11, color: '#059669', whiteSpace: 'nowrap' }}>✓ {fmtMDHM(it.at)}</span>}
                            </label>
                          ))}
                        </div>
                      )}
                      {o.status === 'preorder' && renderCsBox(o)}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px dashed #f1f5f9' }}>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {(o.scheduled_date||o.scheduledDate) && <div>排程：{o.scheduled_date||o.scheduledDate}</div>}
                          <div style={{ fontWeight: 700, color: th.accent, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {o.status === 'preorder' ? '預計出貨' : '出貨'}：{o.target_date||o.targetDate || '未定'}
                            {ACTIVE.includes(o.status) && !shipDateOf(o) && (
                              <button onClick={() => openShip(o)} className="op-ship-btn" style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#c2410c', borderRadius: 8, padding: '2px 8px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>🚚 定出貨日</button>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {o.status === 'pending' && (() => { // 等待排程：生產排程加入 Google 日曆
                            const added = prodCalInfo(o).added
                            return (
                              <button onClick={() => setProdCalFor({ id: o.id, confirmed: false })} aria-label="生產排程加入 Google 日曆" title={added ? '已加過生產排程的日曆（可以再加）' : '生產排程加入 Google 日曆'}
                                style={{ background: added ? '#eff6ff' : 'none', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: added ? 13 : 16, fontWeight: 800, color: '#2563eb', padding: '4px 6px', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>📅{added ? ' 已加' : ''}</button>
                            )
                          })()}
                          <button onClick={() => openEditForm(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 6px' }}>✏️</button>
                          <button onClick={() => deleteOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a3b8', padding: '4px 6px' }}>🗑️</button>
                          {o.status === 'preorder'
                            ? <button onClick={() => setLostModal({ order: o, reason: '', note: '' })} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', padding: '4px 8px', fontSize: 12, color: '#64748b' }}>未成交</button>
                            : <button onClick={() => changeStatus(o, -1)} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', padding: '4px 8px', fontSize: 11, color: '#475569' }}>退回上一狀態</button>}
                          {NEXT_ACTION[o.status] && (
                          <button onClick={() => openNext(o)} style={{ background: th.header, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', padding: '6px 14px', fontWeight: 700, fontSize: 14 }}>
                            {NEXT_ACTION[o.status]} ›
                          </button>
                          )}
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
                    <span style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>{others.length ? '本區合計' : '合計'}</span>
  <span style={{ fontSize: 15, fontWeight: 900, color: th.accent }}>{(() => {
                      const fPkg = allOrders.reduce((s,o) => s + getPkgCount(o), 0)
                      const fBox = allOrders.reduce((s,o) => s + getBoxCount(o), 0)
                      return `${fPkg} 包${fBox > 0 ? `・${fBox} 箱` : ''}`
                    })()}</span>
                  </div>
                )}
              </div>
            )})}</div>}
        {activeTab === 'preorder' && renderLostList()}
      </div>

      {/* 未成交 */}
      {lostModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 340, borderRadius: 24, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>標記未成交</h2>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              {lostModal.order.customer_name || lostModal.order.customerName} ・ {lostModal.order.item_name || lostModal.order.itemName}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>原因</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {LOST_REASONS.map(r => (
                <button key={r} onClick={() => setLostModal(m => ({ ...m, reason: r }))} aria-pressed={lostModal.reason === r}
                  style={{ border: `1px solid ${lostModal.reason === r ? '#475569' : '#e2e8f0'}`, background: lostModal.reason === r ? '#475569' : '#fff', color: lostModal.reason === r ? '#fff' : '#475569', borderRadius: 16, padding: '4px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{r}</button>
              ))}
            </div>
            <input value={lostModal.note} onChange={e => setLostModal(m => ({ ...m, note: e.target.value }))} placeholder="補充說明（選填）" aria-label="未成交說明"
              style={{ width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', fontSize: 14 }} />
            <div style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0 14px' }}>未成交的單會移到「未成交紀錄」，不會刪掉，之後可以恢復。</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setLostModal(null)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>取消</button>
              <button onClick={confirmLost} style={{ flex: 2, padding: '11px', background: '#475569', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 900, cursor: 'pointer' }}>確認未成交</button>
            </div>
          </div>
        </div>
      )}

      {/* 設定 */}
      {isSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 460, borderRadius: 28, padding: 24, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ fontSize: 16, fontWeight: 900 }}>品項管理</h2>
              <button onClick={() => setIsSettingsOpen(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 1.6 }}>
              新增客訂選這個品項時，自動帶入每袋重量、每箱袋數（選大箱帶大箱的、選中箱帶中箱的）和固定包材。固定包材在新增客訂表單填好後按「💾 存成固定規格」。勾「代工品」的（例：里仁剝皮辣椒）只在客訂管理跑流程，<b>不進生產排程、不扣庫存</b>。
            </div>
            {editingConfigs.map((c, i) => {
              const set = patch => setEditingConfigs(list => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))
              const num = { width: 64, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 6px', fontFamily: 'inherit', fontSize: 14, textAlign: 'right' }
              return (
                <div key={i} className="op-spec-row" style={{ background: c.oem ? '#fffbeb' : '#f8fafc', border: `1px solid ${c.oem ? '#fde68a' : '#e2e8f0'}`, borderRadius: 12, padding: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="text" value={c.name} onChange={e => set({ name: e.target.value })} placeholder="品名" aria-label="品名"
                      style={{ flex: 1, minWidth: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontWeight: 700, color: '#4f46e5', fontFamily: 'inherit' }} />
                    <button type="button" onClick={() => setEditingConfigs(list => list.filter((_, j) => j !== i))} aria-label={`刪除品項 ${c.name}`} style={{ background: '#fef2f2', border: 'none', borderRadius: 8, padding: '0 10px', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 13, color: '#475569' }}>
                    每袋<input type="number" value={c.g} onChange={e => set({ g: e.target.value })} aria-label={`${c.name} 每袋重量`} style={num} />g
                    <span style={{ marginLeft: 4 }}>大箱</span><input type="number" value={c.big} onChange={e => set({ big: e.target.value })} aria-label={`${c.name} 大箱袋數`} style={{ ...num, width: 52 }} />袋
                    <span style={{ marginLeft: 4 }}>中箱</span><input type="number" value={c.mid} onChange={e => set({ mid: e.target.value })} aria-label={`${c.name} 中箱袋數`} style={{ ...num, width: 52 }} />袋
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontWeight: 800, color: c.oem ? '#92400e' : '#64748b', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!c.oem} onChange={e => set({ oem: e.target.checked })} aria-label={`${c.name} 代工品`} style={{ width: 15, height: 15 }} />代工品
                    </label>
                  </div>
                  {(c.pack || c.box) && (
                    <div className="op-spec-fixed" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: '#6d28d9', background: '#f5f3ff', borderRadius: 8, padding: '4px 8px' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>🛍 固定：{[c.box, c.pack ? (packTxt(c.pack) || '不用內包裝、貼紙') : ''].filter(Boolean).join('、')}</span>
                      <button type="button" onClick={() => set({ pack: null, box: '' })} aria-label={`清除 ${c.name} 固定包材`}
                        style={{ border: 'none', background: 'none', color: '#7c3aed', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, padding: 0 }}>清除</button>
                    </div>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={() => setEditingConfigs([...editingConfigs, { name: '', g: '', big: '', mid: '', box: '', pack: null, oem: false }])} style={{ width: '100%', padding: '8px', background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 10, color: '#6366f1', fontWeight: 700, cursor: 'pointer', marginBottom: 12 }}>+ 新增品項</button>
            <button onClick={syncSettings} style={{ width: '100%', padding: '12px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 16, fontWeight: 900, fontSize: 15, cursor: 'pointer' }}>確認並同步</button>
          </div>
        </div>
      )}

      {/* 狀態日期 Modal */}
      {statusModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: statusModal.order.status === 'preorder' ? 400 : 320, borderRadius: 24, padding: 24, maxHeight: '92vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>{statusModal.label}</h2>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              {statusModal.order.customer_name || statusModal.order.customerName} ・ {statusModal.order.item_name || statusModal.order.itemName}
            </div>
            {STAGE[statusModal.order.status]?.note && (
              <div style={{ fontSize: 14, color: mth.accent, background: mth.bg, borderRadius: 12, padding: '10px 12px', marginBottom: 16, lineHeight: 1.6 }}>
                {STAGE[statusModal.order.status].note}
                {modalLeft && modalLeft.total > 0 && (
                  <div style={{ marginTop: 8, fontWeight: 800, color: modalLeft.left.length ? '#b45309' : '#047857' }}>
                    {modalLeft.left.length
                      ? `⚠ 包材清單還有 ${modalLeft.left.length} 項沒勾：${modalLeft.left.map(it => it.name).join('、')}`
                      : `✅ 包材清單 ${modalLeft.total}/${modalLeft.total} 都已勾選`}
                  </div>
                )}
              </div>
            )}
            {statusModal.order.status === 'preorder' && <>
              {renderPay(shipSt, setShipP)}
              {renderMerge(shipSt.merge, p => setShipP({ merge: p }), shipSt.ship, false)}
              {renderShipDate(shipSt, setShipP, false)}
              {statusErr && <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 700, margin: '-4px 0 12px' }}>{statusErr}</div>}
            </>}
            {statusModal.order.status === 'pending' && renderDueInfo(orders.find(x => x.id === statusModal.order.id) || statusModal.order, statusDate)}
            {STAGE[statusModal.order.status]?.dateLabel && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>
                {STAGE[statusModal.order.status].dateLabel}
              </div>
              <input type="date" value={statusDate} onChange={e => { setStatusDate(e.target.value); setStatusErr('') }} aria-label={STAGE[statusModal.order.status].dateLabel}
                style={{ width: '100%', background: '#f8fafc', border: `1px solid ${statusErr ? '#f87171' : '#e2e8f0'}`, borderRadius: 12, padding: '10px', fontFamily: 'inherit', fontSize: 15 }} />
              {statusErr && <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 700, marginTop: 6 }}>{statusErr}</div>}
            </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStatusModal(null)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>取消</button>
              <button onClick={async () => {
                const o = statusModal.order, now = new Date().toISOString()
                const updateData = { status: statusModal.nextStatus, updated_at: now }
                if (o.status === 'pending') updateData.scheduled_date = statusDate
                if (o.status === 'preorder') { // 確認訂單：出貨日可以先空著；記下誰、什麼時候確認；付款日、併櫃一起存
                  if (shipSt.merge.on && !shipSt.merge.date) { setStatusErr('請填併櫃日期（不併櫃的話把勾勾取消）'); return }
                  updateData.target_date = shipSt.ship || ''
                  updateData.cs = applyShip({ ...(o.cs || {}), receivedAt: o.cs?.receivedAt || o.created_at, owner: o.cs?.owner || me, confirmedAt: now, confirmedBy: me, next: '' }, shipSt)
                }
                const { error } = await updateOrder(o.id, updateData, '狀態已更新，但')
                if (error) { alert('狀態更新失敗：' + error.message); return }
                if (o.status === 'preorder') { // 轉到等待排程；出貨日定了才問要不要加出貨的 Google 日曆
                  const up = { ...o, ...updateData }
                  setOrders(l => l.map(x => (x.id === o.id ? up : x)))
                  if (up.target_date) setCalFor({ key: batchKey(up), confirmed: true })
                }
                if (o.status === 'pending' && statusDate) { // 排入行程後，問要不要加生產排程的 Google 日曆
                  setOrders(l => l.map(x => (x.id === o.id ? { ...o, ...updateData } : x)))
                  setProdCalFor({ id: o.id, confirmed: true })
                }
                fetchOrders()
                showToast(o.status === 'preorder' && !updateData.target_date ? '已確認訂單 ✅ 出貨日等排好生產再定（卡片上按「🚚 定出貨日」）' : `${statusModal.label} ✅`)
                setStatusModal(null)
              }} style={{ flex: 2, padding: '11px', background: mth.header, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 900, cursor: 'pointer' }}>{modalLeft?.left.length ? '仍要確認' : '確認'} {statusModal.label}</button>
            </div>
          </div>
        </div>
      )}

      {/* 🚚 定出貨日：排好生產後，客服定出貨日（定好接著問要不要加出貨的 Google 日曆） */}
      {shipFor && (() => {
        const o = orders.find(x => x.id === shipFor.id)
        if (!o) return null
        const others = shipOthers(o)
        const sd = sdOf(o)
        const nm = o.customer_name || o.customerName
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
            <div role="dialog" aria-label="定出貨日" style={{ background: '#fff', width: '100%', maxWidth: 400, borderRadius: 24, padding: 24, maxHeight: '92vh', overflowY: 'auto' }}>
              <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>🚚 定出貨日</h2>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{nm} ・ {o.item_name || o.itemName} {o.quantity} 袋</div>
              <div style={{ fontSize: 14, background: '#f0fdf4', color: '#065f46', borderRadius: 12, padding: '8px 12px', marginBottom: 12, lineHeight: 1.6 }}>
                目前在「{STATUS_LABEL[o.status]}」・排程生產日 <b>{sd ? mdw(sd) : '還沒排'}</b>
              </div>
              {renderPay(shipSt, setShipP)}
              {renderMerge(shipSt.merge, p => setShipP({ merge: p }), shipSt.ship, false)}
              {renderShipDate(shipSt, setShipP, true)}
              {others.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '8px 10px', marginBottom: 12, cursor: 'pointer', fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
                  <input type="checkbox" checked={shipFor.withOthers} onChange={e => setShipFor(f => ({ ...f, withOthers: e.target.checked }))} aria-label="同客戶出貨日待定的一起定" style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                  <span>同客戶出貨日待定的另外 <b>{others.length}</b> 筆也一起定（出貨日、併櫃一樣）
                    <br /><span style={{ color: '#64748b' }}>{others.map(x => `${(x.customer_name || x.customerName) !== nm ? `${x.customer_name || x.customerName} ` : ''}${x.item_name || x.itemName} ${x.quantity}袋`).join('、')}</span>
                  </span>
                </label>
              )}
              {statusErr && <div style={{ color: '#dc2626', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{statusErr}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShipFor(null)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
                <button onClick={saveShip} style={{ flex: 2, padding: '11px', background: '#0e7490', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>確認出貨日</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 生產排程的 Google 日曆：排入行程後、或等待排程卡片上的 📅 */}
      {prodCalFor && (() => {
        const o = orders.find(x => x.id === prodCalFor.id)
        if (!o) return null
        const info = prodCalInfo(o)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 125, padding: 16 }}>
            <div role="dialog" aria-label="生產排程加入 Google 日曆" style={{ background: '#fff', width: '100%', maxWidth: 400, borderRadius: 24, padding: 22, maxHeight: '92vh', overflowY: 'auto' }}>
              {prodCalFor.confirmed && <div style={{ fontSize: 14, fontWeight: 800, color: '#047857', marginBottom: 6 }}>✅ 已排入行程，轉到「包材準備」</div>}
              <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>📅 要把生產排程加到 Google 日曆嗎？</h2>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>格式跟「生產排程」頁的日曆一樣，放在生產日。</div>
              {!info.date ? (
                <div style={{ fontSize: 14, color: '#b45309', background: '#fffbeb', borderRadius: 12, padding: 12 }}>還沒有排程生產日：按 ✏️ 填「排程生產日」，或按「排入行程」選日期。</div>
              ) : (
                <>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{mdw(info.date)}　整天</div>
                    <div className="op-cal-title" style={{ fontSize: 17, fontWeight: 900, color: '#1e293b', margin: '2px 0 6px' }}>{info.title}</div>
                    <div className="op-cal-details" style={{ fontSize: 12.5, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{info.details}</div>
                  </div>
                  {info.added && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', background: '#f0f9ff', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
                      ℹ {mdOf(info.date)} 的生產排程已經加過日曆（{fmtMDHM(info.added.prodCalAt)} {info.added.prodCalBy}），再加會多一個活動。
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => setProdCalFor(null)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>{info.url ? '先不要' : '關閉'}</button>
                {info.url && (
                  <a href={info.url} target="_blank" rel="noreferrer" onClick={() => markProdCal(o, info)}
                    style={{ flex: 2, padding: '11px', background: '#2563eb', color: '#fff', borderRadius: 12, fontWeight: 900, textAlign: 'center', textDecoration: 'none' }}>📅 {info.added ? '再加一次' : '加入 Google 日曆'}</a>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* 出貨的 Google 日曆：預排客訂按「確認訂單」後 */}
      {calFor && (() => {
        const info = batchCal(calFor.key)
        const preNames = uniq(info.pre.map(o => o.item_name || o.itemName)).join('、')
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 125, padding: 16 }}>
            <div role="dialog" aria-label="加入 Google 日曆" style={{ background: '#fff', width: '100%', maxWidth: 400, borderRadius: 24, padding: 22, maxHeight: '92vh', overflowY: 'auto' }}>
              {(calFor.done || calFor.confirmed) && <div style={{ fontSize: 14, fontWeight: 800, color: '#047857', marginBottom: 6 }}>{calFor.done || '✅ 已確認訂單，轉到「等待排程」'}</div>}
              <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>📅 要把這批出貨加到 Google 日曆嗎？</h2>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>客服看日曆就知道哪天要安排出貨。</div>
              {info.list.length === 0 ? (
                <div style={{ fontSize: 14, color: '#475569', background: '#f8fafc', borderRadius: 12, padding: 12 }}>這批還沒有確認過的單，確認訂單後再加。</div>
              ) : (
                <>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{mdw(info.td)}　整天</div>
                    <div className="op-cal-title" style={{ fontSize: 17, fontWeight: 900, color: '#1e293b', margin: '2px 0 6px' }}>{info.title}</div>
                    <div className="op-cal-details" style={{ fontSize: 12.5, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 230, overflowY: 'auto' }}>{info.details}</div>
                  </div>
                  {info.pre.length > 0 && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#b45309', background: '#fffbeb', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
                      ⚠ 同一批還有 {info.pre.length} 筆在「預排客訂」還沒確認（{preNames}），日曆上不會列；建議全部確認後再加。
                    </div>
                  )}
                  {info.cal && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', background: '#f0f9ff', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
                      ℹ 這批 {mdOf(info.td)} 已經加過日曆（{fmtMDHM(info.cal.calAt)} {info.cal.calBy}），再加會多一個活動。
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => setCalFor(null)} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: 12, fontWeight: 700, color: '#64748b', cursor: 'pointer', fontFamily: 'inherit' }}>{info.list.length ? '先不要' : '關閉'}</button>
                {info.url && (
                  <a href={info.url} target="_blank" rel="noreferrer" onClick={() => markCal(info)}
                    style={{ flex: 2, padding: '11px', background: '#2563eb', color: '#fff', borderRadius: 12, fontWeight: 900, textAlign: 'center', textDecoration: 'none' }}>📅 {info.cal ? '再加一次' : '加入 Google 日曆'}</a>
                )}
              </div>
              {info.url && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>會開 Google 日曆的新增活動頁，可以在那裡選「銷貨科-預定出貨清單」再按儲存。</div>}
            </div>
          </div>
        )
      })()}

      {/* 確認視窗 */}
      {isConfirmOpen && pendingOrderData && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 360, borderRadius: 28, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#3730a3', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>🛡️ 請確認訂單內容</h2>
            {!editingOrderId && <div style={{ fontSize: 13, color: '#0e7490', fontWeight: 700, background: '#ecfeff', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>📞 新單會先放進「預排客訂」，客戶確認後再按「確認訂單」轉給生產排程科。</div>}
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 3 }}>客戶：<strong style={{ color: '#1e293b' }}>{pendingOrderData.customer_name}</strong></div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 3 }}>品項：<strong style={{ color: '#4f46e5' }}>{pendingOrderData.item_name}</strong></div>
              <div style={{ fontSize: 14, color: '#64748b', marginBottom: 10 }}>出貨日：<strong style={{ color: pendingOrderData.target_date ? '#dc2626' : '#94a3b8' }}>{pendingOrderData.target_date || '未定（排好生產再定）'}</strong></div>
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
              {pendingOrderData.pack?.inner && <div style={{ background: '#f5f3ff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#6d28d9' }}>🛍 {innerTxt(pendingOrderData.pack)}</div>}
              {pendingOrderData.pack?.sticker && <div style={{ background: '#fffbeb', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#b45309' }}>🏷 貼紙 {stickerTxt(pendingOrderData.pack)}</div>}
              {pendingOrderData.pack?.carton && <div style={{ background: '#ecfeff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#0e7490' }}>📌 外箱貼{pendingOrderData.pack.cartonNote ? `(${pendingOrderData.pack.cartonNote})` : ''}</div>}
              {pendingOrderData.pack?.oem && <div style={{ background: '#fef3c7', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 800, color: '#92400e' }}>🏭 代工品（不進生產排程、庫存）</div>}
              {pendingOrderData.merge?.on && <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#0369a1' }}>🚢 {mergeTxt(pendingOrderData.merge)}</div>}
              {pendingOrderData.payDate && <div style={{ background: '#fffbeb', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, color: '#92400e' }}>💰 {mdOf(pendingOrderData.payDate)} 付款・⏰ 交期 {mdw(dueOf(pendingOrderData))}</div>}
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

            {/* 1. 客戶名稱 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>客戶名稱 *</div>
              <input type="text" name="customer_name" value={formData.customer_name} onChange={handleInputChange} aria-label="客戶名稱" style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px 14px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit' }} placeholder="例如：麗合-本院" inputMode="text" lang="zh-TW" />
            </div>

            {/* 2. 品項規格：清單裡的固定品項自動帶入每袋重量、外箱、每箱袋數、包材 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>品項規格 *<span style={{ fontWeight: 400, marginLeft: 6 }}>（打字搜尋或從清單選）</span></div>
              <input type="text" name="item_name" list="op-item-list" value={formData.item_name} onChange={e => pickItem(e.target.value)} placeholder="例：里仁剝皮辣椒" aria-label="品項規格" autoComplete="off"
                style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '12px 14px', fontWeight: 700, fontFamily: 'inherit', fontSize: 15 }} />
              <datalist id="op-item-list">{savedItems.map(f => <option key={f} value={f} />)}</datalist>
              {(() => { // 選到清單裡的品項：顯示帶入的固定規格
                const nm = formData.item_name.trim()
                if (!nm) return null
                const sp = itemSpecs[nm]
                if (!savedItems.includes(nm)) return <div className="op-item-spec" style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>清單裡沒有這個品項，客製品照打就好；固定品項填好規格後，按包材下面的「💾 存成固定規格」。</div>
                if (!sp) return null
                const parts = [sp.g ? `${sp.g}g/袋` : '', specBoxTxt(sp), sp.pack ? `包材 ${packTxt(sp.pack) || '不用內包裝、貼紙'}` : ''].filter(Boolean)
                return (
                  <div className="op-item-spec" style={{ fontSize: 12, color: '#4f46e5', marginTop: 4, fontWeight: 700, lineHeight: 1.5 }}>
                    📋 固定規格已帶入：{parts.join('、') || '—'}
                    {sp.oem && <span style={{ marginLeft: 6, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '1px 6px' }}>🏭 代工品：不進生產排程、庫存</span>}
                  </div>
                )
              })()}
            </div>

            {/* 3. 訂購數量：選外箱（大箱／中箱）帶入每箱袋數 → 填箱數自動換算袋數 */}
            {(() => {
              const sp = itemSpecs[formData.item_name.trim()]
              const qty = Number(formData.quantity) || 0
              const segQ = on => ({ padding: '3px 10px', borderRadius: 8, border: `1px solid ${on ? '#4f46e5' : '#c7d2fe'}`, background: on ? '#4f46e5' : '#fff', color: on ? '#fff' : '#4f46e5', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' })
              const inp = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px', fontFamily: 'inherit', minWidth: 0 }
              return (
                <div className="op-qty" style={{ background: '#f8fafc', borderRadius: 16, padding: 12, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700 }}>訂購數量 *</div>
                    {perBoxNow > 0 && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" onClick={() => setUseBoxCalc(true)} aria-pressed={boxMode} style={segQ(boxMode)}>填箱數</button>
                        <button type="button" onClick={() => setUseBoxCalc(false)} aria-pressed={!boxMode} style={segQ(!boxMode)}>填袋數</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <select value={formData.box_type || ''} onChange={e => pickBox(e.target.value)} aria-label="外箱規格" style={{ ...inp, width: '100%' }}>
                      <option value="">外箱：請選擇</option>
                      {BOX_TYPES.map(t => <option key={t} value={t}>{t}{perBoxOf(sp, t) ? `（${perBoxOf(sp, t)} 袋/箱）` : ''}</option>)}
                      {formData.box_type && !BOX_TYPES.includes(formData.box_type) && <option value={formData.box_type}>{formData.box_type}</option>}
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#475569', whiteSpace: 'nowrap' }}>
                      每箱
                      <input type="number" min="0" value={formData.items_per_box ?? ''} onChange={e => setPerBox(e.target.value)} placeholder="—" aria-label="每箱袋數"
                        style={{ ...inp, flex: 1, width: '100%', textAlign: 'center', fontWeight: 700 }} />
                      袋
                    </div>
                  </div>
                  {boxMode ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
                      <input type="number" min="0" value={boxCountInput} onChange={e => setBoxCountInput(e.target.value)} placeholder="箱數" aria-label="箱數"
                        style={{ ...inp, padding: '10px', fontSize: 18, fontWeight: 900, textAlign: 'center' }} />
                      <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', whiteSpace: 'nowrap' }}>箱 × {perBoxNow} 袋 =</span>
                      <div className="op-qty-total" style={{ background: '#ecfdf5', borderRadius: 10, padding: '10px', fontSize: 18, fontWeight: 900, textAlign: 'center', color: '#059669' }}>{calcedQty || '?'} 袋</div>
                    </div>
                  ) : (
                    <>
                      <input type="number" min="0" name="quantity" value={formData.quantity} onChange={handleInputChange} placeholder="袋數" aria-label="訂購袋數"
                        style={{ ...inp, width: '100%', padding: '10px', fontSize: 20, fontWeight: 900, textAlign: 'center' }} />
                      {perBoxNow > 0 && qty > 0 && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, textAlign: 'center' }}>約 {Math.floor(qty / perBoxNow)} 箱{qty % perBoxNow ? ` + ${qty % perBoxNow} 袋` : ''}</div>}
                    </>
                  )}
                </div>
              )
            })()}

            {/* 4. 每袋重量 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>每袋重量(g)</div>
              <input type="number" name="weight_per_bag" value={formData.weight_per_bag} onChange={handleInputChange} aria-label="每袋重量" style={{ width: '100%', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px', fontSize: 16, fontWeight: 900, color: '#ef4444', textAlign: 'center', fontFamily: 'inherit' }} />
            </div>

            {/* 5. 特殊備註 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, marginBottom: 4 }}>特殊備註</div>
              <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" aria-label="特殊備註" style={{ width: '100%', background: '#f8fafc', border: 'none', borderRadius: 12, padding: '10px 12px', fontFamily: 'inherit', resize: 'none' }} />
            </div>

            {/* 6. 併箱口味 */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 12, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" name="is_mixed_box" checked={formData.is_mixed_box} onChange={handleInputChange} style={{ width: 17, height: 17, marginTop: 1 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>併箱口味（儲存後保留客戶與日期，方便輸入下一項）</span>
            </label>

            {/* 7. 理貨與裝箱資訊：物流、麥頭、外箱貼（外箱規格、每箱袋數在「訂購數量」） */}
            <div style={{ background: '#eef2ff', borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#4f46e5', marginBottom: 10 }}>🚛 理貨與裝箱資訊</div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 3 }}>物流方式</div>
                <select name="logistics" value={formData.logistics} onChange={handleInputChange} aria-label="物流方式" style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }}>
                  <option value="">請選擇</option>
                  <option>黑貓</option><option>新竹</option><option>大榮</option><option>自取</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '7px 8px', borderRadius: 10, cursor: 'pointer' }}>
                  <input type="checkbox" name="shipping_mark" checked={formData.shipping_mark} onChange={handleInputChange} style={{ width: 15, height: 15, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap' }}>🏷️ 一般麥頭</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '7px 8px', borderRadius: 10, cursor: 'pointer' }}>
                  <input type="checkbox" name="color_mark" checked={formData.color_mark} onChange={handleInputChange} style={{ width: 15, height: 15, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#7e22ce', whiteSpace: 'nowrap' }}>🎨 彩色麥頭</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '7px 8px', borderRadius: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!formData.pack?.carton} onChange={e => setPack({ carton: e.target.checked })} aria-label="外箱貼" style={{ width: 15, height: 15, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0e7490', whiteSpace: 'nowrap' }}>📌 外箱貼</span>
                </label>
              </div>
              {formData.color_mark && (
                <input type="text" name="color_mark_note" value={formData.color_mark_note} onChange={handleInputChange} placeholder="顏色說明（例：紅色）" style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', marginTop: 6, fontSize: 13 }} />
              )}
              {formData.pack?.carton && (
                <input type="text" value={formData.pack?.cartonNote || ''} onChange={e => setPack({ cartonNote: e.target.value })} placeholder="外箱貼說明（選填，例：品名貼、條碼貼）" aria-label="外箱貼說明"
                  style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', marginTop: 6, fontSize: 13 }} />
              )}
            </div>

            {/* 8. 包材：內包裝（彩袋／空白真空袋＋尺寸 cm）＋貼紙（尺寸 mm、送印／自印、內容）；固定品項帶入後收起來 */}
            {(() => {
              const nm = formData.item_name.trim()
              const sp = itemSpecs[nm]
              const fixed = sp?.pack || null // 品項固定包材
              const pk = { ...EMPTY_PACK, ...(formData.pack || {}) }
              const collapsed = !!fixed && !packOpen && samePack(pk, fixed) // 跟固定包材一樣就收起來
              const seg = on => ({ flex: 1, padding: '8px 6px', borderRadius: 10, border: `1px solid ${on ? '#7c3aed' : '#ddd6fe'}`, background: on ? '#7c3aed' : '#fff', color: on ? '#fff' : '#6d28d9', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' })
              // 尺寸列：選單＋「新增／刪除尺寸」（展開後可輸入新尺寸、按 × 刪掉清單裡的尺寸）
              const sizeRow = (kind, label, unit, value, pick) => {
                const opts = allSizes[kind]
                const extra = value && !opts.includes(value) ? value : '' // 舊訂單用的尺寸已從清單刪掉時，仍顯示它
                return (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 3 }}>{label}（單位{unit}）</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={value} onChange={e => pick(e.target.value)} aria-label={label}
                        style={{ flex: 1, background: '#fff', border: value ? 'none' : '1px solid #f59e0b', borderRadius: 10, padding: '8px', fontFamily: 'inherit' }}>
                        <option value="">選擇尺寸</option>
                        {opts.map(s => <option key={s} value={s}>{s}</option>)}
                        {extra && <option value={extra}>{extra}（已從清單刪除）</option>}
                      </select>
                      <button type="button" onClick={() => { setAddingSize(addingSize === kind ? null : kind); setNewSize('') }} aria-expanded={addingSize === kind}
                        style={{ background: addingSize === kind ? '#ede9fe' : '#fff', border: '1px dashed #a78bfa', borderRadius: 10, padding: '0 10px', color: '#6d28d9', fontWeight: 700, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>＋ 新增／刪除尺寸</button>
                    </div>
                    {addingSize === kind && (
                      <div style={{ background: '#fff', border: '1px solid #ddd6fe', borderRadius: 10, padding: 8, marginTop: 6 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input autoFocus type="text" value={newSize} onChange={e => setNewSize(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSize(kind) } }}
                            placeholder={kind === 'bag' ? '新尺寸（cm），例：15×25' : '新尺寸（mm），例：100×150'} aria-label={`新的${label}`}
                            style={{ flex: 1, minWidth: 0, border: '1px solid #c4b5fd', background: '#fff', borderRadius: 8, padding: '6px 10px', fontFamily: 'inherit', fontSize: 14 }} />
                          <button type="button" onClick={() => addSize(kind)} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '0 12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>加入</button>
                          <button type="button" onClick={() => setAddingSize(null)} title="收起" style={{ color: '#94a3b8', border: 'none', background: 'none', cursor: 'pointer', padding: '0 4px' }}>✕</button>
                        </div>
                        <div style={{ fontSize: 12, color: '#7c3aed', margin: '8px 0 4px' }}>
                          {opts.length ? '清單裡的尺寸（按 × 刪除，已下的訂單不受影響）：' : '清單裡還沒有尺寸'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {opts.map(s => (
                            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 20, padding: '2px 4px 2px 10px', fontSize: 13, fontWeight: 700, color: '#5b21b6' }}>
                              {s}{unit}
                              <button type="button" onClick={() => deleteSize(kind, s)} aria-label={`刪除尺寸 ${s}`} title="從清單刪除"
                                style={{ border: 'none', background: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 4px' }}>×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              }
              // 💾 存成固定規格：清單沒有固定包材時，或這張單跟固定規格不一樣時才出現
              const k = boxKind(formData.box_type), per = Number(formData.items_per_box) || 0
              const diffs = fixed ? [
                (Number(sp.g) || 0) !== (Number(formData.weight_per_bag) || 0) && '每袋重量',
                ((sp.box || '') !== (formData.box_type || '') || (k && per > 0 && perBoxOf(sp, formData.box_type) !== per)) && '外箱／每箱袋數',
                !samePack(pk, fixed) && '包材',
              ].filter(Boolean) : []
              const saveRow = nm && (!fixed || diffs.length > 0) && (
                <div className="op-save-spec" style={{ borderTop: '1px dashed #c4b5fd', marginTop: 10, paddingTop: 8 }}>
                  <div style={{ fontSize: 12, color: '#6d28d9', lineHeight: 1.6, marginBottom: 6 }}>
                    {fixed
                      ? `這張單的${diffs.join('、')}跟固定規格不一樣。特殊需求不用存；以後都要這樣才按：`
                      : `「${nm}」是固定品項（不是客製品）的話，存起來，下次選它就自動帶入每袋重量、外箱、每箱袋數、包材：`}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="button" onClick={saveFixedSpec} style={{ background: '#fff', border: '1px solid #7c3aed', color: '#6d28d9', borderRadius: 10, padding: '6px 12px', fontWeight: 800, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>💾 {fixed ? '更新固定規格' : '存成固定規格'}</button>
                    {!savedItems.includes(nm) && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800, color: '#92400e', cursor: 'pointer' }}>
                        <input type="checkbox" checked={specOem} onChange={e => setSpecOem(e.target.checked)} aria-label="新品項是代工品" style={{ width: 15, height: 15 }} />🏭 代工品（不進生產排程、庫存）
                      </label>
                    )}
                  </div>
                </div>
              )
              if (collapsed) return (
                <div className="op-pack-fixed" style={{ background: '#f5f3ff', borderRadius: 16, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', marginBottom: 6 }}>
                    🛍 包材 <span style={{ fontWeight: 400, color: '#8b5cf6', fontSize: 12 }}>（「{nm}」的固定規格，已帶入）</span>
                  </div>
                  <div className="op-pack-sum" style={{ fontSize: 14, fontWeight: 800, color: '#5b21b6', background: '#fff', borderRadius: 10, padding: '8px 10px' }}>{packTxt(pk) || '不用內包裝、貼紙'}</div>
                  <button type="button" onClick={() => setPackOpen(true)} aria-expanded={false} style={{ marginTop: 8, background: 'none', border: 'none', color: '#7c3aed', fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>有特殊需求，展開調整 ▾</button>
                  {saveRow}
                </div>
              )
              return (
                <div style={{ background: '#f5f3ff', borderRadius: 16, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', marginBottom: 10 }}>
                    🛍 包材 <span style={{ fontWeight: 400, color: '#8b5cf6', fontSize: 12 }}>（倉管在「包材準備」依這裡備料勾選）</span>
                  </div>
                  {fixed && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: '#6d28d9', background: '#fff', borderRadius: 10, padding: '6px 10px', marginBottom: 8 }}>
                      <span>固定規格：{packTxt(fixed) || '不用內包裝、貼紙'}</span>
                      <button type="button" onClick={() => { setPack(Object.fromEntries(PACK_KEYS.map(key => [key, fixed[key] ?? (key === 'sticker' ? false : '')]))); setPackOpen(false) }}
                        style={{ background: 'none', border: 'none', color: '#7c3aed', fontWeight: 800, fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>↩ 用固定規格（收起）</button>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 3 }}>內包裝</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <button type="button" onClick={() => setPack({ inner: pk.inner === '原包裝' ? '' : '原包裝' })} style={seg(pk.inner === '原包裝')} aria-pressed={pk.inner === '原包裝'}>{INNER_LABEL.原包裝}</button>
                    <button type="button" onClick={() => setPack({ inner: pk.inner === '真空袋' ? '' : '真空袋' })} style={seg(pk.inner === '真空袋')} aria-pressed={pk.inner === '真空袋'}>{INNER_LABEL.真空袋}</button>
                  </div>
                  {pk.inner === '真空袋' && sizeRow('bag', '真空袋尺寸', 'cm', pk.bagSize, v => setPack({ bagSize: v }))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', padding: '7px 10px', borderRadius: 10, cursor: 'pointer', marginBottom: pk.sticker ? 8 : 0 }}>
                    <input type="checkbox" checked={!!pk.sticker} style={{ width: 15, height: 15 }}
                      onChange={e => setPack({ sticker: e.target.checked, stickerSize: e.target.checked && !pk.stickerSize ? defSticker() : pk.stickerSize })} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#b45309' }}>🏷 要貼紙（外銷成分貼、營業用標籤…）</span>
                  </label>
                  {pk.sticker && (
                    <>
                      {sizeRow('sticker', '貼紙尺寸', 'mm', pk.stickerSize, v => setPack({ stickerSize: v }))}
                      <div style={{ fontSize: 12, color: '#7c3aed', marginBottom: 3 }}>印製方式</div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        <button type="button" onClick={() => setPack({ stickerPrint: '送印' })} style={seg(pk.stickerPrint === '送印')} aria-pressed={pk.stickerPrint === '送印'}>送印</button>
                        <button type="button" onClick={() => setPack({ stickerPrint: '自印' })} style={seg(pk.stickerPrint === '自印')} aria-pressed={pk.stickerPrint === '自印'}>自印</button>
                      </div>
                      <input type="text" value={pk.stickerNote} onChange={e => setPack({ stickerNote: e.target.value })} placeholder="貼紙內容（例：英文成分貼、日文成分貼、營業用標籤）" aria-label="貼紙內容"
                        style={{ width: '100%', background: '#fff', border: 'none', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', fontSize: 13 }} />
                    </>
                  )}
                  {saveRow}
                </div>
              )
            })()}

            {/* 9. 日期：排程生產日、出貨日（不知道可以先空著）、付款日 → 交期、併櫃 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: '#059669', fontWeight: 700, marginBottom: 4 }}>排程生產日</div>
                <input type="date" name="scheduled_date" value={formData.scheduled_date} onChange={handleInputChange} aria-label="排程生產日" style={{ width: '100%', background: '#f0fdf4', border: 'none', borderRadius: 12, padding: '10px', fontFamily: 'inherit' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>{formIsPre ? '預計出貨日' : '出貨日'}<span style={{ fontWeight: 400, color: '#94a3b8', fontSize: 12 }}>（可先空著）</span></div>
                <input type="date" name="target_date" value={formData.target_date} onChange={handleInputChange} aria-label={formIsPre ? '預計出貨日' : '出貨日'} style={{ width: '100%', background: '#fef2f2', border: 'none', borderRadius: 12, padding: '10px', fontFamily: 'inherit' }} />
              </div>
            </div>
            {renderPay({ payDate: formData.payDate, leadDays: formData.leadDays, ship: formData.target_date }, patch => setFormData(p => ({ ...p, ...patch })))}
            {renderMerge({ ...EMPTY_MERGE, ...(formData.merge || {}) }, setMerge, formData.target_date, true)}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={closeForm} style={{ flex: 1, padding: '12px', background: '#f1f5f9', border: 'none', borderRadius: 14, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>取消</button>
              {!editingOrderId && formData.is_mixed_box ? (
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
