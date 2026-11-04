import { useState, useEffect, useMemo } from 'react'
import { loadPage, loadLogs, savePage, SaveBar, AdjustLog, LoadError, Toast } from '../lib/pageSave'
import { flavorLists, DEFAULT_MAX_CAP, toIso, todayIso, wdOf } from '../lib/flavors'

// 預設值（銷售計畫／本頁有存檔就以存檔為準）
const DAILY    = {黃金:83,泡菜:38,咖哩:11,素花:60,新鮮:41,剝皮:53,酸白:28,原味:44,綠蔬:25,紅燒:4,藥膳:1,香羹:6,珍菇:2,猴菇:1,油飯:3}
const INIT_MN  = {黃金:1716,泡菜:638,咖哩:347,素花:1194,新鮮:571,剝皮:888,酸白:424,原味:337,綠蔬:337,紅燒:100,藥膳:30,香羹:100,珍菇:50,猴菇:50,油飯:50}
const INIT_CUR = {黃金:1941,泡菜:625,咖哩:680,素花:1754,新鮮:789,剝皮:1299,酸白:618,原味:1585,綠蔬:24,紅燒:70,藥膳:31,香羹:26,珍菇:50,猴菇:69,油飯:60}
const INIT_MX_SUB = {綠蔬:300,紅燒:300,藥膳:200,香羹:200,珍菇:200,猴菇:200,油飯:150}

const blankOr = v => (v === '' || v == null ? '' : String(v))

// 存檔前統一格式，方便比對與存放（口味清單跟著銷售計畫）
const normInv = (s, L) => ({
  date:   toIso(s.date) || '',
  maxCap: Number(s.maxCap) || DEFAULT_MAX_CAP,
  inv:    Object.fromEntries(L.all.map(f => [f, Number(s.inv?.[f]) || 0])),
  bonus:  Object.fromEntries(L.main.map(f => [f, Number(s.bonus?.[f]) || 0])),
  mxMain: Object.fromEntries(L.main.map(f => [f, blankOr(s.mxMain?.[f])])), // 主產品手動上限，空白＝自動
  mxSub:  Object.fromEntries(L.sub.map(f => [f, Number(s.mxSub?.[f]) || 0])),
  refill: Object.fromEntries(L.all.map(f => [f, blankOr(s.refill?.[f])])),
})

// 比對上次存檔與目前內容，產生「調整了什麼」的文字
function diffInv(p, c) {
  const out = []
  const keys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])]
  if (p.date !== c.date) out.push(`盤點日期 ${p.date || '—'} → ${c.date || '—'}`)
  if (p.maxCap !== c.maxCap) out.push(`最高庫容量 ${p.maxCap} → ${c.maxCap} 包`)
  keys(p.inv, c.inv).forEach(f => { const a = p.inv[f] ?? 0, b = c.inv[f] ?? 0; if (a !== b) out.push(`${f} 現有庫存 ${a} → ${b}`) })
  keys(p.bonus, c.bonus).forEach(f => { const a = p.bonus[f] ?? 0, b = c.bonus[f] ?? 0; if (a !== b) out.push(`${f} 上限增益 ${a}% → ${b}%`) })
  keys(p.mxMain, c.mxMain).forEach(f => { const a = p.mxMain[f] ?? '', b = c.mxMain[f] ?? ''; if (a !== b) out.push(`${f} 庫存上限 ${a || '自動'} → ${b || '自動'}`) })
  keys(p.mxSub, c.mxSub).forEach(f => { const a = p.mxSub[f] ?? 0, b = c.mxSub[f] ?? 0; if (a !== b) out.push(`${f} 庫存上限 ${a} → ${b}`) })
  keys(p.refill, c.refill).forEach(f => { const a = p.refill[f] ?? '', b = c.refill[f] ?? ''; if (a !== b) out.push(`${f} 可補充 ${a || '—'}% → ${b || '—'}%`) })
  return out
}

// 狀態（同生產排程的顏色）：缺貨／低於最低庫存（紅）／正常／高於上限（綠）
const ST = {
  out:  { label: '缺貨',       bg: '#fee2e2', tc: '#991b1b', bar: '#ef4444' },
  low:  { label: '低於最低',   bg: '#fef2f2', tc: '#b91c1c', bar: '#f87171' },
  ok:   { label: '正常',       bg: '#f1f5f9', tc: '#334155', bar: '#94a3b8' },
  high: { label: '高於上限',   bg: '#dcfce7', tc: '#166534', bar: '#22c55e' },
}
const stOf = (v, mn, mx) => v <= 0 ? 'out' : (mn > 0 && v < mn) ? 'low' : (mx > 0 && v > mx) ? 'high' : 'ok'

export default function InventoryPage() {
  // 品項主檔與每日預估、最低庫存：跟銷售計畫連動（同 Excel），銷售計畫沒存檔才用預設值
  const [salesRows, setSalesRows] = useState(null)
  const L = useMemo(() => flavorLists(salesRows), [salesRows])
  const daily = useMemo(() => salesRows ? Object.fromEntries(salesRows.map(r => [r.f, Number(r.d) || 0])) : DAILY, [salesRows])
  const minOf = useMemo(() => salesRows ? Object.fromEntries(salesRows.map(r => [r.f, Number(r.m) || 0])) : INIT_MN, [salesRows])
  const sumD = L.main.reduce((s, f) => s + (daily[f] || 0), 0)

  const [inv,    setInv]    = useState(INIT_CUR)
  const [date,   setDate]   = useState(todayIso)
  const [maxCap, setMaxCap] = useState(DEFAULT_MAX_CAP)
  const [bonus,  setBonus]  = useState({})
  const [mxSub,  setMxSub]  = useState(INIT_MX_SUB)
  const [mxMain, setMxMain] = useState({})
  const [refill, setRefill] = useState({})

  // 存檔相關
  const [saved, setSaved] = useState(() => normInv({ date: todayIso(), inv: INIT_CUR, mxSub: INIT_MX_SUB }, flavorLists(null)))
  const [lastSaved, setLastSaved] = useState(null)
  const [logs, setLogs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const flash = m => { setToast(m); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    (async () => {
      const s = await loadPage('sales')
      const rows = s.data?.data?.saleData || null
      if (rows) setSalesRows(rows)
      const Lx = flavorLists(rows)
      const { data, error } = await loadPage('inventory')
      if (error) { setLoadError(error.message); return }
      if (data?.data) {
        const n = normInv(data.data, Lx)
        setDate(n.date); setMaxCap(n.maxCap); setInv(n.inv); setBonus(n.bonus); setMxSub(n.mxSub); setMxMain(n.mxMain); setRefill(n.refill)
        setSaved(n); setLastSaved(data.updated_at)
      } else {
        setSaved(normInv({ date: todayIso(), inv: INIT_CUR, mxSub: INIT_MX_SUB }, Lx))
      }
      const lg = await loadLogs('inventory')
      setLogs(lg.data)
      setLoaded(true)
    })()
  }, [])

  const current = useMemo(() => normInv({ date, maxCap, inv, bonus, mxSub, mxMain, refill }, L), [date, maxCap, inv, bonus, mxSub, mxMain, refill, L])
  const changes = useMemo(() => diffInv(saved, current), [saved, current])

  const onSave = async () => {
    if (!loaded) return
    if (changes.length === 0 && lastSaved) { flash('沒有需要存檔的變更'); return }
    const ch = changes.length ? changes : ['首次存檔（沿用預設數值）']
    setSaving(true)
    const r = await savePage('inventory', current, ch)
    setSaving(false)
    if (r.error) { alert('存檔失敗：' + r.error.message); return }
    setSaved(current); setLastSaved(r.savedAt)
    setLogs(l => [{ id: 'new-' + r.savedAt, created_at: r.savedAt, changes: ch }, ...l].slice(0, 50))
    flash('已存檔 ✅')
  }
  const saveBar = <SaveBar lastSaved={lastSaved} dirty={loaded && changes.length > 0} saving={saving} disabled={!loaded} onSave={onSave} />

  // 主產品：最高庫容量 × 銷售比 ×（1＋上限增益%）；有手動填值就用手動值
  const autoMax = f => Math.round((Number(maxCap) || 0) * (sumD ? (daily[f] || 0) / sumD : 0) * (1 + (Number(bonus[f]) || 0) / 100))
  const calcMax = f => L.main.includes(f)
    ? (mxMain[f] !== '' && mxMain[f] != null ? (Number(mxMain[f]) || 0) : autoMax(f))
    : (Number(mxSub[f]) || 0)

  const mainTotal = L.main.reduce((s, f) => s + (Number(inv[f]) || 0), 0)
  const staleDays = date ? Math.floor((new Date(todayIso()) - new Date(date)) / 86400000) : null

  // 注意：用 {InvRows({...})} 呼叫，不要寫成 <InvRows/>，否則每打一個字整列重建、游標跳掉跳回頂端
  const InvRows = ({ flavors, title }) => (
    <>
      <tr><td colSpan={7} className="sec-head">{title}</td></tr>
      {flavors.map(f => {
        const v = Number(inv[f]) || 0, m = minOf[f] || 0, mx = calcMax(f)
        const pct = mx > 0 ? Math.min(100, Math.round(v / mx * 100)) : 0
        const st = ST[stOf(v, m, mx)]
        return (
          <tr key={f}>
            <td style={{fontWeight:700,fontSize:16}}>{f}</td>
            <td style={{textAlign:'right'}}>
              <input type="number" value={inv[f] ?? 0}
                onChange={e=>setInv(d=>({...d,[f]:+e.target.value}))}
                className="inp" style={{width:85,textAlign:'right',fontSize:15}}/>
            </td>
            <td style={{textAlign:'right',color:'#64748b',fontSize:14}}>{mx ? mx.toLocaleString() : '—'}</td>
            <td style={{textAlign:'right',color:'#64748b',fontSize:14}}>{m.toLocaleString()}</td>
            <td style={{minWidth:130}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <div style={{flex:1,height:7,borderRadius:4,background:'#e2e8f0',overflow:'hidden'}}>
                  <div style={{width:`${pct}%`,height:'100%',background:st.bar,borderRadius:4}}/>
                </div>
                <span style={{fontSize:12,color:'#94a3b8',minWidth:32}}>{mx ? `${pct}%` : ''}</span>
              </div>
            </td>
            <td style={{textAlign:'right',color:'#94a3b8',fontSize:13}}>{Math.round((daily[f]||0)*10)/10}包/日</td>
            <td><span className="bdg" style={{background:st.bg,color:st.tc,fontSize:13}}>{st.label}</span></td>
          </tr>
        )
      })}
    </>
  )

  const UpperRows = ({ flavors, title }) => (
    <>
      <tr><td colSpan={5} className="sec-head">{title}</td></tr>
      {flavors.map(f => {
        const isMain = L.main.includes(f)
        const ratio  = isMain ? (sumD ? (daily[f]||0)/sumD*100 : 0).toFixed(2) : null
        return (
          <tr key={f}>
            <td style={{fontWeight:700,fontSize:16}}>{f}</td>
            <td style={{textAlign:'right',color:'#64748b',fontSize:15}}>
              {ratio !== null ? `${ratio}%` : '—'}
            </td>
            <td style={{textAlign:'right'}}>
              {isMain
                ? <><input type="number" value={bonus[f] ?? 0}
                    onChange={e=>setBonus(p=>({...p,[f]:+e.target.value}))}
                    className="inp" style={{width:70,textAlign:'right',fontSize:15}}/>{' '}%</>
                : <span style={{color:'#94a3b8'}}>—</span>
              }
            </td>
            <td style={{textAlign:'right',fontWeight:700,fontSize:16}}>
              {isMain
                ? <div style={{display:'inline-flex',flexDirection:'column',alignItems:'flex-end',gap:2}}>
                    <input type="number" value={mxMain[f] ?? ''} placeholder={String(autoMax(f))}
                      onChange={e=>setMxMain(p=>({...p,[f]:e.target.value}))}
                      className="inp" style={{width:95,textAlign:'right',fontSize:15,fontWeight:700}}/>
                    <span style={{fontSize:11,fontWeight:400,color: mxMain[f] ? '#c2410c' : '#94a3b8'}}>
                      {mxMain[f]
                        ? <>手動（自動為 {autoMax(f).toLocaleString()}）<button onClick={()=>setMxMain(p=>({...p,[f]:''}))} style={{marginLeft:4,fontSize:11,border:'none',background:'none',color:'#2563eb',cursor:'pointer',padding:0}}>恢復自動</button></>
                        : '自動計算'}
                    </span>
                  </div>
                : <><input type="number" value={mxSub[f] ?? 0}
                    onChange={e=>setMxSub(p=>({...p,[f]:+e.target.value}))}
                    className="inp" style={{width:85,textAlign:'right',fontSize:15}}/></>
              }
            </td>
            <td style={{textAlign:'right'}}>
              <input type="number" value={refill[f] ?? ''}
                onChange={e=>setRefill(p=>({...p,[f]:e.target.value}))}
                className="inp" style={{width:70,textAlign:'right',fontSize:15}}
                placeholder="—"/>{' '}%
            </td>
          </tr>
        )
      })}
    </>
  )

  return (
    <div>
      <Toast msg={toast} />
      <LoadError error={loadError} />

      {/* 上方：庫存盤點（成品倉庫管理科）＝ Excel「2.期初庫存量」 */}
      <div className="card">
        <div className="card-title" style={{flexWrap:'wrap',gap:8}}>
          <span>庫存盤點 <span style={{fontSize:14,color:'#94a3b8',fontWeight:400}}>成品倉庫管理科填寫 · 單位：包</span></span>
          {saveBar}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:8}}>
          <span style={{fontSize:14,color:'#475569',fontWeight:700}}>盤點日期（庫存日期）</span>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="inp" style={{width:160,fontSize:15}}/>
          <span style={{fontSize:13,color:'#94a3b8'}}>{wdOf(date)}</span>
          <span style={{fontSize:13,color:'#64748b'}}>生產排程會從盤點日的<strong>隔天</strong>開始預估</span>
          <span style={{fontSize:13,color:'#94a3b8',marginLeft:'auto'}}>滿福合計：<strong style={{color:'#1e293b'}}>{mainTotal.toLocaleString()}</strong> / {Number(maxCap).toLocaleString()} 包</span>
        </div>
        {staleDays !== null && staleDays > 7 && (
          <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:8,padding:'6px 12px',marginBottom:8,fontSize:13,color:'#9a3412'}}>
            ⚠ 盤點日期已是 {staleDays} 天前，生產排程的預估會從那天開始算，建議重新盤點後更新數字並存檔。
          </div>
        )}
        <div style={{overflowX:'auto'}}>
          <table className="tbl">
            <thead><tr>
              <th style={{fontSize:14}}>口味</th>
              <th style={{textAlign:'right',fontSize:14}}>現有庫存（包）</th>
              <th style={{textAlign:'right',fontSize:14}}>庫存上限</th>
              <th style={{textAlign:'right',fontSize:14}}>最低庫存<br/><span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>銷售計畫</span></th>
              <th style={{minWidth:130,fontSize:14}}>庫存／上限</th>
              <th style={{textAlign:'right',fontSize:14}}>每日預估<br/><span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>銷售計畫</span></th>
              <th style={{fontSize:14}}>狀態</th>
            </tr></thead>
            <tbody>
              {InvRows({ flavors: L.main, title: '主產品（水餃・餡餅・湯包）' })}
              {InvRows({ flavors: L.sub, title: '其他品項' })}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
          {['out','low','ok','high'].map(k => (
            <span key={k} className="bdg" style={{background:ST[k].bg,color:ST[k].tc,fontSize:13}}>{ST[k].label}</span>
          ))}
          <span style={{fontSize:12,color:'#94a3b8',alignSelf:'center'}}>（和生產排程的顏色相同）</span>
        </div>
        <AdjustLog logs={logs} />
      </div>

      {/* 下方：滿福庫存上限設定 */}
      <div className="card">
        <div className="card-title" style={{flexWrap:'wrap',gap:8}}>
          <span>滿福庫存上限設定 <span style={{fontSize:14,color:'#94a3b8',fontWeight:400}}>主管 / 銷貨科填寫</span></span>
          {saveBar}
        </div>
        <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#64748b',lineHeight:1.9}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
            <strong style={{color:'#334155'}}>滿福產品最高庫容量</strong>
            <input type="number" value={maxCap} onChange={e=>setMaxCap(e.target.value)} className="inp" style={{width:100,textAlign:'right',fontSize:15,fontWeight:700}}/> 包
          </div>
          庫存上限 = 最高庫容量 × 銷售比 × （1 + 上限增益%）<br/>
          銷售比、每日預估、最低庫存{salesRows ? '依「銷售計畫」自動帶入' : '目前用預設值（銷售計畫存檔後會自動改用銷售計畫的數字）'}<br/>
          主產品的庫存上限也可以直接手動輸入；清空（或按「恢復自動」）就回到公式自動計算<br/>
          其他品項沒有銷售比，庫存上限請直接手動輸入
        </div>
        <div style={{overflowX:'auto'}}>
          <table className="tbl">
            <thead><tr>
              <th style={{fontSize:14}}>口味</th>
              <th style={{textAlign:'right',fontSize:14}}>銷售比<br/><span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>自動計算</span></th>
              <th style={{textAlign:'right',fontSize:14}}>上限增益%<br/><span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>手動輸入</span></th>
              <th style={{textAlign:'right',fontSize:14}}>庫存上限（包）<br/><span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>自動/手動</span></th>
              <th style={{textAlign:'right',fontSize:14}}>可補充%<br/><span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>手動輸入</span></th>
            </tr></thead>
            <tbody>
              {UpperRows({ flavors: L.main, title: '主產品（水餃・餡餅・湯包）' })}
              {UpperRows({ flavors: L.sub, title: '其他品項' })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
