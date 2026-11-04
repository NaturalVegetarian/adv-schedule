import { useState, useEffect, useMemo } from 'react'
import { loadPage, loadLogs, savePage, SaveBar, AdjustLog, LoadError, Toast } from '../lib/pageSave'

const FL_MAIN = ['黃金','泡菜','咖哩','素花','新鮮','剝皮','酸白','原味']
const FL_SUB  = ['紅燒','藥膳','珍菇','香羹','猴菇','油飯']
const ALL     = [...FL_MAIN, ...FL_SUB]
const MAX_CAP = 12000

const DAILY = {黃金:83,泡菜:38,咖哩:11,素花:60,新鮮:41,剝皮:53,酸白:28,原味:44,紅燒:4,藥膳:1,珍菇:2,香羹:6,猴菇:1,油飯:3}
const INIT_CUR = {黃金:1941,泡菜:625,咖哩:680,素花:1754,新鮮:789,剝皮:1299,酸白:618,原味:1585,紅燒:70,藥膳:31,珍菇:50,香羹:26,猴菇:69,油飯:60}
const INIT_MN  = {黃金:1716,泡菜:638,咖哩:347,素花:1194,新鮮:571,剝皮:888,酸白:424,原味:337,紅燒:100,藥膳:30,珍菇:50,香羹:100,猴菇:50,油飯:50}
const INIT_MX_SUB = {紅燒:300,藥膳:200,珍菇:200,香羹:200,猴菇:200,油飯:150}

const todayStr = () => { const t = new Date(); return `${t.getFullYear()}/${String(t.getMonth()+1).padStart(2,'0')}/${String(t.getDate()).padStart(2,'0')}` }

// 存檔前統一格式，方便比對與存放
const normInv = s => ({
  date: s.date || '',
  inv:    Object.fromEntries(ALL.map(f => [f, Number(s.inv?.[f]) || 0])),
  bonus:  Object.fromEntries(FL_MAIN.map(f => [f, Number(s.bonus?.[f]) || 0])),
  mxSub:  Object.fromEntries(FL_SUB.map(f => [f, Number(s.mxSub?.[f]) || 0])),
  mxMain: Object.fromEntries(FL_MAIN.map(f => [f, s.mxMain?.[f] === '' || s.mxMain?.[f] == null ? '' : String(s.mxMain[f])])), // 主產品手動上限，空白＝自動
  refill: Object.fromEntries(ALL.map(f => [f, s.refill?.[f] === '' || s.refill?.[f] == null ? '' : String(s.refill[f])])),
})

// 比對上次存檔與目前內容，產生「調整了什麼」的文字
function diffInv(p, c) {
  const out = []
  if (p.date !== c.date) out.push(`盤點日期 ${p.date || '—'} → ${c.date || '—'}`)
  ALL.forEach(f => { if (p.inv[f] !== c.inv[f]) out.push(`${f} 現有庫存 ${p.inv[f]} → ${c.inv[f]}`) })
  FL_MAIN.forEach(f => { if (p.bonus[f] !== c.bonus[f]) out.push(`${f} 上限增益 ${p.bonus[f]}% → ${c.bonus[f]}%`) })
  FL_MAIN.forEach(f => { if (p.mxMain[f] !== c.mxMain[f]) out.push(`${f} 庫存上限 ${p.mxMain[f] || '自動'} → ${c.mxMain[f] || '自動'}`) })
  FL_SUB.forEach(f => { if (p.mxSub[f] !== c.mxSub[f]) out.push(`${f} 庫存上限 ${p.mxSub[f]} → ${c.mxSub[f]}`) })
  ALL.forEach(f => { if (p.refill[f] !== c.refill[f]) out.push(`${f} 可補充 ${p.refill[f] || '—'}% → ${c.refill[f] || '—'}%`) })
  return out
}

const totalD = FL_MAIN.reduce((s,f) => s + DAILY[f], 0)

function gc(v,mn){if(v<=0)return'g';const r=v/mn;if(r<0.3)return'r';if(r<1)return'w';if(r<1.5)return'l';if(r<2.5)return'o';return'f'}
const BG={f:'#f0fdf4',o:'#f0fdf4',l:'#fefce8',w:'#fff7ed',r:'#fef2f2',g:'#f8fafc'}
const TC={f:'#166534',o:'#166534',l:'#713f12',w:'#7c2d12',r:'#7f1d1d',g:'#475569'}
const BAR={f:'#4ade80',o:'#86efac',l:'#fde047',w:'#fb923c',r:'#f87171',g:'#cbd5e1'}
const LBL={f:'充足',o:'充足',l:'偏低',w:'紅燈',r:'緊急',g:'灰燈'}

export default function InventoryPage() {
  const [inv,  setInv]  = useState(INIT_CUR)
  const [mn,   setMn]   = useState(INIT_MN)
  const [date, setDate] = useState(todayStr)
  const [bonus,  setBonus]  = useState(Object.fromEntries(FL_MAIN.map(f=>[f,0])))
  const [mxSub,  setMxSub]  = useState(INIT_MX_SUB)
  const [mxMain, setMxMain] = useState(Object.fromEntries(FL_MAIN.map(f=>[f,''])))
  const [refill, setRefill] = useState(Object.fromEntries(ALL.map(f=>[f,''])))

  // 存檔相關
  const [saved, setSaved] = useState(() => normInv({ date: todayStr(), inv: INIT_CUR, bonus: {}, mxSub: INIT_MX_SUB, refill: {} }))
  const [lastSaved, setLastSaved] = useState(null)
  const [logs, setLogs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const flash = m => { setToast(m); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    (async () => {
      const { data, error } = await loadPage('inventory')
      if (error) { setLoadError(error.message); return }
      if (data?.data) {
        const n = normInv(data.data)
        setDate(n.date); setInv(n.inv); setBonus(n.bonus); setMxSub(n.mxSub); setMxMain(n.mxMain); setRefill(n.refill)
        setSaved(n); setLastSaved(data.updated_at)
      }
      const lg = await loadLogs('inventory')
      setLogs(lg.data)
      setLoaded(true)
    })()
  }, [])

  const current = useMemo(() => normInv({ date, inv, bonus, mxSub, mxMain, refill }), [date, inv, bonus, mxSub, mxMain, refill])
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

  // 主產品：公式自動算；有手動填值就用手動值
  const autoMax = f => Math.round(MAX_CAP * (DAILY[f]/totalD) * (1+(bonus[f]||0)/100))
  const calcMax = f => FL_MAIN.includes(f)
    ? (mxMain[f] !== '' && mxMain[f] != null ? (Number(mxMain[f]) || 0) : autoMax(f))
    : (mxSub[f] || 300)

  const total = ALL.reduce((s,f) => s + (inv[f]||0), 0)

  const InvRows = ({ flavors, title }) => (
    <>
      <tr><td colSpan={7} className="sec-head">{title}</td></tr>
      {flavors.map(f => {
        const v = inv[f]||0, m = mn[f]||0, mx = calcMax(f)
        const pct = Math.min(100, Math.round(v/mx*100))
        const cls = gc(v,m)
        return (
          <tr key={f}>
            <td style={{fontWeight:700,fontSize:16}}>{f}</td>
            <td style={{textAlign:'right'}}>
              <input type="number" value={v}
                onChange={e=>setInv(d=>({...d,[f]:+e.target.value}))}
                className="inp" style={{width:85,textAlign:'right',fontSize:15}}/>
            </td>
            <td style={{textAlign:'right',color:'#64748b',fontSize:14}}>{mx.toLocaleString()}</td>
            <td style={{textAlign:'right',color:'#64748b',fontSize:14}}>{m.toLocaleString()}</td>
            <td style={{minWidth:130}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <div style={{flex:1,height:7,borderRadius:4,background:'#e2e8f0',overflow:'hidden'}}>
                  <div style={{width:`${pct}%`,height:'100%',background:BAR[cls],borderRadius:4}}/>
                </div>
                <span style={{fontSize:12,color:'#94a3b8',minWidth:32}}>{pct}%</span>
              </div>
            </td>
            <td style={{textAlign:'right',color:'#94a3b8',fontSize:13}}>{DAILY[f]}包/日</td>
            <td><span className="bdg" style={{background:BG[cls],color:TC[cls],fontSize:13}}>{LBL[cls]}</span></td>
          </tr>
        )
      })}
    </>
  )

  const UpperRows = ({ flavors, title }) => (
    <>
      <tr><td colSpan={5} className="sec-head">{title}</td></tr>
      {flavors.map(f => {
        const isMain = FL_MAIN.includes(f)
        const ratio  = isMain ? (DAILY[f]/totalD*100).toFixed(2) : null
        const mx     = calcMax(f)
        return (
          <tr key={f}>
            <td style={{fontWeight:700,fontSize:16}}>{f}</td>
            <td style={{textAlign:'right',color:'#64748b',fontSize:15}}>
              {ratio !== null ? `${ratio}%` : '—'}
            </td>
            <td style={{textAlign:'right'}}>
              {isMain
                ? <><input type="number" value={bonus[f]||0}
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
                : <><input type="number" value={mxSub[f]||0}
                    onChange={e=>setMxSub(p=>({...p,[f]:+e.target.value}))}
                    className="inp" style={{width:85,textAlign:'right',fontSize:15}}/></>
              }
            </td>
            <td style={{textAlign:'right'}}>
              <input type="number" value={refill[f]||''}
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
      {/* 上方：庫存盤點（倉儲） */}
      <div className="card">
        <div className="card-title">
          庫存盤點
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:13,color:'#64748b',fontWeight:400}}>倉儲填寫</span>
            <span style={{fontSize:13,color:'#94a3b8'}}>盤點日期</span>
            <input type="text" value={date} onChange={e=>setDate(e.target.value)}
              className="inp" style={{width:110,fontSize:14}}/>
            <span style={{fontSize:13,color:'#94a3b8'}}>現有：{total.toLocaleString()}包</span>
            <SaveBar lastSaved={lastSaved} dirty={loaded && changes.length > 0} saving={saving} disabled={!loaded} onSave={onSave} />
          </div>
        </div>
        <div style={{overflowX:'auto'}}>
          <table className="tbl">
            <thead><tr>
              <th style={{fontSize:14}}>口味</th>
              <th style={{textAlign:'right',fontSize:14}}>現有庫存（包）</th>
              <th style={{textAlign:'right',fontSize:14}}>庫存上限</th>
              <th style={{textAlign:'right',fontSize:14}}>最低庫存</th>
              <th style={{minWidth:130,fontSize:14}}>庫存視覺化</th>
              <th style={{textAlign:'right',fontSize:14}}>每日消耗</th>
              <th style={{fontSize:14}}>狀態</th>
            </tr></thead>
            <tbody>
              {/* 用函式呼叫而不是 <InvRows/>，避免每打一個字整列重建、游標跑掉跳回頂端 */}
              {InvRows({ flavors: FL_MAIN, title: '主產品（水餃・餡餅・湯包）' })}
              {InvRows({ flavors: FL_SUB, title: '副產品' })}
            </tbody>
          </table>
        </div>
        <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
          {[['#f0fdf4','#166534','充足'],['#fefce8','#713f12','偏低'],['#fff7ed','#7c2d12','紅燈'],['#fef2f2','#7f1d1d','緊急'],['#f8fafc','#475569','灰燈']].map(([bg,tc,l])=>(
            <span key={l} className="bdg" style={{background:bg,color:tc,fontSize:13}}>{l}</span>
          ))}
        </div>
        <AdjustLog logs={logs} />
      </div>

      {/* 下方：滿福庫存上限設定（主管/行銷） */}
      <div className="card">
        <div className="card-title">
          滿福庫存上限設定
          <span style={{fontSize:14,color:'#64748b',fontWeight:400}}>主管 / 行銷科填寫 · 修改後請按上方 💾 存檔</span>
        </div>
        <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#64748b',lineHeight:1.8}}>
          庫存上限 = 最高容量（12,000包）× 銷售比 × （1 + 上限增益%）<br/>
          主產品的庫存上限也可以直接手動輸入；清空（或按「恢復自動」）就回到公式自動計算<br/>
          副產品沒有銷售比，庫存上限請直接手動輸入
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
              {UpperRows({ flavors: FL_MAIN, title: '主產品（水餃・餡餅・湯包）' })}
              {UpperRows({ flavors: FL_SUB, title: '副產品' })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
