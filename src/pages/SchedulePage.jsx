import { useState, useMemo, useCallback } from 'react'

const PPB = { '黃金':240,'泡菜':240,'咖哩':240,'素花':230,'新鮮':320,'剝皮':330,'酸白':330,'原味':400,'紅燒':87,'藥膳':79,'珍菇':77,'香薑':105,'猴菇':100,'油飯':70 }
const MAIN = ['黃金','泡菜','咖哩','素花','新鮮','剝皮','酸白','原味']
const SUB  = ['紅燒','藥膳','珍菇','香薑','猴菇','油飯']
const FL   = [...MAIN, ...SUB]
const SP   = { '紅燒':'剝皮（共用根菜）','藥膳':'原味（同批）','珍菇':'新鮮（同日）','香薑':'黃金（相近）','猴菇':'泡菜（同日）','油飯':'素花（間隙）' }
const ITEM_VEG = { '黃金':'玉米','泡菜':'高麗菜','素花':'花椰菜','新鮮':'青江菜','酸白':'高麗菜','原味':'大白菜' }

const BI = {
  '黃金':{c:1941,mn:1716,mx:2770,d:83},'泡菜':{c:625,mn:638,mx:1281,d:38},
  '咖哩':{c:680,mn:347,mx:562,d:11}, '素花':{c:1754,mn:1194,mx:2016,d:60},
  '新鮮':{c:789,mn:571,mx:1382,d:41},'剝皮':{c:1299,mn:888,mx:1771,d:53},
  '酸白':{c:618,mn:424,mx:920,d:28}, '原味':{c:1585,mn:337,mx:1484,d:44},
  '紅燒':{c:70,mn:100,mx:300,d:4},  '藥膳':{c:31,mn:30,mx:200,d:1},
  '珍菇':{c:50,mn:50,mx:200,d:2},   '香薑':{c:26,mn:100,mx:200,d:6},
  '猴菇':{c:69,mn:50,mx:200,d:1},   '油飯':{c:60,mn:50,mx:150,d:3},
}

const WD = ['日','一','二','三','四','五','六']
const DATES = []
const B0 = new Date('2026-05-08')
for (let i = 0; i < 45; i++) {
  const d = new Date(B0); d.setDate(d.getDate() + i)
  const m = d.getMonth()+1, dy = d.getDate(), w = d.getDay()
  DATES.push({ k: `${m}/${dy}`, lb: `${m}/${dy} 週${WD[w]}`, mo: m, we: w===0||w===6 })
}

function nm(s) { if (!s) return null; const p = s.replace(/\s/g,'').split('/'); if (p.length!==2) return null; return `${parseInt(p[0])}/${parseInt(p[1])}` }
function gc(v,mn) { if(v<=0)return'c-gray'; const r=v/mn; if(r<0.3)return'c-red'; if(r<1)return'c-warn'; if(r<1.5)return'c-low'; if(r<2.5)return'c-ok'; return'c-full' }
function gb(v,mn) { return Math.min(100, Math.round(v/mn*50)) }

const INIT_SCH = [
  {date:'5/9',item:'剝皮',barrels:4,inDate:'5/10'},{date:'5/10',item:'黃金',barrels:3,inDate:'5/11'},
  {date:'5/11',item:'紅燒',barrels:1,inDate:'5/11'},{date:'5/12',item:'泡菜',barrels:4,inDate:'5/13'},
  {date:'5/13',item:'酸白',barrels:4,inDate:'5/14'},{date:'5/14',item:'素花',barrels:4,inDate:'5/15'},
  {date:'5/19',item:'黃金',barrels:4,inDate:'5/20'},{date:'5/22',item:'新鮮',barrels:4,inDate:'5/23'},
]
const INIT_RULES = [
  '素花3天內做完，越貴不貴。','根菜系列盡量一起做，確保500kg以上。',
  '備料不可超過3天（原油除外）。','叫菜單低於30件先提採購討論。',
  '每週五不入庫存，需要排程。','相同原料盡量同批生產。','淡旺季庫存與轉換次序都重要。',
]
const INIT_VEG = [
  {name:'青江菜',price:'',thresh:60},{name:'高麗菜',price:'',thresh:30},
  {name:'花椰菜',price:'',thresh:50},{name:'玉米',price:'',thresh:40},{name:'大白菜',price:'',thresh:25},
]

export default function SchedulePage() {
  const [schData, setSchData] = useState(INIT_SCH)
  const [rules, setRules] = useState(INIT_RULES)
  const [ruleEdit, setRuleEdit] = useState(false)
  const [vegData, setVegData] = useState(INIT_VEG)
  const [extraRules, setExtraRules] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // 模擬客訂扣除
  const orderDeductions = { '黃金': 480, '泡菜': 240, '素花': 460 }

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
      const b = BI[f]; if (!b) return
      const deduct = orderDeductions[f] || 0
      let run = Math.max(0, b.c - deduct)
      res[f] = DATES.map(d => {
        run -= b.d
        if (im[d.k]?.[f]) run += im[d.k][f]
        run = Math.max(0, run)
        return { v: Math.round(run), p: !!(pm[d.k]?.has(f)) }
      })
    })
    return res
  }, [schData])

  const invTable = useMemo(() => cInv(), [cInv])
  const tot = schData.reduce((s, r) => s + (PPB[r.item]||0) * (r.barrels||0), 0)
  const updateSch = (i, k, v) => { const n = [...schData]; n[i] = { ...n[i], [k]: v }; setSchData(n) }

  const deductSummary = Object.entries(orderDeductions).filter(([,v]) => v > 0)

  const runAI = () => {
    setAiLoading(true); setAiText('')
    setTimeout(() => {
      const data = cInv()
      const highVeg = vegData.filter(v => parseFloat(v.price) > v.thresh && v.name)
      const priceWarn = new Set()
      highVeg.forEach(v => { Object.entries(ITEM_VEG).forEach(([item, veg]) => { if (veg === v.name) priceWarn.add(item) }) })
      const az = f => {
        const b = BI[f]; if (!b || !data[f]) return { has: false }
        let fw = -1, fr = -1
        data[f].forEach(({ v }, di) => { const c = gc(v,b.mn); if(c==='c-warn'&&fw<0)fw=di; if((c==='c-red'||c==='c-gray')&&fr<0)fr=di })
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
      else { mi.forEach(({ f, di, urg, need, pbt, pd }) => { const wd = DATES[di]?.lb||'—', sd = DATES[pd]?.lb||'—'; txt += `• ${urg?'[緊急]':'[偏低]'} ${f}：建議 ${sd} 前排 ${need} 桶（+${(need*pbt).toLocaleString()}包）\n  ${wd} 起庫存${urg?'緊急不足':'偏低'}。現 ${BI[f].c.toLocaleString()} 包，日耗 ${BI[f].d} 包，最低 ${BI[f].mn.toLocaleString()} 包。${priceWarn.has(f)?'⚠ 菜價偏高，請確認成本。':''}\n` }) }
      txt += '\n【副產品建議（搭配主產品同日排入）】\n'
      if (si.length === 0) { txt += '✓ 副產品庫存充足\n' }
      else { si.forEach(({ f, di, urg, need, pbt, pd }) => { const wd = DATES[di]?.lb||'—', sd = DATES[pd]?.lb||'—'; txt += `• ${urg?'[緊急]':'[偏低]'} ${f}（副）：建議 ${sd} 前搭配 ${SP[f]||'主產品'}，排 ${need} 桶。\n  ${wd} 起庫存${urg?'不足':'偏低'}，現 ${BI[f].c.toLocaleString()} 包。\n` }) }
      if (sok.length > 0) txt += `✓ 充足副產品：${sok.join('、')} 可彈性安排。\n`
      txt += '\n【原料群組建議】\n• 紅燒＋剝皮：共用根菜類原料，建議同批次節省換料\n• 素花系列：間隔不超過3天，越貴不貴\n• 副產品原則：主產品桶數少（1-2桶）時同日排入，不佔整天'
      setAiText(txt); setAiLoading(false)
    }, 1400)
  }

  // 庫存預估表 HTML
  const invHTML = useMemo(() => {
    let h = '<thead><tr>'
    h += `<th style="text-align:left;position:sticky;left:0;top:0;z-index:4;min-width:76px;background:#f8fafc">日期</th>`
    FL.forEach((f, fi) => {
      const hasSch = schData.some(r => r.item === f)
      const isSub = SUB.includes(f)
      const fsub = fi === MAIN.length
      const deduct = orderDeductions[f] || 0
      h += `<th class="${hasSch ? 'hs' : ''}" style="${fsub ? 'border-left:3px solid #94a3b8!important' : ''}">${f}${deduct > 0 ? `<br><span style="font-size:8px;color:#ef4444;background:#fef2f2;border-radius:2px;padding:0 2px">-${deduct}</span>` : ''}${isSub ? '<br><span style="font-size:8px;background:#ede9fe;color:#5b21b6;border-radius:2px;padding:0 2px">副</span>' : ''}${hasSch ? `<br><span style="font-size:8px;background:${isSub ? '#5b21b6' : '#1e293b'};color:#fff;border-radius:2px;padding:0 3px">排</span>` : ''}</th>`
    })
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
        const b = BI[f] || { mn: 1 }
        const cls = gc(v, b.mn); const pct = gb(v, b.mn)
        const fsub = fi === MAIN.length
        h += `<td class="ic ${cls}${p ? ' hp' : ''}" style="${fsub ? 'border-left:3px solid #94a3b8!important' : ''}"><div class="ci"><div class="cn">${v.toLocaleString()}</div><div class="bw"><div class="bf" style="width:${pct}%"></div></div></div></td>`
      })
      h += '</tr>'
    })
    h += '</tbody>'
    return h
  }, [invTable, schData])

  return (
    <div>
      {/* 客訂扣除提示 */}
      {deductSummary.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 15, color: '#7f1d1d' }}>
          <strong>客訂庫存扣除：</strong> {deductSummary.map(([f, v]) => `${f} -${v}包`).join(' · ')}（未出貨客訂已從預估庫存扣除）
        </div>
      )}

      {/* 庫存預估（上） */}
      <div className="card">
        <div className="card-title">
          庫存預估（自動更新）
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {[['#f0fdf4','#166534','充足'],['#fefce8','#713f12','偏低'],['#fff7ed','#7c2d12','紅燈'],['#fef2f2','#7f1d1d','緊急'],['#f8fafc','#475569','灰燈']].map(([bg,tc,l]) => (
              <span key={l} className="bdg" style={{ background: bg, color: tc, fontSize: 15 }}>{l}</span>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
          <table className="it" dangerouslySetInnerHTML={{ __html: invHTML }}></table>
        </div>
        <div style={{ fontSize: 15, color: '#94a3b8', marginTop: 5 }}>粗框=當日入庫 · 條=庫存/最低庫存 · 雙線=月份 · ║=主∣副 · 紅字=客訂扣除</div>
      </div>

      {/* 排程輸入（中） */}
      <div className="card">
        <div className="card-title">
          排程輸入
          <span style={{ fontSize: 14, color: '#64748b', fontWeight: 400 }}>合計 <strong style={{ color: '#1e293b' }}>{tot > 0 ? `${tot.toLocaleString()}包` : '—'}</strong></span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ fontSize: 15 }}>
            <thead><tr>
              <th style={{ width: 54 }}>生產日</th>
              <th style={{ width: 82 }}>品項</th>
              <th style={{ width: 78, textAlign: 'center' }}>桶數</th>
              <th style={{ width: 48, textAlign: 'right' }}>包數</th>
              <th style={{ width: 54 }}>入庫日</th>
              <th style={{ width: 20 }}></th>
            </tr></thead>
            <tbody>
              {schData.map((r, i) => {
                const pk = (PPB[r.item]||0) * (r.barrels||0)
                const isSub = SUB.includes(r.item)
                return (
                  <tr key={i} style={{ background: isSub ? 'rgba(109,40,217,.04)' : 'transparent' }}>
                    <td><input className="inp" value={r.date} style={{ width: 48, fontSize: 14 }} onChange={e => updateSch(i, 'date', e.target.value)} /></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {isSub && <span style={{ fontSize: 8, background: '#ede9fe', color: '#5b21b6', borderRadius: 2, padding: '1px 3px', flexShrink: 0 }}>副</span>}
                        <select className="inp" style={{ width: isSub ? 58 : 70, fontSize: 14 }} value={r.item} onChange={e => updateSch(i, 'item', e.target.value)}>
                          <optgroup label="主產品">{MAIN.map(f => <option key={f}>{f}</option>)}</optgroup>
                          <optgroup label="副產品">{SUB.map(f => <option key={f}>{f}</option>)}</optgroup>
                        </select>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <button onClick={() => updateSch(i, 'barrels', Math.max(1, r.barrels-1))} style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>−</button>
                        <span style={{ fontSize: 14, fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{r.barrels}</span>
                        <button onClick={() => updateSch(i, 'barrels', r.barrels+1)} style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#fff', fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>＋</button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, paddingRight: 5 }}>{pk > 0 ? pk.toLocaleString() : '—'}</td>
                    <td><input className="inp" value={r.inDate||''} style={{ width: 46, fontSize: 14 }} onChange={e => updateSch(i, 'inDate', e.target.value)} /></td>
                    <td><button onClick={() => setSchData(d => d.filter((_,j) => j!==i))} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>×</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button onClick={() => setSchData(d => [...d, { date: '', item: '黃金', barrels: 4, inDate: '' }])} style={{ marginTop: 8, fontSize: 14, color: '#94a3b8', background: 'none', border: '1px dashed #e2e8f0', borderRadius: 7, padding: '5px 0', cursor: 'pointer', width: '100%' }}>+ 新增排程列</button>
      </div>

      {/* AI 建議（下） */}
      <div className="card">
        <div className="card-title">AI 排程建議<button className="btn btn-dark btn-sm" onClick={runAI}>重新分析</button></div>

        <details style={{ marginBottom: 10 }}>
          <summary>原料菜價管理（各蔬菜可自設飆漲標準）</summary>
          <div style={{ marginTop: 8, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px 78px 50px 28px', gap: 5, marginBottom: 5, paddingBottom: 4, borderBottom: '1px solid #e2e8f0' }}>
              {['蔬菜','本週價(元/kg)','飆漲標準','狀態',''].map(h => <span key={h} style={{ fontSize: 15, fontWeight: 700, color: '#64748b' }}>{h}</span>)}
            </div>
            {vegData.map((v, i) => {
              const p = parseFloat(v.price)||0; const high = p>0 && p>v.thresh
              return (
                <div key={i} className="veg-row">
                  <input className="inp" value={v.name} style={{ fontSize: 14 }} onChange={e => { const n=[...vegData]; n[i]={...n[i],name:e.target.value}; setVegData(n) }} />
                  <input type="number" className="inp" value={v.price} placeholder="價格" style={{ fontSize: 14, borderColor: high ? '#f87171' : '', background: high ? '#fef2f2' : '' }} onChange={e => { const n=[...vegData]; n[i]={...n[i],price:e.target.value}; setVegData(n) }} />
                  <input type="number" className="inp" value={v.thresh} style={{ fontSize: 14 }} onChange={e => { const n=[...vegData]; n[i]={...n[i],thresh:+e.target.value}; setVegData(n) }} />
                  <span className="bdg" style={{ fontSize: 15, background: p>0?(high?'#fef2f2':'#f0fdf4'):'#f8fafc', color: p>0?(high?'#7f1d1d':'#166534'):'#94a3b8' }}>{p>0?(high?'飆漲':'正常'):'—'}</span>
                  <button className="btn btn-sm btn-red" onClick={() => setVegData(d => d.filter((_,j) => j!==i))}>刪</button>
                </div>
              )
            })}
            <button className="btn btn-sm" onClick={() => setVegData(d => [...d, { name: '', price: '', thresh: 50 }])} style={{ marginTop: 8, borderStyle: 'dashed', width: '100%' }}>+ 新增蔬菜</button>
          </div>
        </details>

        <details style={{ marginBottom: 10 }}>
          <summary>補充規則 ／ 排程規則管理</summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <textarea className="inp" value={extraRules} onChange={e => setExtraRules(e.target.value)} placeholder={`補充本週特殊狀況，例如：\n· 青江菜飆漲，綠蔬先暫緩\n· 下週大客單，多備黃金泡菜`} />
            <div style={{ fontSize: 14, fontWeight: 700, color: '#64748b' }}>排程規則（可編輯）</div>
            {rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #f8fafc' }}>
                <span style={{ fontSize: 15, color: '#94a3b8', minWidth: 16 }}>{i+1}.</span>
                {ruleEdit
                  ? <><input className="inp" value={r} style={{ flex: 1, fontSize: 14 }} onChange={e => { const n=[...rules]; n[i]=e.target.value; setRules(n) }} /><button className="btn btn-sm btn-red" onClick={() => setRules(r2 => r2.filter((_,j) => j!==i))}>刪</button></>
                  : <span style={{ flex: 1, fontSize: 15 }}>{r}</span>
                }
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setRuleEdit(!ruleEdit)}>{ruleEdit ? '完成' : '編輯規則'}</button>
              {ruleEdit && <button className="btn btn-sm" onClick={() => setRules(r => [...r, '新規則'])}>+ 新增</button>}
            </div>
          </div>
        </details>

        {aiLoading && <div style={{ fontSize: 15, color: '#94a3b8', padding: '6px 0' }}>分析中...</div>}
        {aiText && <pre style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'Noto Sans TC,sans-serif', color: '#1e293b', background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginTop: 4 }}>{aiText}</pre>}
        {!aiLoading && !aiText && <div style={{ fontSize: 15, color: '#94a3b8', padding: '6px 0' }}>點「重新分析」產生 AI 建議排程</div>}
      </div>
    </div>
  )
}
