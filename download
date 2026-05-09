import { useState, useMemo } from 'react'

const WD = ['日','一','二','三','四','五','六']

function getNextDow(base, dow) {
  const d = new Date(base)
  let diff = dow - d.getDay()
  if (diff <= 0) diff += 7
  d.setDate(d.getDate() + diff)
  return d
}
function fmtMD(d) { return (d.getMonth()+1) + '/' + d.getDate() }
function fmtWD(d) { return '週' + WD[d.getDay()] }

const ICONS = { work:'📋', dry:'🧂', pkg:'📦', cold:'🧊', norm:'🌡️', add:'🧪', freeze:'❄️' }

export default function PickingPage() {
  const [orderDate, setOrderDate] = useState('2026/5/8')
  const [orderName, setOrderName] = useState('生產工單')
  const [copied, setCopied] = useState('')

  const types = useMemo(() => {
    const base = new Date(orderDate.replace(/\//g, '-'))
    if (isNaN(base.getTime())) return []
    const nMon = getNextDow(base, 1)
    const nTue = getNextDow(base, 2)
    const nWed = getNextDow(base, 3)
    const nFri = new Date(nMon); nFri.setDate(nMon.getDate() + 4)
    const nSat = new Date(nMon); nSat.setDate(nMon.getDate() + 5)
    const nMon2 = new Date(nMon); nMon2.setDate(nMon.getDate() + 7)
    const nTue2 = new Date(nTue); nTue2.setDate(nTue.getDate() + 7)
    const nWed2 = new Date(nWed); nWed2.setDate(nWed.getDate() + 7)

    return [
      { key:'work',   label: orderName, isWork: true,  s: nMon, e: nSat,  note:'建立日期', wh: [] },
      { key:'dry',    label:'乾粉',      isWork: false, s: nMon, e: nFri,  note:'領出日期', wh:[{code:'B2N2',name:'乾粉儲藏庫'}] },
      { key:'pkg',    label:'包材',      isWork: false, s: nMon, e: nFri,  note:'領出日期', wh:[{code:'A2N3',name:'貼紙包裝區'}] },
      { key:'cold',   label:'冷藏',      isWork: false, s: nTue, e: nMon2, note:'領出日期', wh:[{code:'A1C1',name:'原料冷藏庫'}] },
      { key:'norm',   label:'常溫',      isWork: false, s: nTue, e: nMon2, note:'領出日期', wh:[{code:'A2N1',name:'元次料常溫庫'}] },
      { key:'add',    label:'添加物',    isWork: false, s: nTue, e: nMon2, note:'領出日期', wh:[{code:'A2N5',name:'食品添加物區'}] },
      { key:'freeze', label:'冷凍',      isWork: false, s: nWed, e: nTue2, note:'領出日期', wh:[{code:'A1C3',name:'原料冷凍庫'}] },
    ]
  }, [orderDate, orderName])

  function cp(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    })
  }

  return (
    <div>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}>輸入工單資訊</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontWeight: 700 }}>工單打單日</div>
            <input type="text" value={orderDate} onChange={e => setOrderDate(e.target.value)} className="inp" placeholder="2026/5/8" />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontWeight: 700 }}>工單名稱</div>
            <input type="text" value={orderName} onChange={e => setOrderName(e.target.value)} className="inp" placeholder="生產工單" />
          </div>
        </div>
      </div>

      {types.map(t => {
        const erpText = t.isWork
          ? `${fmtMD(t.s)}~${fmtMD(t.e)}${orderName}使用`
          : `${fmtMD(t.s)}~${fmtMD(t.e)}生產使用`
        const erpKey = `erp-${t.key}`

        return (
          <div key={t.key} className="pick-block">
            <div className="pick-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{ICONS[t.key]}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{t.label}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{t.note}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 14px' }}>
              {/* 大字日期 */}
              <div style={{ marginBottom: 10 }}>
                <div className="big-date">
                  {fmtMD(t.s)} <span style={{ fontSize: 16, fontWeight: 400, color: '#94a3b8' }}>→</span> {fmtMD(t.e)}
                </div>
                <div className="big-sub">{fmtWD(t.s)} ～ {fmtWD(t.e)}</div>
              </div>

              {/* ERP 日期文字 — 一個複製按鈕 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '8px 10px', borderRadius: 8, marginBottom: t.wh.length > 0 ? 6 : 0 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#2563eb' }}>{erpText}</span>
                <button onClick={() => cp(erpText, erpKey)}
                  style={{ fontSize: 11, padding: '4px 11px', borderRadius: 8, border: '1px solid #e2e8f0', background: copied===erpKey?'#1e293b':'#fff', color: copied===erpKey?'#fff':'#475569', fontWeight: 700, cursor: 'pointer', transition: 'all .12s', flexShrink: 0, marginLeft: 8 }}>
                  {copied===erpKey ? '✓ 已複製' : '複製'}
                </button>
              </div>

              {/* 倉庫位置 — 分開複製，只複製英文代號 */}
              {t.wh.map((w, wi) => {
                const locKey = `loc-${t.key}-${wi}`
                return (
                  <div key={wi} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f0f9ff', padding: '8px 10px', borderRadius: 8, marginTop: 4 }}>
                    <div>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#0369a1' }}>{w.code}</span>
                      <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>{w.name}</span>
                    </div>
                    <button onClick={() => cp(w.code, locKey)}
                      style={{ fontSize: 11, padding: '4px 11px', borderRadius: 8, border: '1px solid #bae6fd', background: copied===locKey?'#0369a1':'#fff', color: copied===locKey?'#fff':'#0369a1', fontWeight: 700, cursor: 'pointer', transition: 'all .12s', flexShrink: 0, marginLeft: 8 }}>
                      {copied===locKey ? '✓ 已複製' : '複製位置'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
