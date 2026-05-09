import { useState } from 'react'

const FL_MAIN = ['黃金','泡菜','咖哩','素花','新鮮','剝皮','酸白','原味']
const FL_SUB  = ['紅燒','藥膳','珍菇','香薑','猴菇','油飯']

const INIT_INV = {
  '黃金':{c:1941,mn:1716,mx:2770,d:83},'泡菜':{c:625,mn:638,mx:1281,d:38},
  '咖哩':{c:680,mn:347,mx:562,d:11}, '素花':{c:1754,mn:1194,mx:2016,d:60},
  '新鮮':{c:789,mn:571,mx:1382,d:41},'剝皮':{c:1299,mn:888,mx:1771,d:53},
  '酸白':{c:618,mn:424,mx:920,d:28}, '原味':{c:1585,mn:337,mx:1484,d:44},
  '紅燒':{c:70,mn:100,mx:300,d:4},  '藥膳':{c:31,mn:30,mx:200,d:1},
  '珍菇':{c:50,mn:50,mx:200,d:2},   '香薑':{c:26,mn:100,mx:200,d:6},
  '猴菇':{c:69,mn:50,mx:200,d:1},   '油飯':{c:60,mn:50,mx:150,d:3},
}

function gc(v, mn) {
  if (v <= 0) return 'c-gray'
  const r = v / mn
  if (r < 0.3) return 'c-red'
  if (r < 1)   return 'c-warn'
  if (r < 1.5) return 'c-low'
  if (r < 2.5) return 'c-ok'
  return 'c-full'
}
const CLS_LABEL = { 'c-full':'充足','c-ok':'充足','c-low':'偏低','c-warn':'紅燈','c-red':'緊急','c-gray':'灰燈' }
const CLS_BG    = { 'c-full':'#f0fdf4','c-ok':'#f0fdf4','c-low':'#fefce8','c-warn':'#fff7ed','c-red':'#fef2f2','c-gray':'#f8fafc' }
const CLS_TC    = { 'c-full':'#166534','c-ok':'#166534','c-low':'#713f12','c-warn':'#7c2d12','c-red':'#7f1d1d','c-gray':'#475569' }
const CLS_BAR   = { 'c-full':'#4ade80','c-ok':'#86efac','c-low':'#fde047','c-warn':'#fb923c','c-red':'#f87171','c-gray':'#cbd5e1' }

export default function InventoryPage() {
  const [inv, setInv] = useState(INIT_INV)
  const [dateStr, setDateStr] = useState('2026/05/07')

  const total = Object.values(inv).reduce((s, b) => s + b.c, 0)

  const InvRows = ({ flavors, title }) => (
    <>
      <tr><td colSpan={7} className="sec-head">{title}</td></tr>
      {flavors.map(f => {
        const b = inv[f]
        const pct = Math.min(100, Math.round(b.c / b.mx * 100))
        const cls = gc(b.c, b.mn)
        return (
          <tr key={f}>
            <td style={{ fontWeight: 700 }}>{f}</td>
            <td style={{ textAlign: 'right' }}>
              <input type="number" value={b.c} onChange={e => setInv(d => ({ ...d, [f]: { ...d[f], c: +e.target.value } }))} className="inp" style={{ width: 75, textAlign: 'right' }} />
            </td>
            <td style={{ textAlign: 'right', color: '#64748b', fontSize: 12 }}>{b.mx.toLocaleString()}</td>
            <td style={{ textAlign: 'right', color: '#64748b', fontSize: 12 }}>{b.mn.toLocaleString()}</td>
            <td style={{ minWidth: 110 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#e2e8f0', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: CLS_BAR[cls], borderRadius: 3 }}></div>
                </div>
                <span style={{ fontSize: 10, color: '#94a3b8', minWidth: 28 }}>{pct}%</span>
              </div>
            </td>
            <td style={{ textAlign: 'right', color: '#94a3b8', fontSize: 11 }}>{b.d}包/日</td>
            <td><span className="bdg" style={{ background: CLS_BG[cls], color: CLS_TC[cls] }}>{CLS_LABEL[cls]}</span></td>
          </tr>
        )
      })}
    </>
  )

  return (
    <div>
      <div className="card">
        <div className="card-title">
          庫存盤點
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>盤點日期</span>
            <input type="text" value={dateStr} onChange={e => setDateStr(e.target.value)} className="inp" style={{ width: 100, fontSize: 12 }} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>最高容量 12,000包 · 現有 {total.toLocaleString()} 包</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>口味</th>
              <th style={{ textAlign: 'right' }}>現有庫存（包）</th>
              <th style={{ textAlign: 'right' }}>滿福上限</th>
              <th style={{ textAlign: 'right' }}>最低庫存</th>
              <th style={{ minWidth: 120 }}>庫存視覺化</th>
              <th style={{ textAlign: 'right' }}>每日消耗</th>
              <th>狀態</th>
            </tr></thead>
            <tbody>
              <InvRows flavors={FL_MAIN} title="主產品（水餃・餡餅・湯包）" />
              <InvRows flavors={FL_SUB}  title="副產品" />
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {[['#f0fdf4','#166534','充足'],['#fefce8','#713f12','偏低'],['#fff7ed','#7c2d12','紅燈'],['#fef2f2','#7f1d1d','緊急'],['#f8fafc','#475569','灰燈']].map(([bg,tc,l]) => (
            <span key={l} className="bdg" style={{ background: bg, color: tc }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
