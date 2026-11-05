import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDT, loadPage, loadLogs, savePageData, addLog, AdjustLog } from '../lib/pageSave'
import { flavorLists, DEFAULT_PPB, DEFAULT_MAX_CAP, isoOf, parseIso, addDays, wdOf, mdOf, todayIso, toIso, WD } from '../lib/flavors'
import { orderAnomalies, shipDateOf } from './OrdersPage'

// ③ 生產排程（生產排程科）＝ Excel「3.生產排程表」＋「庫存量預估表」
// 每日庫存 ＝ 前一天庫存 − 每日預估銷售量（含節日加乘）− 當天已確定銷售量 ＋ 當天入庫量

const DAYS = 90 // 預估天數（Excel 約 86 天）
const SP = { '紅燒':'剝皮（共用根菜）','藥膳':'原味（同批）','珍菇':'新鮮（同日）','香羹':'黃金（相近）','猴菇':'泡菜（同日）','油飯':'素花（間隙）' }
const ITEM_VEG = { '黃金':'玉米','泡菜':'高麗菜','素花':'花椰菜','新鮮':'青江菜','酸白':'高麗菜','原味':'大白菜' }

// 備用值：只在銷售計畫／庫存狀況尚未存檔時使用
const DEFAULT_BI = {
  '黃金':{c:1941,mn:1716,mx:2770,d:83},'泡菜':{c:625,mn:638,mx:1281,d:38},
  '咖哩':{c:680,mn:347,mx:562,d:11}, '素花':{c:1754,mn:1194,mx:2016,d:60},
  '新鮮':{c:789,mn:571,mx:1382,d:41},'剝皮':{c:1299,mn:888,mx:1771,d:53},
  '酸白':{c:618,mn:424,mx:920,d:28}, '原味':{c:1585,mn:337,mx:1484,d:44},
  '綠蔬':{c:24,mn:337,mx:300,d:25},  '紅燒':{c:70,mn:100,mx:300,d:4},
  '藥膳':{c:31,mn:30,mx:200,d:1},    '香羹':{c:26,mn:100,mx:200,d:6},
  '珍菇':{c:50,mn:50,mx:200,d:2},    '猴菇':{c:69,mn:50,mx:200,d:1},
  '油飯':{c:60,mn:50,mx:150,d:3},
}
const INIT_RULES = [
  '素花3天內做完，越貴不貴。','根菜系列盡量一起做，確保500kg以上。',
  '備料不可超過3天（原油除外）。','叫菜單低於30件先提採購討論。',
  '每週五不入庫存，需要排程。','相同原料盡量同批生產。','淡旺季庫存與轉換次序都重要。',
]
const INIT_VEG = [
  {name:'青江菜',price:'',thresh:60},{name:'高麗菜',price:'',thresh:30},
  {name:'花椰菜',price:'',thresh:50},{name:'玉米',price:'',thresh:40},{name:'大白菜',price:'',thresh:25},
]

// 庫存長條（資料橫條）顏色：主產品沿用 Excel「庫存量預估表」的顏色；其他品項另外配色
const BAR_COLOR = {
  黃金: '#6DB333', 泡菜: '#ED7D31', 咖哩: '#FFC000', 素花: '#00B451',
  新鮮: '#FF9999', 剝皮: '#42CEC4', 酸白: '#EDE3B8', 原味: '#C8875A',
  綠蔬: '#A5D6A7', 紅燒: '#D7A98C', 藥膳: '#C5B3E6', 香羹: '#F7CD7E',
  珍菇: '#CDBBAA', 猴菇: '#B7C9D6', 油飯: '#9FCBEF',
}
const EXTRA_COLORS = ['#A7D8DE', '#F4B6C2', '#D9E8A0', '#C9C3F0', '#F6D3A8'] // 之後新增的口味輪流用
const TOTAL_BAR = '#FF6161' // 滿福合計（同 Excel）
// 長條長度同 Excel：最低庫存＝0%、庫存上限＝100%（庫存越少長條越短）
const levelOf = (v, mn, mx) => (mx > mn ? (v - mn) / (mx - mn) : (v >= mn ? 1 : 0))
const barStyle = (ratio, color) => {
  if (!(ratio > 0)) return undefined
  const p = Math.min(100, Math.round(ratio * 1000) / 10)
  return { backgroundImage: `linear-gradient(90deg, ${color} ${p}%, transparent ${p}%)`, backgroundSize: '100% 74%', backgroundPosition: '0 50%', backgroundRepeat: 'no-repeat' }
}
// 客訂管理的關卡名稱（顯示用）
const ORDER_STAGE = { pending: '等待排程', packaging: '包材準備', scheduled: '完成備貨', prepared: '確認出貨' }

let _uid = 0
const uid = () => `r${Date.now().toString(36)}${(_uid++).toString(36)}`
const withIds = rows => (rows || []).map(r => (r.id ? r : { ...r, id: uid() }))
// 扣除列（−）：直接填包數，在「日期」當天從庫存扣掉（例如包客訂）
const isOut = r => r.kind === 'out'
const sortRows = rows => [...rows].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (isOut(a) - isOut(b)))
const autoIn = r => r.inDate || addDays(r.date, 1) // 入庫日：沒填就是生產日隔天（同 Excel）

function makeDates(startIso, count) {
  const B0 = parseIso(startIso) || new Date()
  const out = []
  for (let i = 0; i < count; i++) {
    const d = new Date(B0.getFullYear(), B0.getMonth(), B0.getDate() + i)
    const m = d.getMonth() + 1, dy = d.getDate(), w = d.getDay()
    out.push({ iso: isoOf(d), lb: `${m}/${dy} 週${WD[w]}`, mo: m, we: w === 0 || w === 6 })
  }
  return out
}

// 狀態同 Excel：負數＝缺貨、低於最低庫存＝粉紅、最低～上限之間＝長條（越短越接近最低）、高於上限＝滿格
const stOf = (v, mn, mx) => v < 0 ? 'out' : (mn > 0 && v < mn) ? 'low' : (mx > 0 && v > mx) ? 'high' : 'ok'

// 排程的調整紀錄（生產列＝排程、扣除列＝扣除）
function diffSch(prev, cur) {
  const out = []
  const day = iso => (iso ? `${mdOf(iso)}（${wdOf(iso).slice(1)}）` : '未定日期')
  const d = r => isOut(r)
    ? `${day(r.date)} ${r.item} −${Number(r.qty) || 0}包${r.note ? `（${r.note}）` : ''}`
    : `${day(r.date)} ${r.item} ${r.barrels}桶`
  const kind = r => (isOut(r) ? '扣除' : '排程')
  const changed = (o, r) => isOut(r)
    ? o.date !== r.date || o.item !== r.item || Number(o.qty) !== Number(r.qty) || (o.note || '') !== (r.note || '')
    : o.date !== r.date || o.item !== r.item || Number(o.barrels) !== Number(r.barrels) || (o.inDate || '') !== (r.inDate || '')
  const pm = Object.fromEntries(prev.map(r => [r.id, r]))
  const cm = Object.fromEntries(cur.map(r => [r.id, r]))
  cur.forEach(r => {
    const o = pm[r.id]
    if (!r.item) { if (o?.item) out.push(`刪除${kind(o)} ${d(o)}`); return }
    if (!o || !o.item) { out.push(`新增${kind(r)} ${d(r)}`); return }
    if (changed(o, r))
      out.push(`修改${kind(r)} ${d(o)} → ${d(r)}${!isOut(r) && r.inDate ? `（入庫 ${mdOf(r.inDate)}）` : ''}`)
  })
  prev.forEach(o => { if (!cm[o.id] && o.item) out.push(`刪除${kind(o)} ${d(o)}`) })
  return out
}
const diffPpb = (p, c) => Object.keys({ ...p, ...c }).filter(f => Number(p[f]) !== Number(c[f])).map(f => `${f} 每桶產量 ${p[f] ?? '—'} → ${c[f]} 包`)

// ── 客訂換算：客訂的「袋數 × 每袋重量」→ 庫存包數 ──
// 1. 固定換算（先找指定口味、再找全部口味）：例 5250g 營業用 1 袋＝扣 6.5 包
// 2. 表上沒有的重量：每袋重量 ÷ 庫存 1 包重量（大包 800g）
const DEFAULT_CONV = { baseG: 800, rules: [{ f: '', g: 800, p: 1 }, { f: '', g: 400, p: 0.5 }, { f: '', g: 5250, p: 6.5 }] }
const withRuleIds = c => ({ baseG: c.baseG ?? 800, rules: (c.rules || []).map(r => ({ id: r.id || uid(), f: r.f || '', g: String(r.g ?? ''), p: String(r.p ?? '') })) })
const validRule = r => Number(r.g) > 0 && Number(r.p) > 0
const normConv = c => ({ baseG: Number(c.baseG) || 800, rules: c.rules.filter(validRule).map(r => ({ f: r.f || '', g: Number(r.g), p: Number(r.p) })) })
function diffConv(p, c) {
  const out = [], a = normConv(p), b = normConv(c)
  if (a.baseG !== b.baseG) out.push(`換算：庫存 1 包 ${a.baseG}g → ${b.baseG}g`)
  const key = r => `${r.f || '全部口味'} 每袋${r.g}g`
  const pm = Object.fromEntries(a.rules.map(r => [key(r), r.p]))
  const cm = Object.fromEntries(b.rules.map(r => [key(r), r.p]))
  Object.keys(cm).forEach(k => {
    if (!(k in pm)) out.push(`換算新增：${k} ＝ ${cm[k]} 包`)
    else if (pm[k] !== cm[k]) out.push(`換算修改：${k} ${pm[k]} → ${cm[k]} 包`)
  })
  Object.keys(pm).forEach(k => { if (!(k in cm)) out.push(`換算刪除：${k}（原 ${pm[k]} 包）`) })
  return out
}
const fmtN = n => Number(n || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
const cleanNum = v => String(v).replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') // 只留數字和一個小數點（打 -200 會變 200）

export default function SchedulePage() {
  const [schData, setSchData] = useState([])
  const [savedSch, setSavedSch] = useState([])
  const [ppb, setPpb] = useState(DEFAULT_PPB)
  const [savedPpb, setSavedPpb] = useState(DEFAULT_PPB)
  const [rules, setRules] = useState(INIT_RULES)
  const [ruleEdit, setRuleEdit] = useState(false)
  const [vegData, setVegData] = useState(INIT_VEG)
  const [extraRules, setExtraRules] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [bi, setBi] = useState(DEFAULT_BI)
  const [showSettings, setShowSettings] = useState(false)
  const [startDate, setStartDate] = useState(todayIso) // 只在庫存狀況沒有盤點日時使用
  const [gen, setGen] = useState({ from: '', to: '', sat: false })
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [lastSaved, setLastSaved] = useState(null)
  const [logs, setLogs] = useState([])
  const [linked, setLinked] = useState({ sales: null, inventory: null })
  const [showOrd, setShowOrd] = useState(true) // 客訂出貨清單展開／收合
  const [flash, setFlash] = useState(null) // 剛加入的扣除列，閃一下
  const [conv, setConv] = useState(() => withRuleIds(DEFAULT_CONV)) // 客訂換算規則
  const [savedConv, setSavedConv] = useState(() => withRuleIds(DEFAULT_CONV))
  const [showConv, setShowConv] = useState(false)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const today = todayIso()

  // 讀取：排程、產量設定、調整紀錄、銷售計畫、庫存狀況
  useEffect(() => {
    (async () => {
      const [s, i, y, lg, cv] = await Promise.all([loadPage('sales'), loadPage('inventory'), loadPage('yield'), loadLogs('schedule'), loadPage('convert')])
      setLinked({ sales: s.data?.data || null, inventory: i.data?.data || null })
      if (y.data?.data) { const p = { ...DEFAULT_PPB, ...y.data.data }; setPpb(p); setSavedPpb(p) }
      if (cv.data?.data) { const c = withRuleIds({ ...DEFAULT_CONV, ...cv.data.data }); setConv(c); setSavedConv(c) }
      setLogs(lg.data)
      const { data, error } = await supabase.from('adv_schedule_config').select('*').eq('id', 'default').maybeSingle()
      if (error) { setLoadError(error.message); return }
      if (data) {
        // 舊資料的入庫日如果剛好是生產日隔天，就視為「自動」
        const rows = withIds(data.sch_data).map(r => {
          if (isOut(r)) return { ...r, date: toIso(r.date) }
          const date = toIso(r.date), inDate = toIso(r.inDate)
          return { ...r, date, inDate: inDate && inDate !== addDays(date, 1) ? inDate : '' }
        })
        setSchData(rows); setSavedSch(rows)
        if (data.rules) setRules(data.rules)
        if (data.veg_data) setVegData(data.veg_data)
        if (data.extra_rules) setExtraRules(data.extra_rules)
        if (data.bi) setBi({ ...DEFAULT_BI, ...data.bi })
        if (data.start_date) setStartDate(toIso(data.start_date) || todayIso())
        if (data.updated_at) setLastSaved(data.updated_at)
      }
      setLoaded(true)
    })()
  }, [])

  // 客訂（列在生產排程表上方；按「− 扣庫存」才會扣）
  useEffect(() => {
    const fetchOrders = async () => {
      const { data } = await supabase.from('adv_orders').select('*').in('status', ['pending','packaging','scheduled','prepared'])
      if (data) setOrders(data)
    }
    fetchOrders()
    const ch = supabase.channel('sch_orders').on('postgres_changes', { event: '*', schema: 'public', table: 'adv_orders' }, () => fetchOrders()).subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  // ── 連動：品項主檔／每日預估／最低庫存＝銷售計畫；起始庫存／上限／盤點日＝庫存狀況 ──
  const L = useMemo(() => flavorLists(linked.sales?.saleData), [linked])
  const maxCap = Number(linked.inventory?.maxCap) || DEFAULT_MAX_CAP
  const eff = useMemo(() => {
    const s = linked.sales, inv = linked.inventory
    const sd = Object.fromEntries((s?.saleData || []).map(r => [r.f, r]))
    const mainSum = L.main.reduce((t, f) => t + (Number(sd[f]?.d) || 0), 0)
    const out = {}
    L.all.forEach(f => {
      const b = bi[f] || { c: 0, mn: 0, mx: 0, d: 0 }
      const d  = sd[f] ? (Number(sd[f].d) || 0) : b.d
      const mn = sd[f] ? (Number(sd[f].m) || 0) : b.mn
      const c  = inv?.inv && inv.inv[f] != null ? (Number(inv.inv[f]) || 0) : b.c
      let mx = b.mx
      if (inv) {
        if (L.main.includes(f)) {
          const manual = inv.mxMain?.[f]
          mx = manual !== '' && manual != null
            ? (Number(manual) || 0)
            : Math.round(maxCap * (mainSum ? d / mainSum : 0) * (1 + (Number(inv.bonus?.[f]) || 0) / 100))
        } else if (inv.mxSub?.[f] != null) mx = Number(inv.mxSub[f]) || 0
      }
      out[f] = { c, d, mn, mx }
    })
    return out
  }, [bi, linked, L, maxCap])

  const invDate = toIso(linked.inventory?.date)
  const effStart = invDate ? addDays(invDate, 1) : startDate // 從盤點日隔天開始（同 Excel）
  const staleDays = invDate ? Math.round((parseIso(today) - parseIso(invDate)) / 86400000) : null
  const DATES = useMemo(() => makeDates(effStart, DAYS), [effStart])

  // 節日／活動加乘：活動期間內，受影響口味的每日預估 × 倍率（重疊取最大）
  const multOf = useMemo(() => {
    const evs = (linked.sales?.events || []).filter(e => e.start && e.end && Number(e.mult) > 0)
    return (f, iso) => evs.reduce((m, e) =>
      (iso >= e.start && iso <= e.end && (!e.items?.length || e.items.includes(f))) ? Math.max(m, Number(e.mult)) : m, 1)
  }, [linked])

  // 已確定的銷售量（銷售計畫填）：出貨日當天另外扣
  const cf = useMemo(() => {
    const m = {}
    ;(linked.sales?.confirmed || []).forEach(c => {
      const q = Number(c.qty) || 0, iso = toIso(c.date)
      if (!iso || !c.f || q <= 0) return
      m[iso] = m[iso] || {}
      m[iso][c.f] = (m[iso][c.f] || 0) + q
    })
    return m
  }, [linked])

  // ── 庫存量預估 ──
  const plan = useMemo(() => {
    const im = {}, om = {}, prodDays = {}
    schData.forEach(r => {
      if (!r.item || !r.date) return
      if (isOut(r)) { // 扣除列：日期當天扣
        const q = Number(r.qty) || 0
        if (q > 0) { om[r.date] = om[r.date] || {}; om[r.date][r.item] = (om[r.date][r.item] || 0) + q }
        return
      }
      const ind = autoIn(r)
      const p = (Number(ppb[r.item]) || 0) * (Number(r.barrels) || 0)
      im[ind] = im[ind] || {}
      im[ind][r.item] = (im[ind][r.item] || 0) + p
      ;(prodDays[r.date] = prodDays[r.date] || []).push(`${r.item} ${r.barrels}桶`)
    })
    const res = {}
    L.all.forEach(f => {
      const b = eff[f]
      let run = b.c
      res[f] = DATES.map(d => {
        const add = im[d.iso]?.[f] || 0
        const cs = cf[d.iso]?.[f] || 0
        const ot = om[d.iso]?.[f] || 0
        run = run - b.d * multOf(f, d.iso) - cs - ot + add
        return { raw: run, v: Math.round(run) || 0, add, cs, ot } // || 0：避免顯示 -0
      })
    })
    const mainTotal = DATES.map((_, i) => L.main.reduce((s, f) => s + res[f][i].raw, 0))
    return { res, prodDays, mainTotal }
  }, [schData, ppb, L, eff, multOf, cf, DATES])

  const hasSch = useMemo(() => {
    const first = DATES[0]?.iso, last = DATES[DATES.length - 1]?.iso
    return new Set(schData.filter(r => !isOut(r) && r.item && r.date && autoIn(r) >= first && autoIn(r) <= last).map(r => r.item))
  }, [schData, DATES])

  // 每個口味的長條顏色（沒有預設色的新口味輪流配色）
  const colors = useMemo(() => {
    let k = 0
    return Object.fromEntries(L.all.map(f => [f, BAR_COLOR[f] || EXTRA_COLORS[k++ % EXTRA_COLORS.length]]))
  }, [L])

  // 客訂異常（逾期未出貨／即將到期還沒備貨／未填出貨日）：規則跟「客訂管理 → 異常狀態（生產部）」同一套
  const anomaly = useMemo(() => orderAnomalies(orders, today), [orders, today])

  // 客訂出貨清單（整合在生產排程表上方）：今天以後、還沒出貨的客訂，依出貨日排序
  // 已過出貨日、未填出貨日的屬於異常，到客訂管理的「異常狀態」處理
  // 客訂袋數 → 庫存包數
  const convOf = useMemo(() => {
    const base = Number(conv.baseG) || 800
    const rules = conv.rules.filter(validRule)
    return (o, f) => {
      const bags = Number(o.quantity) || 0
      const g = Number(o.weight_per_bag) || 5250 // 跟客訂管理一樣：沒填就是 5250g
      const hit = rules.find(r => r.f && r.f === f && Number(r.g) === g) || rules.find(r => !r.f && Number(r.g) === g)
      const per = hit ? Number(hit.p) : g / base
      return { bags, g, per, packs: Math.round(bags * per * 100) / 100, how: hit ? `固定換算：每袋 ${g}g＝${fmtN(per)} 包` : `自動換算：${g}g ÷ ${base}g＝${fmtN(per)} 包` }
    }
  }, [conv])

  const orderList = useMemo(() => {
    const soonIds = new Set(anomaly.soon.map(o => o.id))
    const used = {} // 已經扣過庫存的客訂 → 對應的扣除列
    schData.forEach(r => { if (isOut(r) && r.orderId) used[r.orderId] = r })
    return orders
      .map(o => ({ o, td: shipDateOf(o) }))
      .filter(x => x.td && x.td >= today)
      .sort((a, b) => a.td.localeCompare(b.td))
      .map(({ o, td }) => {
        const name = o.item_name || o.itemName || ''
        const f = L.all.find(x => name.includes(x)) || ''
        return { o, td, name, f, cv: convOf(o, f), warn: soonIds.has(o.id), row: used[o.id] || null }
      })
  }, [orders, anomaly, schData, today, L, convOf])
  const ordPending = orderList.filter(x => !x.row).length
  const todayShip = orders.filter(o => toIso(o.target_date || o.targetDate) === today)

  // 客訂 → 加一列扣除（日期＝出貨日、包數＝換算後的包數，都可以再改）
  const deductOrder = x => {
    if (x.row) return
    const cust = x.o.customer_name || x.o.customerName || ''
    const r = { id: uid(), kind: 'out', date: x.td, item: x.f, qty: String(x.cv.packs), note: `${cust} ${x.cv.bags}袋×${x.cv.g}g`, orderId: x.o.id, barrels: 0 }
    setSchData(rows => sortRows([...rows, r]))
    setFlash(r.id); setTimeout(() => setFlash(f => (f === r.id ? null : f)), 1800)
    showToast(`已加入扣除：${mdOf(r.date)} ${r.item || '（請選口味）'} −${fmtN(x.cv.packs)} 包（${x.cv.bags}袋×${x.cv.g}g），記得存檔`)
  }
  // 換算規則編輯
  const updRule = (id, k, v) => setConv(c => ({ ...c, rules: c.rules.map(r => (r.id === id ? { ...r, [k]: k === 'f' ? v : cleanNum(v) } : r)) }))
  const addOut = () => {
    const r = { id: uid(), kind: 'out', date: today, item: '', qty: '', note: '', barrels: 0 } // barrels: 0 → 其他程式讀到也不會當成生產
    setSchData(d => [...d, r])
    setFlash(r.id); setTimeout(() => setFlash(f => (f === r.id ? null : f)), 1800)
  }

  // ── 排程輸入 ──
  const updateSch = (id, k, v) => setSchData(rows => rows.map(r => r.id === id ? { ...r, [k]: v } : r))
  const generate = () => {
    const from = parseIso(gen.from), to = parseIso(gen.to)
    if (!from || !to || to < from) { showToast('請選開始與結束日期'); return }
    const have = new Set(schData.filter(r => !isOut(r)).map(r => r.date))
    const add = []
    for (let d = new Date(from), n = 0; d <= to && n < 120; d.setDate(d.getDate() + 1), n++) {
      const w = d.getDay(), iso = isoOf(d)
      if (w === 0 || (w === 6 && !gen.sat) || have.has(iso)) continue
      add.push({ id: uid(), date: iso, item: '', barrels: 4, inDate: '' })
    }
    setSchData(rows => sortRows([...rows, ...add]))
    showToast(add.length ? `已產生 ${add.length} 列，請選口味與桶數` : '這段日期都已經有排程了')
  }
  const blankCount = schData.filter(r => !r.item).length
  const tot = schData.reduce((s, r) => s + (r.item && !isOut(r) ? (Number(ppb[r.item]) || 0) * (Number(r.barrels) || 0) : 0), 0)
  const outTot = schData.reduce((s, r) => s + (r.item && isOut(r) ? Number(r.qty) || 0 : 0), 0)

  // ── 存檔 ──
  const schChanges = useMemo(() => diffSch(savedSch, schData), [savedSch, schData])
  const ppbChanges = useMemo(() => diffPpb(savedPpb, ppb), [savedPpb, ppb])
  const convChanges = useMemo(() => diffConv(savedConv, conv), [savedConv, conv])
  const dirty = loaded && (schChanges.length > 0 || ppbChanges.length > 0 || convChanges.length > 0)
  const save = async () => {
    if (!loaded) { alert(loadError ? '排程資料讀取失敗，無法存檔：' + loadError : '排程資料載入中，請稍候再存檔'); return }
    const sorted = sortRows(schData)
    const now = new Date().toISOString()
    setSaving(true)
    const { error } = await supabase.from('adv_schedule_config').upsert({
      id: 'default', sch_data: sorted, rules, veg_data: vegData, extra_rules: extraRules, bi, start_date: startDate, updated_at: now,
    })
    if (error) { setSaving(false); alert('儲存失敗：' + error.message); return }
    if (ppbChanges.length) {
      const r = await savePageData('yield', ppb)
      if (r.error) { setSaving(false); alert('產量設定儲存失敗：' + r.error.message); return }
    }
    if (convChanges.length) {
      const r = await savePageData('convert', normConv(conv))
      if (r.error) { setSaving(false); alert('換算規則儲存失敗：' + r.error.message); return }
    }
    const ch = [...diffSch(savedSch, sorted), ...ppbChanges, ...convChanges]
    if (ch.length) await addLog('schedule', ch)
    setSaving(false)
    const cleanConv = withRuleIds(normConv(conv)) // 存檔後拿掉沒填完整的換算列
    setSchData(sorted); setSavedSch(sorted); setSavedPpb(ppb); setConv(cleanConv); setSavedConv(cleanConv); setLastSaved(now)
    if (ch.length) setLogs(l => [{ id: 'new-' + now, created_at: now, changes: ch }, ...l].slice(0, 50))
    showToast('排程已儲存 ✅')
  }

  // ── AI 排程建議 ──
  const runAI = () => {
    setAiLoading(true); setAiText('')
    setTimeout(() => {
      const data = plan.res
      const highVeg = vegData.filter(v => parseFloat(v.price) > v.thresh && v.name)
      const priceWarn = new Set()
      highVeg.forEach(v => { Object.entries(ITEM_VEG).forEach(([item, veg]) => { if (veg === v.name) priceWarn.add(item) }) })
      const az = f => {
        const b = eff[f]; if (!b || !data[f]) return { has: false }
        let fw = -1, fr = -1
        data[f].forEach(({ v }, di) => { if (v < 0 || v < b.mn * 0.3) { if (fr < 0) fr = di } else if (v < b.mn && fw < 0) fw = di })
        const di = fr >= 0 ? fr : fw, urg = fr >= 0, pbt = Number(ppb[f]) || 240
        const ref = di >= 3 ? data[f][di - 3].v : b.c
        const need = Math.max(1, Math.ceil((b.mn * 1.3 - ref) / pbt))
        return { f, di, urg, need, pbt, pd: Math.max(0, di - 3), has: di >= 0 }
      }
      const mi = L.main.map(az).filter(x => x.has).sort((a, b) => (b.urg ? 1 : 0) - (a.urg ? 1 : 0) || (a.di - b.di))
      const si = L.sub.map(az).filter(x => x.has).sort((a, b) => (b.urg ? 1 : 0) - (a.urg ? 1 : 0) || (a.di - b.di))
      const sok = L.sub.filter(f => !si.find(x => x.f === f))
      let txt = ''
      if (highVeg.length > 0) { txt += '【菜價警示】\n'; highVeg.forEach(v => { const aff = Object.entries(ITEM_VEG).filter(([, veg]) => veg === v.name).map(([i]) => i); txt += `• ${v.name} 本週 ${v.price} 元/kg（標準 ${v.thresh} 元），相關品項：${aff.join('、') || '無'}。建議評估是否延後。\n` }); txt += '\n' }
      if (extraRules) { txt += `【補充規則】\n${extraRules}\n\n` }
      txt += '【主產品建議（水餃・餡餅・湯包）】\n'
      if (mi.length === 0) { txt += `✓ ${DAYS}天內主產品庫存都在最低庫存以上\n` }
      else { mi.forEach(({ f, di, urg, need, pbt, pd }) => { const wd = DATES[di]?.lb || '—', sd = DATES[pd]?.lb || '—'; txt += `• ${urg ? '[緊急]' : '[偏低]'} ${f}：建議 ${sd} 前排 ${need} 桶（+${(need * pbt).toLocaleString()}包）\n  ${wd} 起庫存${urg ? '緊急不足' : '低於最低庫存'}。起始 ${Math.round(eff[f].c).toLocaleString()} 包，每日預估 ${Math.round(eff[f].d * 10) / 10} 包，最低 ${Math.round(eff[f].mn).toLocaleString()} 包。${priceWarn.has(f) ? '⚠ 菜價偏高，請確認成本。' : ''}\n` }) }
      txt += '\n【其他品項建議（搭配主產品同日排入）】\n'
      if (si.length === 0) { txt += '✓ 其他品項庫存充足\n' }
      else { si.forEach(({ f, di, urg, need, pd }) => { const wd = DATES[di]?.lb || '—', sd = DATES[pd]?.lb || '—'; txt += `• ${urg ? '[緊急]' : '[偏低]'} ${f}：建議 ${sd} 前搭配 ${SP[f] || '主產品'}，排 ${need} 桶。\n  ${wd} 起庫存${urg ? '不足' : '偏低'}，起始 ${Math.round(eff[f].c).toLocaleString()} 包。\n` }) }
      if (sok.length > 0) txt += `✓ 充足：${sok.join('、')} 可彈性安排。\n`
      txt += '\n【原料群組建議】\n• 紅燒＋剝皮：共用根菜類原料，建議同批次節省換料\n• 素花系列：間隔不超過3天，越貴不貴\n• 副產品原則：主產品桶數少（1-2桶）時同日排入，不佔整天'
      setAiText(txt); setAiLoading(false)
    }, 600)
  }

  // Google 日曆匯出連結
  const makeGoogleCalLink = r => {
    const s = parseIso(r.date); if (!s || !r.item) return null
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1)
    const fmt = x => isoOf(x).replace(/-/g, '')
    const pk = (Number(ppb[r.item]) || 0) * (Number(r.barrels) || 0)
    const title = encodeURIComponent(`生產排程：${r.item} ${r.barrels}桶（入庫 ${mdOf(autoIn(r))}）`)
    return `https://calendar.google.com/calendar/r/eventedit?text=${title}&dates=${fmt(s)}/${fmt(e)}&details=${encodeURIComponent(`品項：${r.item}\n桶數：${r.barrels}\n包數：${pk}包\n入庫日：${mdOf(autoIn(r))}`)}`
  }

  // 預估期間內：哪個口味從哪天開始缺貨／低於最低庫存
  const alerts = useMemo(() => {
    const out = [], low = []
    L.all.forEach(f => {
      const arr = plan.res[f]
      const io = arr.findIndex(c => c.v < 0)
      if (io >= 0) { out.push({ f, d: DATES[io].iso }); return }
      const il = arr.findIndex(c => eff[f].mn > 0 && c.v < eff[f].mn)
      if (il >= 0) low.push({ f, d: DATES[il].iso })
    })
    const byDate = (a, b) => a.d.localeCompare(b.d)
    return { out: out.sort(byDate), low: low.sort(byDate) }
  }, [plan, L, eff, DATES])

  return (
    <div>
      <style>{`
        .ps-layout { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
        .ps-layout > * { min-width: 0; margin-bottom: 0 !important; }
        @media (min-width: 1400px) { .ps-layout { grid-template-columns: minmax(600px, 40%) 1fr; } .pf-scroll { max-height: calc(100vh - 260px) !important; } }
        .ps-gen { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; font-size: 13px; color: #475569; }
        .ps-tbl td { padding: 6px 6px !important; }
        .ps-out td { background: #fff5f5; }
        .ps-blank td { background: #fffbeb; }
        .ps-outchip { display: inline-block; font-size: 12px; font-weight: 800; color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; border-radius: 6px; padding: 1px 8px; white-space: nowrap; }
        .ps-flash td { animation: psflash 1.8s ease-out; }
        @keyframes psflash { 0%, 35% { background: #fde68a; } 100% { background: #fff5f5; } }
        .ps-addbtn { flex: 1; min-width: 130px; font-size: 13px; border-radius: 7px; padding: 6px 0; cursor: pointer; font-family: inherit; }
        .ps-ord { border: 1px solid #fde68a; background: #fffbeb; border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
        .ps-ord-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; background: none; border: none; padding: 8px 10px; cursor: pointer; font-family: inherit; font-size: 14px; color: #78350f; text-align: left; }
        .ps-ord-list { max-height: 232px; overflow: auto; border-top: 1px solid #fde68a; background: #fff; }
        .ps-ord-row { display: grid; grid-template-columns: 82px minmax(0, 1fr) 40px 112px 62px minmax(96px, auto); align-items: center; gap: 6px; padding: 5px 10px; font-size: 13px; border-bottom: 1px dashed #fde68a; }
        .ps-ord-row .d { color: #475569; font-weight: 700; white-space: nowrap; }
        .ps-ord-row .c { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1e293b; }
        .ps-ord-row .f { font-weight: 800; color: #334155; }
        .ps-ord-row .q { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25; white-space: nowrap; cursor: help; }
        .ps-ord-row .q1 { font-size: 11px; color: #64748b; }
        .ps-ord-row .q2 { font-size: 13px; font-weight: 800; color: #1e293b; }
        .ps-ord-row .s { font-size: 11px; color: #64748b; background: #f1f5f9; border-radius: 10px; padding: 1px 4px; text-align: center; white-space: nowrap; }
        .ps-ord-row.warn .d, .ps-ord-row.warn .c { color: #be123c; font-weight: 800; }
        .ps-ord-btn { justify-self: end; font-size: 13px; font-weight: 800; color: #fff; background: #dc2626; border: none; border-radius: 7px; padding: 4px 9px; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .ps-ord-done { justify-self: end; font-size: 12px; color: #047857; font-weight: 700; white-space: nowrap; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .ps-ord-done.off { color: #b45309; }
        .ps-ord-fix { font-size: 11px; font-weight: 700; color: #fff; background: #f59e0b; border: none; border-radius: 6px; padding: 2px 7px; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .ps-conv-bar { border-top: 1px solid #fde68a; padding: 3px 10px; }
        .ps-conv-bar button { background: none; border: none; color: #92400e; font-size: 12px; font-weight: 700; cursor: pointer; padding: 3px 0; font-family: inherit; }
        .ps-conv { border-top: 1px dashed #fde68a; padding: 8px 10px 10px; font-size: 12px; color: #475569; background: #fffdf5; line-height: 1.6; }
        .ps-conv-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 4px; font-size: 13px; }
        .ps-ord-tip { font-size: 12px; color: #92400e; padding: 6px 10px 8px; line-height: 1.6; border-top: 1px solid #fde68a; }
        @media (max-width: 560px) {
          .ps-ord-row { grid-template-columns: minmax(0, 1fr) 40px 112px; grid-template-areas: "d f q" "c c a"; row-gap: 2px; }
          .ps-ord-row .d { grid-area: d; } .ps-ord-row .f { grid-area: f; } .ps-ord-row .q { grid-area: q; }
          .ps-ord-row .c { grid-area: c; } .ps-ord-row .s { display: none; }
          .ps-ord-row .ps-ord-btn, .ps-ord-row .ps-ord-done { grid-area: a; }
          .ps-conv-row select { width: 86px !important; }
          .ps-conv-row input { width: 56px !important; }
        }
        .pf-scroll { overflow: auto; max-height: 560px; border: 1px solid #e2e8f0; border-radius: 8px; }
        .pf { border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 100%; }
        .pf th { position: sticky; top: 0; z-index: 2; background: #f8fafc; color: #334155; font-weight: 800; font-size: 13px; padding: 6px 6px; border-bottom: 2px solid #cbd5e1; white-space: nowrap; text-align: right; }
        .pf td { border-bottom: 1px solid #f1f5f9; padding: 3px 6px; text-align: right; white-space: nowrap; vertical-align: middle; }
        .pf .pf-date { position: sticky; left: 0; z-index: 1; background: #fff; text-align: left; color: #475569; min-width: 104px; border-right: 1px solid #e2e8f0; font-weight: 600; }
        .pf th.pf-date { z-index: 3; background: #f8fafc; }
        .pf .pf-total { background: #f8fafc; font-weight: 800; color: #1e293b; border-right: 2px solid #cbd5e1; }
        .pf th.pf-total { background: #eef2f7; }
        .pf .pf-sep { border-left: 2px solid #94a3b8; }
        .pf .pf-c { min-width: 64px; }
        .pf .pf-n { font-weight: 700; font-size: 13px; line-height: 1.2; }
        .pf .pf-x { font-size: 10px; line-height: 1.1; }
        .pf-plus { color: #047857; font-weight: 800; }
        .pf-minus { color: #b91c1c; font-weight: 800; margin-left: 3px; }
        .pf td.pf-out { background: #f87171; color: #450a0a; }
        .pf td.pf-out .pf-n { font-weight: 900; }
        .pf td.pf-low { background: #ffc7ce; color: #9c0006; }
        .pf td.pf-high, .pf td.pf-ok { color: #1e293b; }
        .pf td.pf-in { box-shadow: inset 0 0 0 2px #059669; }
        .pf tr.pf-we .pf-date { color: #94a3b8; }
        .pf tr.pf-month td { border-top: 2px solid #94a3b8; }
        .pf tr.pf-today td { border-top: 2px solid #2563eb; border-bottom: 2px solid #2563eb; }
        .pf tr.pf-today .pf-date { color: #1d4ed8; font-weight: 800; }
        .pf tbody tr:hover td { filter: brightness(0.96); }
        .pf-chip { margin-left: 4px; font-size: 10px; border-radius: 4px; padding: 0 4px; font-weight: 700; }
        .pf-tag { margin-left: 3px; font-size: 9px; background: #1e293b; color: #fff; border-radius: 3px; padding: 0 3px; vertical-align: middle; }
        .pf td.pf-over { color: #9c0006; font-weight: 900; }
        .pf-lg { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #475569; margin-right: 10px; }
        .pf-lg i { display: inline-block; width: 14px; height: 12px; border-radius: 3px; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 80, left: 0, right: 0, zIndex: 100, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ background: '#059669', color: '#fff', padding: '10px 24px', borderRadius: 50, fontWeight: 700, fontSize: 14 }}>{toast}</div>
        </div>
      )}

      {loadError && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#7c2d12' }}>
          <strong>排程資料讀取失敗，暫時不能存檔：</strong>{loadError}
        </div>
      )}
      {staleDays !== null && staleDays > 7 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#9a3412' }}>
          ⚠ 庫存狀況的盤點日期是 <strong>{mdOf(invDate)}</strong>（{staleDays} 天前），預估從那天開始算。請成品倉庫管理科重新盤點後存檔，預估才會準。
        </div>
      )}
      {anomaly.total > 0 && (
        <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#881337' }}>
          <strong>⚠ 客訂有 {anomaly.total} 筆異常</strong>
          （{[
            anomaly.late.length > 0 && `逾期未出貨 ${anomaly.late.length}`,
            anomaly.soon.length > 0 && `即將到期還沒備貨 ${anomaly.soon.length}`,
            anomaly.noDate.length > 0 && `未填出貨日 ${anomaly.noDate.length}`,
          ].filter(Boolean).join('、')}），請到「客訂管理 → 異常狀態（生產部）」查看處理。
        </div>
      )}
      {todayShip.length > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#065f46' }}>
          <strong>📦 今日出貨：</strong> {todayShip.map(o => `${o.customer_name || o.customerName} ${o.item_name || o.itemName} ×${o.quantity}袋`).join(' · ')}
        </div>
      )}

      <div className="ps-layout">
        {/* ── 左：生產排程表（輸入） ── */}
        <div className="card">
          <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>生產排程表 <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 400 }}>生產排程科填寫</span></span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>上次存檔：{lastSaved ? <strong style={{ color: '#1e293b' }}>{fmtDT(lastSaved)}</strong> : '尚未存檔'}</span>
              {dirty && <span style={{ fontSize: 13, color: '#c2410c', fontWeight: 700 }}>● 有未存檔的修改</span>}
              <button onClick={save} disabled={saving}
                style={{ fontSize: 14, background: saving ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: saving ? 'default' : 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
                {saving ? '存檔中...' : '💾 存檔'}
              </button>
            </div>
          </div>

          {/* 客訂出貨（從客訂管理帶入）：按「− 扣庫存」就在排程表加一列扣除 */}
          <div className="ps-ord">
            <button className="ps-ord-h" onClick={() => setShowOrd(v => !v)} aria-expanded={showOrd}>
              <strong>📦 客訂出貨</strong>
              <span style={{ fontSize: 13 }}>
                {orderList.length === 0 ? '目前沒有待出貨的客訂' : `${orderList.length} 筆${ordPending > 0 ? `，${ordPending} 筆還沒扣庫存` : '，都已扣庫存'}`}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 12 }}>{showOrd ? '收合 ▲' : '展開 ▼'}</span>
            </button>
            {showOrd && orderList.length > 0 && (
              <>
                <div className="ps-ord-list">
                  {orderList.map(x => {
                    const cust = x.o.customer_name || x.o.customerName || '未知客戶'
                    const done = x.row ? Number(x.row.qty) || 0 : 0
                    const off = x.row && Math.abs(done - x.cv.packs) > 0.005 // 已扣的包數跟換算不同
                    return (
                      <div key={x.o.id} className={`ps-ord-row${x.warn ? ' warn' : ''}`} title={x.warn ? '快到出貨日，還沒完成備貨' : `${cust}｜${x.name}`}>
                        <span className="d">{mdOf(x.td)}（{wdOf(x.td).slice(1)}）</span>
                        <span className="c">{x.warn ? '⚠ ' : ''}{cust}</span>
                        <span className="f">{x.f || '—'}</span>
                        <span className="q" title={x.cv.how}>
                          <span className="q1">{fmtN(x.cv.bags)}袋 × {x.cv.g}g</span>
                          <span className="q2">＝ {fmtN(x.cv.packs)} 包</span>
                        </span>
                        <span className="s">{ORDER_STAGE[x.o.status] || ''}</span>
                        {x.row
                          ? (
                            <span className={`ps-ord-done${off ? ' off' : ''}`}>
                              ✓ 已扣 −{fmtN(done)} 包{x.row.date !== x.td ? `（${mdOf(x.row.date)}）` : ''}
                              {off && (
                                <button className="ps-ord-fix" onClick={() => updateSch(x.row.id, 'qty', String(x.cv.packs))} title={x.cv.how}>
                                  換算是 {fmtN(x.cv.packs)} 包，改成這個
                                </button>
                              )}
                            </span>
                          )
                          : <button className="ps-ord-btn" onClick={() => deductOrder(x)} title={x.cv.how}>− 扣 {fmtN(x.cv.packs)} 包</button>}
                      </div>
                    )
                  })}
                </div>
                <div className="ps-ord-tip">
                  按「− 扣 N 包」會在下面排程表加一列扣除（日期＝出貨日、包數＝袋數換算成庫存包數，都可以再改），存檔後預估表當天就會扣掉。
                  已過出貨日、未填出貨日的客訂請到「客訂管理 → 異常狀態」處理。
                </div>
              </>
            )}
            {showOrd && (
              <div className="ps-conv-bar">
                <button onClick={() => setShowConv(v => !v)} aria-expanded={showConv}>
                  ⚙ 袋 → 包 換算規則（1 包＝{Number(conv.baseG) || 800}g）{showConv ? ' ▲' : ' ▼'}
                </button>
              </div>
            )}
            {showOrd && showConv && (
              <div className="ps-conv">
                <div style={{ marginBottom: 6 }}>
                  扣除包數 ＝ 客訂袋數 × 每袋換算包數。每袋重量看客訂管理的「每袋重量(g)」。
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <strong>庫存 1 包 ＝</strong>
                  <input className="inp" type="text" inputMode="numeric" value={conv.baseG} onChange={e => setConv(c => ({ ...c, baseG: cleanNum(e.target.value) }))}
                    style={{ width: 70, fontSize: 13, textAlign: 'right' }} aria-label="庫存一包重量" /> g（大包）
                </div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>固定換算（有設定的重量優先用這裡；指定口味的又比「全部口味」優先）</div>
                {conv.rules.map(r => (
                  <div key={r.id} className="ps-conv-row">
                    <select className="inp" value={r.f} onChange={e => updRule(r.id, 'f', e.target.value)} style={{ width: 104, fontSize: 13 }} aria-label="換算適用口味">
                      <option value="">全部口味</option>
                      {L.all.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <span>每袋</span>
                    <input className="inp" type="text" inputMode="numeric" value={r.g} onChange={e => updRule(r.id, 'g', e.target.value)} style={{ width: 70, fontSize: 13, textAlign: 'right' }} aria-label="每袋重量" />
                    <span>g ＝ 扣</span>
                    <input className="inp" type="text" inputMode="decimal" value={r.p} onChange={e => updRule(r.id, 'p', e.target.value)} style={{ width: 62, fontSize: 13, textAlign: 'right' }} aria-label="換算包數" />
                    <span>包</span>
                    <button onClick={() => setConv(c => ({ ...c, rules: c.rules.filter(x => x.id !== r.id) }))} title="刪除這條"
                      style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}>×</button>
                  </div>
                ))}
                <button onClick={() => setConv(c => ({ ...c, rules: [...c.rules, { id: uid(), f: '', g: '', p: '' }] }))}
                  style={{ fontSize: 13, color: '#92400e', background: 'none', border: '1px dashed #fcd34d', borderRadius: 7, padding: '4px 12px', cursor: 'pointer', marginTop: 2 }}>＋ 新增規格</button>
                <div style={{ marginTop: 8, color: '#92400e' }}>
                  表上沒有的重量自動換算：每袋重量 ÷ {Number(conv.baseG) || 800}g（例：300g＝{fmtN(300 / (Number(conv.baseG) || 800))} 包、600g＝{fmtN(600 / (Number(conv.baseG) || 800))} 包）。
                  植物肉這類 1 包不是 {Number(conv.baseG) || 800}g 的，選該口味另外設定（例：植物肉 每袋 600g＝扣 1 包）。修改後按上方 💾 存檔。
                </div>
              </div>
            )}
          </div>

          {/* 批次產生 */}
          <div className="ps-gen">
            <strong style={{ color: '#334155' }}>批次產生</strong>
            <input type="date" className="inp" value={gen.from} onChange={e => setGen(g => ({ ...g, from: e.target.value, to: g.to && g.to >= e.target.value ? g.to : e.target.value }))} style={{ width: 145, fontSize: 13 }} aria-label="批次開始日" />
            <span>～</span>
            <input type="date" className="inp" value={gen.to} min={gen.from || undefined} onChange={e => setGen(g => ({ ...g, to: e.target.value }))} style={{ width: 145, fontSize: 13 }} aria-label="批次結束日" />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={gen.sat} onChange={e => setGen(g => ({ ...g, sat: e.target.checked }))} /> 週六上班
            </label>
            <button className="btn btn-dark btn-sm" onClick={generate} style={{ fontSize: 13 }}>產生排程列</button>
            <span style={{ fontSize: 12, color: '#94a3b8', width: '100%' }}>週日不排；已經有排程的日期會略過。產生後只要選口味、調桶數。</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="tbl ps-tbl" style={{ fontSize: 14 }}>
              <thead><tr>
                <th>日期</th>
                <th>品項</th>
                <th style={{ textAlign: 'center' }}>桶數</th>
                <th style={{ textAlign: 'right' }}>包數</th>
                <th>入庫日期／說明</th>
                <th style={{ width: 28 }}></th>
                <th style={{ width: 24 }}></th>
              </tr></thead>
              <tbody>
                {schData.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: '#94a3b8', padding: 18 }}>還沒有排程。用上面的「批次產生」或下面的「＋ 新增生產」開始；要扣庫存（例如包客訂）按「− 新增扣除」。</td></tr>
                )}
                {schData.map(r => {
                  const isSub = r.item && !L.main.includes(r.item)
                  const itemSelect = (
                    <select className="inp" value={r.item} onChange={e => updateSch(r.id, 'item', e.target.value)}
                      style={{ width: 92, fontSize: 13, borderColor: r.item ? undefined : '#f59e0b', background: isSub ? '#f5f3ff' : undefined }} aria-label="品項">
                      <option value="">選擇口味</option>
                      <optgroup label="主產品">{L.main.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
                      <optgroup label="其他品項">{L.sub.map(f => <option key={f} value={f}>{f}</option>)}</optgroup>
                    </select>
                  )
                  const delBtn = (
                    <button onClick={() => setSchData(d => d.filter(x => x.id !== r.id))} title="刪除這列"
                      style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>×</button>
                  )
                  // ── 扣除列（−）：直接填包數，日期當天從庫存扣掉 ──
                  if (isOut(r)) return (
                    <tr key={r.id} className={`ps-out${r.item ? '' : ' ps-blank'}${flash === r.id ? ' ps-flash' : ''}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input type="date" className="inp" value={r.date || ''} onChange={e => updateSch(r.id, 'date', e.target.value)} style={{ width: 140, fontSize: 13 }} aria-label="扣除日期" />
                        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>{wdOf(r.date)}</span>
                      </td>
                      <td>{itemSelect}</td>
                      <td style={{ textAlign: 'center' }}><span className="ps-outchip">− 扣除</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#b91c1c', fontWeight: 900, marginRight: 2 }}>−</span>
                        <input type="text" inputMode="decimal" className="inp" value={r.qty ?? ''} placeholder="包數"
                          onChange={e => updateSch(r.id, 'qty', cleanNum(e.target.value))}
                          style={{ width: 74, fontSize: 13, textAlign: 'right', color: '#b91c1c', fontWeight: 700 }} aria-label="扣除包數" />
                      </td>
                      <td>
                        <input className="inp" value={r.note || ''} onChange={e => updateSch(r.id, 'note', e.target.value)} placeholder="客戶／原因（例：包客訂）"
                          style={{ width: 170, fontSize: 13 }} aria-label="扣除說明" />
                      </td>
                      <td>{r.orderId && <span title="由客訂出貨帶入" style={{ fontSize: 13, opacity: 0.6 }}>🔗</span>}</td>
                      <td>{delBtn}</td>
                    </tr>
                  )
                  const pk = r.item ? (Number(ppb[r.item]) || 0) * (Number(r.barrels) || 0) : 0
                  const gcLink = makeGoogleCalLink(r)
                  const inAuto = !r.inDate
                  return (
                    <tr key={r.id} className={r.item ? '' : 'ps-blank'}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input type="date" className="inp" value={r.date || ''} onChange={e => updateSch(r.id, 'date', e.target.value)} style={{ width: 140, fontSize: 13 }} aria-label="生產日期" />
                        <span style={{ fontSize: 12, color: r.date && [0, 6].includes(parseIso(r.date)?.getDay()) ? '#c2410c' : '#94a3b8', marginLeft: 4 }}>{wdOf(r.date)}</span>
                      </td>
                      <td>{itemSelect}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                          <button onClick={() => updateSch(r.id, 'barrels', Math.max(1, (Number(r.barrels) || 1) - 1))}
                            style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', lineHeight: 1 }} aria-label="減一桶">−</button>
                          <span style={{ fontSize: 15, fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{r.barrels}</span>
                          <button onClick={() => updateSch(r.id, 'barrels', (Number(r.barrels) || 0) + 1)}
                            style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', lineHeight: 1 }} aria-label="加一桶">＋</button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{pk > 0 ? pk.toLocaleString() : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input type="date" className="inp" value={r.date ? autoIn(r) : ''} onChange={e => updateSch(r.id, 'inDate', e.target.value === addDays(r.date, 1) ? '' : e.target.value)}
                          style={{ width: 140, fontSize: 13, color: inAuto ? '#64748b' : '#c2410c' }} aria-label="入庫日期" disabled={!r.date} />
                        <span style={{ fontSize: 11, marginLeft: 4, color: inAuto ? '#94a3b8' : '#c2410c' }}>
                          {inAuto ? '隔天' : <button onClick={() => updateSch(r.id, 'inDate', '')} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 11, padding: 0 }}>改回隔天</button>}
                        </span>
                      </td>
                      <td>
                        {gcLink && <a href={gcLink} target="_blank" rel="noreferrer" title="加入 Google 日曆" style={{ fontSize: 14, textDecoration: 'none', opacity: 0.6 }}>📅</a>}
                      </td>
                      <td>{delBtn}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="ps-addbtn" onClick={() => setSchData(d => [...d, { id: uid(), date: '', item: '', barrels: 4, inDate: '' }])}
              style={{ color: '#047857', background: 'none', border: '1px dashed #6ee7b7' }}>＋ 新增生產</button>
            <button className="ps-addbtn" onClick={addOut} title="例如今天要包客訂 200 包，就新增一列扣除 200 包"
              style={{ color: '#b91c1c', background: 'none', border: '1px dashed #fca5a5' }}>− 新增扣除</button>
            {blankCount > 0 && (
              <button onClick={() => setSchData(d => d.filter(r => r.item))}
                style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '6px 12px', cursor: 'pointer' }}>清除未選口味的 {blankCount} 列</button>
            )}
            <span style={{ fontSize: 13, color: '#64748b' }}>
              合計 生產 <strong style={{ color: '#047857' }}>{tot > 0 ? `+${tot.toLocaleString()} 包` : '—'}</strong>
              {outTot > 0 && <>　扣除 <strong style={{ color: '#b91c1c' }}>−{fmtN(outTot)} 包</strong></>}
            </span>
          </div>

          {/* 產量與備用設定 */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
            <button onClick={() => setShowSettings(v => !v)}
              style={{ fontSize: 13, background: showSettings ? '#1e293b' : '#f1f5f9', color: showSettings ? '#fff' : '#475569', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>
              ⚙ 各品項產量（每桶幾包）{showSettings ? ' ▲' : ' ▼'}
            </button>
            {showSettings && (
              <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>同 Excel「4.各品項產量資訊表」。修改後按上方 💾 存檔。</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
                  {[...new Set([...L.all, ...Object.keys(ppb)])].map(f => (
                    <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', padding: '4px 8px', borderRadius: 8, border: '1px solid #eef2f7', fontSize: 13 }}>
                      <span style={{ fontWeight: 700, minWidth: 30 }}>{f}</span>
                      <input type="number" className="inp" value={ppb[f] ?? ''} onChange={e => setPpb(p => ({ ...p, [f]: e.target.value }))} style={{ width: 60, fontSize: 13, padding: '3px 5px', textAlign: 'right' }} />
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>包/桶</span>
                    </label>
                  ))}
                </div>
                {!invDate && (
                  <div style={{ marginTop: 10, fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    預估起算日（庫存狀況尚未存檔時使用）
                    <input type="date" className="inp" value={startDate} onChange={e => setStartDate(e.target.value || todayIso())} style={{ width: 150, fontSize: 13 }} />
                  </div>
                )}
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }}>備用庫存值（只在銷售計畫／庫存狀況尚未存檔時使用）</summary>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6, marginTop: 6 }}>
                    {L.all.map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', padding: '4px 8px', borderRadius: 8, border: '1px solid #eef2f7', fontSize: 12 }}>
                        <span style={{ fontWeight: 700, minWidth: 30 }}>{f}</span>
                        現<input type="number" className="inp" value={bi[f]?.c ?? 0} style={{ width: 58, fontSize: 12, padding: '2px 4px' }} onChange={e => setBi(b => ({ ...b, [f]: { ...(b[f] || {}), c: Number(e.target.value) } }))} />
                        低<input type="number" className="inp" value={bi[f]?.mn ?? 0} style={{ width: 52, fontSize: 12, padding: '2px 4px' }} onChange={e => setBi(b => ({ ...b, [f]: { ...(b[f] || {}), mn: Number(e.target.value) } }))} />
                        耗<input type="number" className="inp" value={bi[f]?.d ?? 0} style={{ width: 44, fontSize: 12, padding: '2px 4px' }} onChange={e => setBi(b => ({ ...b, [f]: { ...(b[f] || {}), d: Number(e.target.value) } }))} />
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
          <AdjustLog logs={logs} />
        </div>

        {/* ── 右：庫存量預估表（自動計算） ── */}
        <div className="card">
          <div className="card-title" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>庫存量預估表 <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 400 }}>自動計算 · 從 {mdOf(effStart)}{invDate ? `（盤點日 ${mdOf(invDate)} 隔天）` : ''} 起 {DAYS} 天</span></span>
          </div>
          {(alerts.out.length > 0 || alerts.low.length > 0) && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px', marginBottom: 8, fontSize: 13, lineHeight: 1.8 }}>
              {alerts.out.length > 0 && <div><strong style={{ color: '#991b1b' }}>預計缺貨：</strong>{alerts.out.map(a => `${a.f}（${mdOf(a.d)} 起）`).join('、')}</div>}
              {alerts.low.length > 0 && <div><strong style={{ color: '#b91c1c' }}>低於最低庫存：</strong>{alerts.low.map(a => `${a.f}（${mdOf(a.d)} 起）`).join('、')}</div>}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, lineHeight: 1.8 }}>
            每日庫存 ＝ 前一天 − 每日預估（含節日加乘）− 已確定銷售量 − 扣除 ＋ 入庫　｜
            起始庫存、上限：{linked.inventory ? <strong style={{ color: '#059669' }}>② 庫存狀況</strong> : <span style={{ color: '#c2410c' }}>⚙ 備用值（庫存狀況尚未存檔）</span>}　｜
            每日預估、最低庫存、已確定銷售：{linked.sales ? <strong style={{ color: '#059669' }}>① 銷售計畫</strong> : <span style={{ color: '#c2410c' }}>⚙ 備用值（銷售計畫尚未存檔）</span>}
          </div>
          <div style={{ marginBottom: 6, lineHeight: 2 }}>
            <span className="pf-lg">
              <i style={{ width: 34, border: '1px solid #e2e8f0', background: 'linear-gradient(90deg, #6DB333 100%, #fff 0)' }} />
              <i style={{ width: 34, border: '1px solid #e2e8f0', background: 'linear-gradient(90deg, #6DB333 45%, #fff 45%)' }} />
              長條越短＝越接近最低庫存（滿格＝到庫存上限，顏色依口味）
            </span>
            <span className="pf-lg"><i style={{ background: '#ffc7ce' }} />低於最低庫存</span>
            <span className="pf-lg"><i style={{ background: '#f87171' }} />缺貨（負數）</span>
            <span className="pf-lg"><i style={{ boxShadow: 'inset 0 0 0 2px #059669' }} /><span className="pf-plus">+數字</span>＝當天入庫</span>
            <span className="pf-lg"><span className="pf-minus">−數字</span>＝扣除（排程表扣除＋已確定銷售）</span>
          </div>
          <div className="pf-scroll">
            <table className="pf">
              <thead><tr>
                <th className="pf-date" style={{ textAlign: 'left' }}>日期</th>
                <th className="pf-total" title={`主產品合計／最高庫容量 ${maxCap.toLocaleString()} 包`} style={{ boxShadow: `inset 0 -4px 0 ${TOTAL_BAR}` }}>滿福合計</th>
                {L.all.map((f, i) => (
                  <th key={f} className={i === L.main.length ? 'pf-sep' : ''} style={{ boxShadow: `inset 0 -4px 0 ${colors[f]}` }}
                    title={`每日預估 ${Math.round(eff[f].d * 10) / 10} · 最低 ${Math.round(eff[f].mn)} · 上限 ${eff[f].mx ? Math.round(eff[f].mx) : '—'} · 每桶 ${ppb[f] ?? '—'} 包`}>
                    {f}{hasSch.has(f) && <span className="pf-tag">排</span>}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {DATES.map((d, di) => {
                  const newMonth = di > 0 && d.mo !== DATES[di - 1].mo
                  const prod = plan.prodDays[d.iso]
                  const total = plan.mainTotal[di]
                  return (
                    <tr key={d.iso} className={`${d.iso === today ? 'pf-today' : ''} ${newMonth ? 'pf-month' : ''} ${d.we ? 'pf-we' : ''}`}>
                      <td className="pf-date" title={prod ? `生產：${prod.join('、')}` : ''}>
                        {d.lb}
                        {d.iso === today && <span className="pf-chip" style={{ background: '#2563eb', color: '#fff' }}>今天</span>}
                        {prod && <span className="pf-chip" style={{ background: '#dcfce7', color: '#166534' }}>生產</span>}
                      </td>
                      <td className={`pf-total${total > maxCap ? ' pf-over' : ''}`} style={barStyle(maxCap > 0 ? total / maxCap : 0, TOTAL_BAR)}
                        title={`滿福合計 ${Math.round(total).toLocaleString()} 包／最高庫容量 ${maxCap.toLocaleString()} 包${total > maxCap ? '（超過庫容量）' : ''}`}>
                        {Math.round(total).toLocaleString()}
                      </td>
                      {L.all.map((f, i) => {
                        const c = plan.res[f][di]
                        const { mn, mx } = eff[f]
                        const st = stOf(c.v, mn, mx)
                        const minus = c.cs + c.ot
                        // 長條：只畫在「最低庫存以上」的格子；低於最低＝粉紅、缺貨＝紅（同 Excel）
                        const bar = st === 'ok' || st === 'high' ? barStyle(levelOf(c.raw, mn, mx), colors[f]) : undefined
                        const tip = [`${f} ${d.lb}：${c.v.toLocaleString()} 包（最低 ${Math.round(mn).toLocaleString()}／上限 ${mx ? Math.round(mx).toLocaleString() : '—'}）`,
                          c.add > 0 && `入庫 +${Math.round(c.add).toLocaleString()}`,
                          c.ot > 0 && `排程表扣除 −${fmtN(c.ot)}`,
                          c.cs > 0 && `已確定銷售 −${fmtN(c.cs)}`].filter(Boolean).join('\n')
                        return (
                          <td key={f} className={`pf-c pf-${st}${c.add ? ' pf-in' : ''}${i === L.main.length ? ' pf-sep' : ''}`} style={bar} title={tip}>
                            <div className="pf-n">{c.v.toLocaleString()}</div>
                            {(c.add > 0 || minus > 0) && (
                              <div className="pf-x">
                                {c.add > 0 && <span className="pf-plus">+{Math.round(c.add).toLocaleString()}</span>}
                                {minus > 0 && <span className="pf-minus">−{fmtN(Math.round(minus * 10) / 10)}</span>}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* AI 建議 */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">AI 排程建議<button className="btn btn-dark btn-sm" onClick={runAI}>重新分析</button></div>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>原料菜價管理（各蔬菜可自設飆漲標準）</summary>
          <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px 78px 50px 28px', gap: 5, marginBottom: 5, paddingBottom: 4, borderBottom: '1px solid #e2e8f0' }}>
              {['蔬菜','本週價(元/kg)','飆漲標準','狀態',''].map(h => <span key={h} style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>{h}</span>)}
            </div>
            {vegData.map((v, i) => {
              const p = parseFloat(v.price) || 0; const high = p > 0 && p > v.thresh
              return (
                <div key={i} className="veg-row">
                  <input className="inp" value={v.name} style={{ fontSize: 13 }} onChange={e => { const n = [...vegData]; n[i] = { ...n[i], name: e.target.value }; setVegData(n) }} />
                  <input type="number" className="inp" value={v.price} placeholder="價格" style={{ fontSize: 13, borderColor: high ? '#f87171' : '', background: high ? '#fef2f2' : '' }} onChange={e => { const n = [...vegData]; n[i] = { ...n[i], price: e.target.value }; setVegData(n) }} />
                  <input type="number" className="inp" value={v.thresh} style={{ fontSize: 13 }} onChange={e => { const n = [...vegData]; n[i] = { ...n[i], thresh: +e.target.value }; setVegData(n) }} />
                  <span className="bdg" style={{ fontSize: 13, background: p > 0 ? (high ? '#fef2f2' : '#f0fdf4') : '#f8fafc', color: p > 0 ? (high ? '#7f1d1d' : '#166534') : '#94a3b8' }}>{p > 0 ? (high ? '飆漲' : '正常') : '—'}</span>
                  <button className="btn btn-sm btn-red" onClick={() => setVegData(d => d.filter((_, j) => j !== i))}>刪</button>
                </div>
              )
            })}
            <button className="btn btn-sm" onClick={() => setVegData(d => [...d, { name: '', price: '', thresh: 50 }])} style={{ marginTop: 8, borderStyle: 'dashed', width: '100%' }}>+ 新增蔬菜</button>
          </div>
        </details>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>補充規則 ／ 排程規則管理</summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <textarea className="inp" value={extraRules} onChange={e => setExtraRules(e.target.value)} placeholder={`補充本週特殊狀況，例如：\n· 青江菜飆漲，綠蔬先暫緩\n· 下週大客單，多備黃金泡菜`} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>排程規則（可編輯）</div>
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #f8fafc' }}>
                <span style={{ fontSize: 13, color: '#94a3b8', minWidth: 16 }}>{i + 1}.</span>
                {ruleEdit
                  ? <><input className="inp" value={r} style={{ flex: 1, fontSize: 13 }} onChange={e => { const n = [...rules]; n[i] = e.target.value; setRules(n) }} /><button className="btn btn-sm btn-red" onClick={() => setRules(r2 => r2.filter((_, j) => j !== i))}>刪</button></>
                  : <span style={{ flex: 1, fontSize: 13 }}>{r}</span>
                }
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setRuleEdit(!ruleEdit)}>{ruleEdit ? '完成' : '編輯規則'}</button>
              {ruleEdit && <button className="btn btn-sm" onClick={() => setRules(r => [...r, '新規則'])}>+ 新增</button>}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>規則與菜價會跟著上方 💾 存檔一起儲存。</div>
          </div>
        </details>

        {aiLoading && <div style={{ fontSize: 14, color: '#94a3b8', padding: '6px 0' }}>分析中...</div>}
        {aiText && <pre style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'Noto Sans TC,sans-serif', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginTop: 4 }}>{aiText}</pre>}
        {!aiLoading && !aiText && <div style={{ fontSize: 14, color: '#94a3b8', padding: '6px 0' }}>點「重新分析」產生 AI 建議排程</div>}
      </div>
    </div>
  )
}
