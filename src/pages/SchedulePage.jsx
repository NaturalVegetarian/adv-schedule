import { useState, useMemo, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDT, loadPage } from '../lib/pageSave'

const PPB = { '黃金':240,'泡菜':240,'咖哩':240,'素花':230,'新鮮':320,'剝皮':330,'酸白':330,'原味':400,'紅燒':87,'藥膳':79,'珍菇':77,'香羹':105,'猴菇':100,'油飯':70 }
const MAIN = ['黃金','泡菜','咖哩','素花','新鮮','剝皮','酸白','原味']
const SUB  = ['紅燒','藥膳','珍菇','香羹','猴菇','油飯']
const FL   = [...MAIN, ...SUB]
const SP   = { '紅燒':'剝皮（共用根菜）','藥膳':'原味（同批）','珍菇':'新鮮（同日）','香羹':'黃金（相近）','猴菇':'泡菜（同日）','油飯':'素花（間隙）' }
const ITEM_VEG = { '黃金':'玉米','泡菜':'高麗菜','素花':'花椰菜','新鮮':'青江菜','酸白':'高麗菜','原味':'大白菜' }

const DEFAULT_BI = {
  '黃金':{c:1941,mn:1716,mx:2770,d:83},'泡菜':{c:625,mn:638,mx:1281,d:38},
  '咖哩':{c:680,mn:347,mx:562,d:11}, '素花':{c:1754,mn:1194,mx:2016,d:60},
  '新鮮':{c:789,mn:571,mx:1382,d:41},'剝皮':{c:1299,mn:888,mx:1771,d:53},
  '酸白':{c:618,mn:424,mx:920,d:28}, '原味':{c:1585,mn:337,mx:1484,d:44},
  '紅燒':{c:70,mn:100,mx:300,d:4},  '藥膳':{c:31,mn:30,mx:200,d:1},
  '珍菇':{c:50,mn:50,mx:200,d:2},   '香羹':{c:26,mn:100,mx:200,d:6},
  '猴菇':{c:69,mn:50,mx:200,d:1},   '油飯':{c:60,mn:50,mx:150,d:3},
}

const WD = ['日','一','二','三','四','五','六']

const INIT_SCH = []

let _uid = 0
const uid = () => `r${Date.now().toString(36)}${(_uid++).toString(36)}`
const withIds = rows => (rows || []).map(r => (r.id ? r : { ...r, id: uid() }))

function todayKey() { const t = new Date(); return `${t.getMonth()+1}/${t.getDate()}` }

// M/D 轉成完整日期，自動判斷年份（距今超過半年就視為跨年）
function resolveDate(m, d) {
  const now = new Date()
  let dt = new Date(now.getFullYear(), m - 1, d)
  const diff = (dt - now) / 86400000
  if (diff < -183) dt = new Date(now.getFullYear() + 1, m - 1, d)
  else if (diff > 183) dt = new Date(now.getFullYear() - 1, m - 1, d)
  return dt
}

// 出貨日（YYYY-MM-DD 或 M/D）轉成 Date
function parseShipDate(s) {
  if (!s) return null
  const iso = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const md = String(s).replace(/\s/g, '').match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) return resolveDate(Number(md[1]), Number(md[2]))
  return null
}
function dateKey(s) { const d = parseShipDate(s); return d ? `${d.getMonth()+1}/${d.getDate()}` : null }

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])) }
const INIT_RULES = [
  '素花3天內做完，越貴不貴。','根菜系列盡量一起做，確保500kg以上。',
  '備料不可超過3天（原油除外）。','叫菜單低於30件先提採購討論。',
  '每週五不入庫存，需要排程。','相同原料盡量同批生產。','淡旺季庫存與轉換次序都重要。',
]
const INIT_VEG = [
  {name:'青江菜',price:'',thresh:60},{name:'高麗菜',price:'',thresh:30},
  {name:'花椰菜',price:'',thresh:50},{name:'玉米',price:'',thresh:40},{name:'大白菜',price:'',thresh:25},
]

function makeStartDate(s) {
  if (!s) return new Date()
  const [m, d] = s.split('/').map(Number)
  if (!m || !d) return new Date()
  return resolveDate(m, d)
}

function makeDates(startStr, count = 45) {
  const B0 = makeStartDate(startStr)
  const dates = []
  for (let i = 0; i < count; i++) {
    const d = new Date(B0.getFullYear(), B0.getMonth(), B0.getDate() + i)
    const m = d.getMonth()+1, dy = d.getDate(), w = d.getDay()
    const iso = `${d.getFullYear()}-${String(m).padStart(2,'0')}-${String(dy).padStart(2,'0')}`
    dates.push({ k: `${m}/${dy}`, lb: `${m}/${dy} 週${WD[w]}`, mo: m, we: w===0||w===6, dt: d, iso })
  }
  return dates
}

function nm(s) { if (!s) return null; const p = s.replace(/\s/g,'').split('/'); if (p.length!==2) return null; return `${parseInt(p[0])}/${parseInt(p[1])}` }
function gc(v,mn,mx) { if(v<=0)return'c-gray'; if(mx>0&&v>=mx)return'c-full'; const r=v/mn; if(r<0.3)return'c-red'; if(r<1)return'c-warn'; if(r<1.5)return'c-low'; if(r<2.5)return'c-ok'; return'c-full' }
function gb(v,mn) { return Math.min(100, Math.round(v/mn*50)) }

export default function SchedulePage() {
  const [schData, setSchData] = useState(INIT_SCH)
  const [rules, setRules] = useState(INIT_RULES)
  const [ruleEdit, setRuleEdit] = useState(false)
  const [vegData, setVegData] = useState(INIT_VEG)
  const [extraRules, setExtraRules] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [bi, setBi] = useState(DEFAULT_BI)
  const [biEdit, setBiEdit] = useState(false)
  const [startDate, setStartDate] = useState(todayKey())
  const [startDateEdit, setStartDateEdit] = useState(false)
  const [startDateInput, setStartDateInput] = useState(todayKey())
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [lastSaved, setLastSaved] = useState(null)

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // 從 Supabase 讀取排程設定
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from('adv_schedule_config').select('*').eq('id', 'default').maybeSingle()
      if (error) { setLoadError(error.message); return }
      if (data) {
        if (data.sch_data) setSchData(withIds(data.sch_data))
        if (data.rules) setRules(data.rules)
        if (data.veg_data) setVegData(data.veg_data)
        if (data.extra_rules) setExtraRules(data.extra_rules)
        if (data.bi) setBi({ ...DEFAULT_BI, ...data.bi })
        if (data.start_date) { setStartDate(data.start_date); setStartDateInput(data.start_date) }
        if (data.updated_at) setLastSaved(data.updated_at)
      }
      setLoaded(true)
    }
    load()
  }, [])

  // 從 adv_orders 讀取未出貨客訂（列在庫存表最右邊的「客訂出貨」欄）
  useEffect(() => {
    const fetchOrders = async () => {
      const { data } = await supabase.from('adv_orders').select('*').in('status', ['pending','packaging','scheduled','prepared'])
      if (data) setOrders(data)
    }
    fetchOrders()
    const ch = supabase.channel('sch_orders').on('postgres_changes', { event: '*', schema: 'public', table: 'adv_orders' }, () => fetchOrders()).subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  // 儲存到 Supabase
  const save = async () => {
    if (!loaded) { alert(loadError ? '排程資料讀取失敗，無法存檔：' + loadError : '排程資料載入中，請稍候再存檔'); return }
    setSaving(true)
    const { error } = await supabase.from('adv_schedule_config').upsert({
      id: 'default',
      sch_data: schData,
      rules,
      veg_data: vegData,
      extra_rules: extraRules,
      bi,
      start_date: startDate,
      updated_at: new Date().toISOString()
    })
    setSaving(false)
    if (error) { alert('儲存失敗：' + error.message) }
    else { setLastSaved(new Date().toISOString()); showToast('排程已儲存 ✅') }
  }

  // ── 連動銷售計畫、庫存狀況（照 Excel：前一天庫存 − 每日預估銷售量 ＋ 當天入庫）──
  const [linked, setLinked] = useState({ sales: null, inventory: null })
  useEffect(() => {
    (async () => {
      const [s, i] = await Promise.all([loadPage('sales'), loadPage('inventory')])
      setLinked({ sales: s.data?.data || null, inventory: i.data?.data || null })
    })()
  }, [])

  // 各口味實際使用的參數：有存檔就用銷售計畫／庫存狀況，沒有才用 ⚙ 庫存設定
  const eff = useMemo(() => {
    const s = linked.sales, inv = linked.inventory
    const sd = Object.fromEntries((s?.saleData || []).map(r => [r.f, r]))
    const mainSum = MAIN.reduce((t, f) => t + (Number(sd[f]?.d) || 0), 0)
    const out = {}
    FL.forEach(f => {
      const b = bi[f] || { c: 0, mn: 0, mx: 0, d: 0 }
      const d  = sd[f] ? (Number(sd[f].d) || 0) : b.d
      const mn = sd[f] ? (Number(sd[f].m) || 0) : b.mn
      const c  = inv?.inv && inv.inv[f] != null ? (Number(inv.inv[f]) || 0) : b.c
      let mx = b.mx
      if (inv) {
        if (MAIN.includes(f)) {
          const manual = inv.mxMain?.[f]
          mx = manual !== '' && manual != null
            ? (Number(manual) || 0)
            : Math.round(12000 * (mainSum ? d / mainSum : 0) * (1 + (Number(inv.bonus?.[f]) || 0) / 100))
        } else if (inv.mxSub?.[f] != null) mx = Number(inv.mxSub[f]) || b.mx
      }
      out[f] = { c, d, mn, mx }
    })
    return out
  }, [bi, linked])

  // 有庫存狀況的盤點日期 → 從盤點日隔天開始預估（和 Excel 一樣）
  const invStart = useMemo(() => {
    const m = String(linked.inventory?.date || '').match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})/)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)
    return { key: `${d.getMonth()+1}/${d.getDate()}`, countDate: `${Number(m[2])}/${Number(m[3])}` }
  }, [linked])
  const effStart = invStart ? invStart.key : startDate

  // 節日／活動加乘：活動期間內，受影響口味的每日預估 × 倍率（重疊取最大）
  const multOf = useMemo(() => {
    const evs = (linked.sales?.events || []).filter(e => e.start && e.end && Number(e.mult) > 0)
    return (f, iso) => evs.reduce((m, e) =>
      (iso >= e.start && iso <= e.end && (!e.items?.length || e.items.includes(f))) ? Math.max(m, Number(e.mult)) : m, 1)
  }, [linked])

  const DATES = useMemo(() => makeDates(effStart), [effStart])

  // 客訂出貨清單：依出貨日列在庫存表最右欄（只列出，不扣庫存——袋與包的換算待確認）
  // 出貨日已過但還沒完成出貨 → 標「逾期」列在第一天；沒填出貨日 → 標「未定」列在第一天；超出 45 天 → 不列
  const orderInfo = useMemo(() => {
    const first = DATES[0].dt, last = DATES[DATES.length - 1].dt
    const custByDate = {}
    let overdue = 0
    orders.forEach(o => {
      const name = o.item_name || o.itemName || ''
      const f = FL.find(x => name.includes(x))
      const qty = Number(o.quantity) || 0
      const td = parseShipDate(o.target_date || o.targetDate)
      let k, tag = ''
      if (!td) { k = DATES[0].k; tag = '未定 ' }
      else if (td < first) { k = DATES[0].k; tag = '逾期 '; overdue++ }
      else if (td > last) return
      else k = `${td.getMonth()+1}/${td.getDate()}`
      const cust = o.customer_name || o.customerName || '未知客戶'
      if (!custByDate[k]) custByDate[k] = []
      custByDate[k].push(`${tag}${cust} ${f || name} ${qty}${o.unit || '袋'}`)
    })
    return { custByDate, overdue }
  }, [orders, DATES])

  const cInv = useCallback(() => {
    const im = {}, pm = {}
    schData.forEach(r => {
      const pk = nm(r.date), ik = nm(r.inDate) || pk
      if (!ik || !r.item) return
      const p = (PPB[r.item]||0) * (r.barrels||0)
      if (!im[ik]) im[ik] = {}; im[ik][r.item] = (im[ik][r.item]||0) + p
      if (pk) { if (!pm[pk]) pm[pk] = new Set(); pm[pk].add(r.item) }
    })
    const res = {}
    FL.forEach(f => {
      const b = eff[f]; if (!b) return
      let run = b.c
      res[f] = DATES.map(d => {
        run -= b.d * multOf(f, d.iso)          // 每日預估銷售量（節日加乘）
        if (im[d.k]?.[f]) run += im[d.k][f]    // 當天入庫
        return { v: Math.round(run), p: !!(pm[d.k]?.has(f)) }  // 不設下限，負數＝缺貨量（同 Excel）
      })
    })
    return res
  }, [schData, eff, multOf, DATES])

  const invTable = useMemo(() => cInv(), [cInv])
  const tot = schData.reduce((s, r) => s + (PPB[r.item]||0) * (r.barrels||0), 0)

  const updateSch = (i, k, v) => {
    setSchData(prev => {
      const n = [...prev]; n[i] = { ...n[i], [k]: v }; return n
    })
  }


  // 當日客訂出貨（用於庫存表旁邊顯示）
  const todayShip = useMemo(() => {
    const tk = todayKey()
    return orders.filter(o => dateKey(o.target_date || o.targetDate) === tk)
  }, [orders])

  const runAI = () => {
    setAiLoading(true); setAiText('')
    setTimeout(() => {
      const data = cInv()
      const highVeg = vegData.filter(v => parseFloat(v.price) > v.thresh && v.name)
      const priceWarn = new Set()
      highVeg.forEach(v => { Object.entries(ITEM_VEG).forEach(([item, veg]) => { if (veg === v.name) priceWarn.add(item) }) })
      const az = f => {
        const b = eff[f]; if (!b || !data[f]) return { has: false }
        let fw = -1, fr = -1
        data[f].forEach(({ v }, di) => { const c = gc(v,b.mn,b.mx); if(c==='c-warn'&&fw<0)fw=di; if((c==='c-red'||c==='c-gray')&&fr<0)fr=di })
        const di = fr>=0?fr:fw; const urg = fr>=0; const pbt = PPB[f]||240
        const ref = di>=3?data[f][di-3].v:b.c
        const need = Math.max(1, Math.ceil((b.mn*1.3-ref)/pbt))
        return { f, di, urg, need, pbt, pd: Math.max(0,di-3), has: di>=0 }
      }
      const mi = MAIN.map(az).filter(x=>x.has).sort((a,b)=>(b.urg?1:0)-(a.urg?1:0)||(a.di-b.di))
      const si = SUB.map(az).filter(x=>x.has).sort((a,b)=>(b.urg?1:0)-(a.urg?1:0)||(a.di-b.di))
      const sok = SUB.filter(f => !si.find(x=>x.f===f))
      let txt = ''
      if (highVeg.length > 0) { txt += '【菜價警示】\n'; highVeg.forEach(v => { const aff = Object.entries(ITEM_VEG).filter(([,veg])=>veg===v.name).map(([i])=>i); txt += `• ${v.name} 本週 ${v.price} 元/kg（標準 ${v.thresh} 元），相關品項：${aff.join('、')||'無'}。建議評估是否延後。\n` }); txt += '\n' }
      if (extraRules) { txt += `【補充規則】\n${extraRules}\n\n` }
      txt += '【主產品建議（水餃・餡餅・湯包）】\n'
      if (mi.length === 0) { txt += '✓ 45天內主產品庫存充足\n' }
      else { mi.forEach(({ f, di, urg, need, pbt, pd }) => { const wd = DATES[di]?.lb||'—', sd = DATES[pd]?.lb||'—'; txt += `• ${urg?'[緊急]':'[偏低]'} ${f}：建議 ${sd} 前排 ${need} 桶（+${(need*pbt).toLocaleString()}包）\n  ${wd} 起庫存${urg?'緊急不足':'偏低'}。現 ${eff[f].c.toLocaleString()} 包，日耗 ${eff[f].d} 包，最低 ${eff[f].mn.toLocaleString()} 包。${priceWarn.has(f)?'⚠ 菜價偏高，請確認成本。':''}\n` }) }
      txt += '\n【副產品建議（搭配主產品同日排入）】\n'
      if (si.length === 0) { txt += '✓ 副產品庫存充足\n' }
      else { si.forEach(({ f, di, urg, need, pbt, pd }) => { const wd = DATES[di]?.lb||'—', sd = DATES[pd]?.lb||'—'; txt += `• ${urg?'[緊急]':'[偏低]'} ${f}（副）：建議 ${sd} 前搭配 ${SP[f]||'主產品'}，排 ${need} 桶。\n  ${wd} 起庫存${urg?'不足':'偏低'}，現 ${eff[f].c.toLocaleString()} 包。\n` }) }
      if (sok.length > 0) txt += `✓ 充足副產品：${sok.join('、')} 可彈性安排。\n`
      txt += '\n【原料群組建議】\n• 紅燒＋剝皮：共用根菜類原料，建議同批次節省換料\n• 素花系列：間隔不超過3天，越貴不貴\n• 副產品原則：主產品桶數少（1-2桶）時同日排入，不佔整天'
      setAiText(txt); setAiLoading(false)
    }, 1400)
  }

  // 產生 Google 日曆匯出連結
  const makeGoogleCalLink = (r) => {
    const [m, d] = (r.date || '').split('/').map(Number)
    if (!m || !d) return null
    const s = resolveDate(m, d), e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1)
    const pad = n => String(n).padStart(2,'0')
    const fmt = x => `${x.getFullYear()}${pad(x.getMonth()+1)}${pad(x.getDate())}`
    const title = encodeURIComponent(`生產排程：${r.item} ${r.barrels}桶（入庫${r.inDate||'同日'}）`)
    return `https://calendar.google.com/calendar/r/eventedit?text=${title}&dates=${fmt(s)}/${fmt(e)}&details=${encodeURIComponent(`品項：${r.item}\n桶數：${r.barrels}\n包數：${(PPB[r.item]||0)*r.barrels}包\n入庫日：${r.inDate||'同日'}`)}`
  }

  // 庫存預估表 HTML
  const invHTML = useMemo(() => {
    let h = '<thead><tr>'
    h += `<th style="text-align:left;position:sticky;left:0;top:0;z-index:4;min-width:76px;background:#f8fafc">日期</th>`
    FL.forEach((f, fi) => {
      const hasSch = schData.some(r => r.item === f)
      const isSub = SUB.includes(f)
      const fsub = fi === MAIN.length
      h += `<th class="${hasSch ? 'hs' : ''}" style="${fsub ? 'border-left:3px solid #94a3b8!important' : ''}">${f}${isSub ? '<br><span style="font-size:8px;background:#ede9fe;color:#5b21b6;border-radius:2px;padding:0 2px">副</span>' : ''}${hasSch ? `<br><span style="font-size:8px;background:${isSub ? '#5b21b6' : '#1e293b'};color:#fff;border-radius:2px;padding:0 3px">排</span>` : ''}</th>`
    })
    h += `<th style="text-align:left;min-width:150px;border-left:3px solid #94a3b8!important">客訂出貨</th>`
    h += '</tr></thead><tbody>'
    let lastM = -1
    DATES.forEach((d, di) => {
      const anyP = FL.some(f => invTable[f]?.[di]?.p)
      const newM = d.mo !== lastM && lastM !== -1; lastM = d.mo
      h += `<tr${newM ? ' class="msep"' : ''}>`
      h += `<td class="dc${anyP ? ' sp' : ''}${d.we ? ' we' : ''}">${d.lb}</td>`
      FL.forEach((f, fi) => {
        if (!invTable[f]) { h += `<td class="ic"></td>`; return }
        const { v, p } = invTable[f][di]
        const b = eff[f] || { mn: 1 }
        const cls = gc(v, b.mn, b.mx); const pct = gb(v, b.mn)
        const fsub = fi === MAIN.length
        h += `<td class="ic ${cls}${p ? ' hp' : ''}" style="${fsub ? 'border-left:3px solid #94a3b8!important' : ''}"><div class="ci"><div class="cn">${v.toLocaleString()}</div><div class="bw"><div class="bf" style="width:${pct}%"></div></div></div></td>`
      })
      const cs = orderInfo.custByDate[d.k] || []
      h += `<td style="text-align:left;font-size:11px;color:#065f46;white-space:nowrap;padding:2px 6px;border-left:3px solid #94a3b8!important">${cs.map(c => c.startsWith('逾期 ') ? `<span style="color:#c2410c">${esc(c)}</span>` : esc(c)).join('<br>')}</td>`
      h += '</tr>'
    })
    h += '</tbody>'
    return h
  }, [invTable, schData, eff, orderInfo, DATES])

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 80, left: 0, right: 0, zIndex: 100, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ background: '#059669', color: '#fff', padding: '10px 24px', borderRadius: 50, fontWeight: 700, fontSize: 14 }}>{toast}</div>
        </div>
      )}

      {loadError && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#7c2d12' }}>
          <strong>排程資料讀取失敗，暫時不能存檔：</strong>{loadError}（第一次使用請先在 Supabase 建立 adv_schedule_config 資料表）
        </div>
      )}

      {/* 逾期未出貨提示 */}
      {orderInfo.overdue > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#7c2d12' }}>
          <strong>⚠ 有 {orderInfo.overdue} 筆客訂已過出貨日、還沒按「完成出貨」</strong>，列在庫存表最右欄第一天（橘字「逾期」），請到客訂管理確認狀態。
        </div>
      )}

      {/* 今日出貨客訂 */}
      {todayShip.length > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, color: '#065f46' }}>
          <strong>📦 今日出貨：</strong> {todayShip.map(o => `${o.customer_name||o.customerName} ${o.item_name||o.itemName} ×${o.quantity}袋`).join(' · ')}
        </div>
      )}

      {/* 庫存預估 */}
      <div className="card">
        <div className="card-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            庫存預估（自動更新）
            {/* 起始日期：有庫存狀況的盤點日就自動帶入 */}
            {invStart ? (
              <span style={{ fontSize: 12, color: '#94a3b8', padding: '2px 4px' }} title="要改起算日，請到庫存狀況修改盤點日期">
                起算 {effStart}（庫存狀況盤點 {invStart.countDate} 的隔天）
              </span>
            ) : startDateEdit ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>起算：</span>
                <input
                  className="inp"
                  value={startDateInput}
                  style={{ width: 56, fontSize: 13 }}
                  placeholder="5/8"
                  onChange={e => setStartDateInput(e.target.value)}
                  onBlur={() => {
                    const v = startDateInput.trim()
                    if (/^\d+\/\d+$/.test(v)) { setStartDate(v); setStartDateEdit(false) }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = startDateInput.trim()
                      if (/^\d+\/\d+$/.test(v)) { setStartDate(v); setStartDateEdit(false) }
                    }
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <span
                style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', textDecoration: 'underline dotted', padding: '2px 4px' }}
                onClick={() => setStartDateEdit(true)}
                title="點擊修改起始日期"
              >
                起算 {startDate}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['#f0fdf4','#166534','充足'],['#fefce8','#713f12','偏低'],['#fff7ed','#7c2d12','紅燈'],['#fef2f2','#7f1d1d','緊急'],['#f8fafc','#475569','灰燈']].map(([bg,tc,l]) => (
              <span key={l} className="bdg" style={{ background: bg, color: tc, fontSize: 12 }}>{l}</span>
            ))}
            <button
              onClick={() => setBiEdit(!biEdit)}
              style={{ fontSize: 12, background: biEdit ? '#1e293b' : '#f1f5f9', color: biEdit ? '#fff' : '#64748b', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}
            >
              {biEdit ? '完成' : '⚙ 庫存設定'}
            </button>
          </div>
        </div>

        {/* 連動來源 */}
        <div style={{ fontSize: 12, color: '#64748b', margin: '-4px 0 8px', lineHeight: 1.8 }}>
          計算方式：前一天庫存 − 每日預估銷售量（含節日加乘）＋ 當天入庫　｜
          起始庫存、上限：{linked.inventory ? <strong style={{ color: '#059669' }}>庫存狀況</strong> : <span style={{ color: '#c2410c' }}>⚙ 庫存設定（庫存狀況尚未存檔）</span>}　｜
          每日預估、最低庫存：{linked.sales ? <strong style={{ color: '#059669' }}>銷售計畫</strong> : <span style={{ color: '#c2410c' }}>⚙ 庫存設定（銷售計畫尚未存檔）</span>}
        </div>

        {/* 庫存上限編輯 */}
        {biEdit && (
          <div style={{ marginBottom: 12, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>庫存設定（備用值：只在銷售計畫、庫存狀況尚未存檔時使用）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
              {FL.map(f => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', padding: '6px 8px', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', minWidth: 30 }}>{f}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>現：</span>
                  <input type="number" className="inp" value={bi[f]?.c||0} style={{ width: 58, fontSize: 12, padding: '3px 5px' }}
                    onChange={e => setBi(b => ({ ...b, [f]: { ...b[f], c: Number(e.target.value) } }))} />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>低：</span>
                  <input type="number" className="inp" value={bi[f]?.mn||0} style={{ width: 52, fontSize: 12, padding: '3px 5px' }}
                    onChange={e => setBi(b => ({ ...b, [f]: { ...b[f], mn: Number(e.target.value) } }))} />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>耗：</span>
                  <input type="number" className="inp" value={bi[f]?.d||0} style={{ width: 40, fontSize: 12, padding: '3px 5px' }}
                    onChange={e => setBi(b => ({ ...b, [f]: { ...b[f], d: Number(e.target.value) } }))} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
          <table className="it" dangerouslySetInnerHTML={{ __html: invHTML }}></table>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 5 }}>粗框=當日入庫 · 條=庫存/最低庫存 · 雙線=月份 · ║=主∣副 · 負數=預估缺貨量 · 最右欄=當日出貨客戶（只列出，不扣庫存）</div>
      </div>

      {/* 排程輸入 */}
      <div className="card">
        <div className="card-title">
          排程輸入
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 400 }}>上次存檔：{lastSaved ? <strong style={{ color: '#1e293b' }}>{fmtDT(lastSaved)}</strong> : '尚未存檔'} · 合計 <strong style={{ color: '#1e293b' }}>{tot > 0 ? `${tot.toLocaleString()}包` : '—'}</strong></span>
            <button
              onClick={save}
              disabled={saving}
              style={{ fontSize: 13, background: saving ? '#94a3b8' : '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', cursor: saving ? 'default' : 'pointer', fontWeight: 700 }}
            >
              {saving ? '儲存中...' : '💾 存檔'}
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 14 }}>
            <thead><tr>
              <th style={{ width: 54 }}>生產日</th>
              <th style={{ width: 82 }}>品項</th>
              <th style={{ width: 86, textAlign: 'center' }}>桶數</th>
              <th style={{ width: 52, textAlign: 'right' }}>包數</th>
              <th style={{ width: 54 }}>入庫日</th>
              <th style={{ width: 28 }}>日曆</th>
              <th style={{ width: 20 }}></th>
            </tr></thead>
            <tbody>
              {schData.map((r, i) => {
                const pk = (PPB[r.item]||0) * (r.barrels||0)
                const isSub = SUB.includes(r.item)
                const gcLink = makeGoogleCalLink(r)
                return (
                  <tr key={r.id || i} style={{ background: isSub ? 'rgba(109,40,217,.04)' : 'transparent' }}>
                    <td>
                      <input
                        className="inp"
                        defaultValue={r.date}
                        style={{ width: 48, fontSize: 13 }}
                        onBlur={e => updateSch(i, 'date', e.target.value)}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {isSub && <span style={{ fontSize: 8, background: '#ede9fe', color: '#5b21b6', borderRadius: 2, padding: '1px 3px', flexShrink: 0 }}>副</span>}
                        <select
                          className="inp"
                          style={{ width: isSub ? 58 : 70, fontSize: 13 }}
                          value={r.item}
                          onChange={e => updateSch(i, 'item', e.target.value)}
                        >
                          <optgroup label="主產品">{MAIN.map(f => <option key={f}>{f}</option>)}</optgroup>
                          <optgroup label="副產品">{SUB.map(f => <option key={f}>{f}</option>)}</optgroup>
                        </select>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                        <button
                          onClick={() => updateSch(i, 'barrels', Math.max(1, (r.barrels||1)-1))}
                          style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                        >−</button>
                        <span style={{ fontSize: 14, fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{r.barrels}</span>
                        <button
                          onClick={() => updateSch(i, 'barrels', (r.barrels||1)+1)}
                          style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                        >＋</button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, paddingRight: 5 }}>{pk > 0 ? pk.toLocaleString() : '—'}</td>
                    <td>
                      <input
                        className="inp"
                        defaultValue={r.inDate||''}
                        style={{ width: 46, fontSize: 13 }}
                        onBlur={e => updateSch(i, 'inDate', e.target.value)}
                      />
                    </td>
                    <td>
                      {gcLink && (
                        <a href={gcLink} target="_blank" rel="noreferrer" title="加入 Google 日曆"
                          style={{ fontSize: 14, textDecoration: 'none', opacity: 0.6, display: 'block', textAlign: 'center' }}>
                          📅
                        </a>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => setSchData(d => d.filter((_,j) => j!==i))}
                        style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}
                      >×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => setSchData(d => [...d, { id: uid(), date: '', item: '黃金', barrels: 4, inDate: '' }])}
            style={{ flex: 1, fontSize: 13, color: '#94a3b8', background: 'none', border: '1px dashed #e2e8f0', borderRadius: 7, padding: '5px 0', cursor: 'pointer' }}
          >+ 新增排程列</button>
          <button
            onClick={save}
            disabled={saving}
            style={{ fontSize: 13, background: saving ? '#94a3b8' : '#1e293b', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 18px', cursor: saving ? 'default' : 'pointer', fontWeight: 700 }}
          >
            {saving ? '儲存中...' : '💾 存檔'}
          </button>
        </div>
      </div>

      {/* AI 建議 */}
      <div className="card">
        <div className="card-title">AI 排程建議<button className="btn btn-dark btn-sm" onClick={runAI}>重新分析</button></div>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 14, cursor: 'pointer', userSelect: 'none' }}>原料菜價管理（各蔬菜可自設飆漲標準）</summary>
          <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px 78px 50px 28px', gap: 5, marginBottom: 5, paddingBottom: 4, borderBottom: '1px solid #e2e8f0' }}>
              {['蔬菜','本週價(元/kg)','飆漲標準','狀態',''].map(h => <span key={h} style={{ fontSize: 13, fontWeight: 700, color: '#64748b' }}>{h}</span>)}
            </div>
            {vegData.map((v, i) => {
              const p = parseFloat(v.price)||0; const high = p>0 && p>v.thresh
              return (
                <div key={i} className="veg-row">
                  <input className="inp" value={v.name} style={{ fontSize: 13 }} onChange={e => { const n=[...vegData]; n[i]={...n[i],name:e.target.value}; setVegData(n) }} />
                  <input type="number" className="inp" value={v.price} placeholder="價格" style={{ fontSize: 13, borderColor: high ? '#f87171' : '', background: high ? '#fef2f2' : '' }} onChange={e => { const n=[...vegData]; n[i]={...n[i],price:e.target.value}; setVegData(n) }} />
                  <input type="number" className="inp" value={v.thresh} style={{ fontSize: 13 }} onChange={e => { const n=[...vegData]; n[i]={...n[i],thresh:+e.target.value}; setVegData(n) }} />
                  <span className="bdg" style={{ fontSize: 13, background: p>0?(high?'#fef2f2':'#f0fdf4'):'#f8fafc', color: p>0?(high?'#7f1d1d':'#166534'):'#94a3b8' }}>{p>0?(high?'飆漲':'正常'):'—'}</span>
                  <button className="btn btn-sm btn-red" onClick={() => setVegData(d => d.filter((_,j) => j!==i))}>刪</button>
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
                <span style={{ fontSize: 13, color: '#94a3b8', minWidth: 16 }}>{i+1}.</span>
                {ruleEdit
                  ? <><input className="inp" value={r} style={{ flex: 1, fontSize: 13 }} onChange={e => { const n=[...rules]; n[i]=e.target.value; setRules(n) }} /><button className="btn btn-sm btn-red" onClick={() => setRules(r2 => r2.filter((_,j) => j!==i))}>刪</button></>
                  : <span style={{ flex: 1, fontSize: 13 }}>{r}</span>
                }
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setRuleEdit(!ruleEdit)}>{ruleEdit ? '完成' : '編輯規則'}</button>
              {ruleEdit && <button className="btn btn-sm" onClick={() => setRules(r => [...r, '新規則'])}>+ 新增</button>}
            </div>
          </div>
        </details>

        {aiLoading && <div style={{ fontSize: 14, color: '#94a3b8', padding: '6px 0' }}>分析中...</div>}
        {aiText && <pre style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'Noto Sans TC,sans-serif', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginTop: 4 }}>{aiText}</pre>}
        {!aiLoading && !aiText && <div style={{ fontSize: 14, color: '#94a3b8', padding: '6px 0' }}>點「重新分析」產生 AI 建議排程</div>}
      </div>
    </div>
  )
}
