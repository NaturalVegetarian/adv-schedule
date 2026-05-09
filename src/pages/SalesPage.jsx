import { useState } from 'react'

const INIT_SALE = [
  { f: '黃金', d: 83, m: 1716, isMain: true }, { f: '泡菜', d: 38, m: 638, isMain: true },
  { f: '咖哩', d: 11, m: 347, isMain: true },  { f: '素花', d: 60, m: 1194, isMain: true },
  { f: '新鮮', d: 41, m: 571, isMain: true },  { f: '剝皮', d: 53, m: 888, isMain: true },
  { f: '酸白', d: 28, m: 424, isMain: true },  { f: '原味', d: 44, m: 337, isMain: true },
  { f: '紅燒', d: 4,  m: 100, isMain: false }, { f: '藥膳', d: 1,  m: 30,  isMain: false },
  { f: '珍菇', d: 2,  m: 50,  isMain: false }, { f: '香薑', d: 6,  m: 100, isMain: false },
  { f: '猴菇', d: 1,  m: 50,  isMain: false }, { f: '油飯', d: 3,  m: 50,  isMain: false },
]

const INIT_EVENTS = [
  { id: 1, name: '農曆過年', start: '2027-01-15', end: '2027-02-05', mult: 1.8, items: [] },
  { id: 2, name: '中秋節',   start: '2026-09-15', end: '2026-09-29', mult: 1.5, items: [] },
]

export default function SalesPage() {
  const [saleData, setSaleData] = useState(INIT_SALE)
  const [confSales, setConfSales] = useState([])
  const [newFlavor, setNewFlavor] = useState('')
  const [events, setEvents] = useState(INIT_EVENTS)
  const [editEvt, setEditEvt] = useState(null)
  const [newConf, setNewConf] = useState({ date: '', flavor: '黃金', qty: '', note: '' })

  const allFlavors = saleData.map(r => r.f)
  const mainRows = saleData.filter(r => r.isMain)
  const subRows = saleData.filter(r => !r.isMain)

  const update = (i, k, v) => { const n = [...saleData]; n[i] = { ...n[i], [k]: v }; setSaleData(n) }
  const addFlavor = () => {
    if (!newFlavor.trim()) return
    setSaleData(d => [...d, { f: newFlavor.trim(), d: 0, m: 0, isMain: true }])
    setNewFlavor('')
  }
  const addConf = () => {
    if (!newConf.date || !newConf.qty) return
    setConfSales(c => [...c, { ...newConf, id: Date.now(), qty: +newConf.qty }])
    setNewConf(p => ({ ...p, qty: '', note: '' }))
  }

  const SaleRows = ({ rows, startIdx, title }) => (
    <>
      <tr><td colSpan={4} className="sec-head">{title}</td></tr>
      {rows.map((r, ri) => {
        const i = startIdx + ri
        return (
          <tr key={r.f}>
            <td style={{ fontWeight: 700 }}>{r.f}</td>
            <td style={{ textAlign: 'right' }}>
              <input type="number" value={r.d} onChange={e => update(i, 'd', +e.target.value)} className="inp" style={{ width: 65, textAlign: 'right' }} />
              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 3 }}>包</span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <input type="number" value={r.m} onChange={e => update(i, 'm', +e.target.value)} className="inp" style={{ width: 65, textAlign: 'right' }} />
              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 3 }}>包</span>
            </td>
            <td style={{ textAlign: 'center' }}>
              <button className="btn btn-sm btn-red" onClick={() => setSaleData(d => d.filter((_, j) => j !== i))}>刪</button>
            </td>
          </tr>
        )
      })}
    </>
  )

  return (
    <div>
      {/* 每日預估 + 最低庫存 */}
      <div className="card">
        <div className="card-title">
          每日預估銷售量 ／ 最低庫存量
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>行銷科填寫 · 單位：包</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>口味</th>
              <th style={{ textAlign: 'right' }}>每日預估（包）</th>
              <th style={{ textAlign: 'right' }}>最低庫存（包）</th>
              <th style={{ width: 50, textAlign: 'center' }}>操作</th>
            </tr></thead>
            <tbody>
              <SaleRows rows={mainRows} startIdx={0} title="主產品（水餃・餡餅・湯包）" />
              <SaleRows rows={subRows} startIdx={mainRows.length} title="副產品" />
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 7, marginTop: 9, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <input type="text" value={newFlavor} onChange={e => setNewFlavor(e.target.value)} placeholder="新增口味名稱（新品直接輸入）" className="inp" style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && addFlavor()} />
          <button className="btn btn-dark btn-sm" onClick={addFlavor}>新增口味</button>
        </div>
      </div>

      {/* 已確定銷售 */}
      <div className="card">
        <div className="card-title">
          已確定銷售（客戶已訂貨）
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>銷貨科填寫</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 85px 1fr 64px', gap: 6, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #f1f5f9', alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>出貨日期</div>
            <input type="date" value={newConf.date} onChange={e => setNewConf(p => ({ ...p, date: e.target.value }))} className="inp" style={{ fontSize: 11 }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>口味</div>
            <select value={newConf.flavor} onChange={e => setNewConf(p => ({ ...p, flavor: e.target.value }))} className="inp" style={{ fontSize: 11 }}>
              {allFlavors.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>數量（包）</div>
            <input type="number" value={newConf.qty} onChange={e => setNewConf(p => ({ ...p, qty: e.target.value }))} className="inp" style={{ fontSize: 11 }} placeholder="包數" />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>備註（客戶）</div>
            <input type="text" value={newConf.note} onChange={e => setNewConf(p => ({ ...p, note: e.target.value }))} className="inp" style={{ fontSize: 11 }} placeholder="例：麗合-本院" />
          </div>
          <div><button className="btn btn-dark btn-sm" style={{ width: '100%', marginTop: 1 }} onClick={addConf}>新增</button></div>
        </div>
        {confSales.length === 0
          ? <div style={{ textAlign: 'center', color: '#94a3b8', padding: '12px 0', fontSize: 12 }}>目前無已確定銷售記錄</div>
          : <table className="tbl">
            <thead><tr><th>出貨日期</th><th>口味</th><th style={{ textAlign: 'right' }}>數量（包）</th><th>備註</th><th style={{ width: 44 }}>操作</th></tr></thead>
            <tbody>
              {[...confSales].sort((a, b) => a.date.localeCompare(b.date)).map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12, color: '#475569' }}>{r.date}</td>
                  <td style={{ fontWeight: 700 }}>{r.flavor}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.qty.toLocaleString()}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{r.note}</td>
                  <td><button className="btn btn-sm btn-red" onClick={() => setConfSales(c => c.filter(x => x.id !== r.id))}>刪</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>

      {/* 節日加乘 */}
      <div className="card">
        <div className="card-title">
          節日 ／ 活動加乘設定
          <button className="btn btn-dark btn-sm" onClick={() => setEditEvt({ id: Date.now(), name: '', start: '', end: '', mult: 1.5, items: [] })}>+ 新增活動</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>活動名稱</th><th>開始</th><th>結束</th><th>加乘</th><th>影響口味</th><th style={{ width: 80 }}>操作</th></tr></thead>
            <tbody>
              {events.map((ev, i) => (
                <tr key={ev.id}>
                  <td style={{ fontWeight: 700 }}>{ev.name}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{ev.start}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{ev.end}</td>
                  <td><span className="bdg" style={{ background: '#fef3c7', color: '#92400e' }}>×{ev.mult}</span></td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{ev.items.length === 0 ? '全品項' : ev.items.join('、')}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => setEditEvt({ ...ev })}>編輯</button>
                    <button className="btn btn-sm btn-red" onClick={() => setEvents(e => e.filter((_, j) => j !== i))}>刪</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 活動編輯 Modal */}
      {editEvt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 16 }}>活動設定</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[{ label: '活動名稱', key: 'name', type: 'text' }, { label: '開始日期', key: 'start', type: 'date' }, { label: '結束日期', key: 'end', type: 'date' }, { label: '加乘倍率', key: 'mult', type: 'number' }].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3, fontWeight: 700 }}>{f.label}</div>
                  <input type={f.type} step={f.type === 'number' ? '0.1' : undefined} value={editEvt[f.key]} onChange={e => setEditEvt(ev => ({ ...ev, [f.key]: f.type === 'number' ? +e.target.value : e.target.value }))} className="inp" />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 700 }}>影響口味（不選 = 全品項）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {allFlavors.map(f => {
                    const sel = editEvt.items.includes(f)
                    return (
                      <button key={f} onClick={() => setEditEvt(ev => ({ ...ev, items: sel ? ev.items.filter(x => x !== f) : [...ev.items, f] }))}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '1px solid', background: sel ? '#1e293b' : '#fff', color: sel ? '#fff' : '#475569', borderColor: sel ? '#1e293b' : '#e2e8f0', cursor: 'pointer' }}>
                        {f}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setEditEvt(null)}>取消</button>
              <button className="btn btn-dark" style={{ flex: 2 }} onClick={() => {
                setEvents(ev => { const idx = ev.findIndex(e => e.id === editEvt.id); if (idx >= 0) { const n = [...ev]; n[idx] = editEvt; return n } return [...ev, editEvt] })
                setEditEvt(null)
              }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
